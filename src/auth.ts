import { readClient, saveAccount, SCOPES, type Account } from './store';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

// Google OAuth for a "Desktop app" client: Google accepts any loopback port, so we listen on a
// random free port, open the consent page, and catch the redirect. Nothing leaves this machine
// except the calls to Google itself.

const page = (msg: string) =>
  `<!doctype html><meta charset="utf-8"><title>multi-mail-mcp</title>` +
  `<body style="font:16px/1.5 system-ui;max-width:520px;margin:15vh auto;padding:0 16px">${msg}</body>`;

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  execFile(cmd, args, () => {});
}

/** Runs the browser login for one account and stores its refresh token. */
export function login(hint?: string): Promise<Account & { missing: string[] }> {
  const { client_id, client_secret } = readClient();
  const state = randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    let server: Server;
    let redirect = '';
    let finished = false;
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Timed out after 5 minutes.'));
    }, 5 * 60_000);
    const done = (err: Error | null, acc?: Account & { missing: string[] }) => {
      finished = true;
      clearTimeout(timer);
      setTimeout(() => server.close(), 200);
      err ? reject(err) : resolve(acc!);
    };

    server = createServer(async (req, res) => {
      // Browsers also ask for /favicon.ico, sometimes after the login finished: answer, ignore.
      const u = new URL(req.url ?? '/', redirect);
      if (u.pathname !== '/callback' || finished) return res.writeHead(404).end();
      const reply = (msg: string) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(msg));

      if (u.searchParams.get('state') !== state) {
        reply('This login link expired. Run the command again.');
        return done(new Error('State mismatch'));
      }
      if (u.searchParams.get('error')) {
        reply(`Google said: ${u.searchParams.get('error')}`);
        return done(new Error(`Google refused: ${u.searchParams.get('error')}`));
      }
      try {
        const tok = (await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: u.searchParams.get('code') ?? '',
            client_id,
            client_secret,
            redirect_uri: redirect,
            grant_type: 'authorization_code',
          }),
        }).then((r) => r.json())) as Record<string, string>;
        if (!tok.refresh_token) throw new Error(tok.error_description ?? tok.error ?? 'No refresh token returned');

        const info = (await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { authorization: `Bearer ${tok.access_token}` },
        }).then((r) => r.json())) as { email?: string };
        if (!info.email) throw new Error('Google did not return the account email');

        const missing = SCOPES.filter((s) => s.startsWith('https') && !tok.scope?.includes(s));
        const acc = { email: info.email, refresh_token: tok.refresh_token, scope: tok.scope, added: new Date().toISOString() };
        saveAccount(acc);
        reply(
          missing.length
            ? `<b>${info.email}</b> is connected, but some boxes were left unticked, so part of it will not work. Run the login again and tick every box.`
            : `<b>${info.email}</b> is connected. You can close this tab.`,
        );
        done(null, { ...acc, missing });
      } catch (e) {
        reply(`Login failed: ${(e as Error).message}`);
        done(e as Error);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({
        client_id,
        redirect_uri: redirect,
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state,
        ...(hint ? { login_hint: hint } : {}),
      }).toString();
      console.log(`\nOpening Google in your browser${hint ? ` for ${hint}` : ''}.`);
      console.log(`If nothing opens, paste this link into your browser:\n${url}\n`);
      openBrowser(url.toString());
    });
  });
}
