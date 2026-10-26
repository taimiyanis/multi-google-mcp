import { auth as calendarAuth, calendar, type calendar_v3 } from '@googleapis/calendar';
import { auth as gmailAuth, gmail, type gmail_v1 } from '@googleapis/gmail';
import { readClient, type Account } from './store';

// Each @googleapis package pins its own auth library version, so each gets its own OAuth2 client.
export function gmailFor(acc: Account): gmail_v1.Gmail {
  const { client_id, client_secret } = readClient();
  const auth = new gmailAuth.OAuth2(client_id, client_secret);
  auth.setCredentials({ refresh_token: acc.refresh_token });
  return gmail({ version: 'v1', auth });
}

export function calendarFor(acc: Account): calendar_v3.Calendar {
  const { client_id, client_secret } = readClient();
  const auth = new calendarAuth.OAuth2(client_id, client_secret);
  auth.setCredentials({ refresh_token: acc.refresh_token });
  return calendar({ version: 'v3', auth });
}

/** Retries Google calls hit by the per-user rate limit. */
export async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const err = e as { code?: number; status?: number; message?: string };
      const status = err.code ?? err.status;
      const limited =
        status === 429 || (status === 403 && /rate|quota/i.test(err.message ?? '')) || /quota exceeded/i.test(err.message ?? '');
      if (!limited || i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * 2 ** i)));
    }
  }
}

export function header(msg: gmail_v1.Schema$Message | undefined, name: string): string {
  const h = msg?.payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

/** "Jane Doe <jane@x.com>, bob@y.com" -> ["jane@x.com", "bob@y.com"] */
export function addresses(value: string): string[] {
  return [...value.matchAll(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0].toLowerCase());
}

/** Plain-text body of a message: text/plain part, else stripped text/html. */
export function bodyText(msg: gmail_v1.Schema$Message): string {
  const parts: gmail_v1.Schema$MessagePart[] = [];
  const walk = (p?: gmail_v1.Schema$MessagePart) => {
    if (!p) return;
    parts.push(p);
    p.parts?.forEach(walk);
  };
  walk(msg.payload);
  const decode = (d?: string | null) => (d ? Buffer.from(d, 'base64url').toString('utf8') : '');
  const plain = parts.find((p) => p.mimeType === 'text/plain' && p.body?.data);
  if (plain) return decode(plain.body?.data);
  const html = parts.find((p) => p.mimeType === 'text/html' && p.body?.data);
  if (!html) return msg.snippet ?? '';
  return decode(html.body?.data)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function attachments(msg: gmail_v1.Schema$Message): string[] {
  const out: string[] = [];
  const walk = (p?: gmail_v1.Schema$MessagePart) => {
    if (!p) return;
    if (p.filename) out.push(p.filename);
    p.parts?.forEach(walk);
  };
  walk(msg.payload);
  return out;
}
