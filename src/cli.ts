import { DIR, hasClient, readAccounts, removeAccount, saveClient, type Account } from './store';
import { api, calendarFor, gmailFor } from './google';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { login } from './auth';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rl = createInterface({ input: process.stdin, output: process.stdout });
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function ask(q: string) {
  return (await rl.question(q)).trim();
}

async function yes(q: string) {
  return /^y(es)?$/i.test(await ask(`${q} [y/N] `));
}

/** Reads a line without echoing it (for the client secret). */
async function askHidden(q: string): Promise<string> {
  const out = process.stdout;
  const write = out.write.bind(out);
  out.write(q);
  (out as unknown as { write: (s: string) => boolean }).write = () => true;
  try {
    return (await rl.question('')).trim();
  } finally {
    (out as unknown as { write: typeof write }).write = write;
    out.write('\n');
  }
}

const APIS = ['gmail', 'calendar-json', 'drive', 'docs', 'sheets', 'slides'].map((a) => `${a}.googleapis.com`);
const SITE = 'https://multi-google-mcp-tau.vercel.app';

// Each step: what to open, what you will see, what to click. Checked against the real console;
// the same steps with pictures are on the site.
const GOOGLE_STEPS = [
  [
    'Create a Google Cloud project',
    'Open https://console.cloud.google.com/projectcreate , name it "multi-google-mcp" and click Create.\n' +
      '   A notification appears at the top right: click Select project.',
  ],
  [
    'Turn on the six Google APIs (one link)',
    `Open https://console.cloud.google.com/flows/enableapi?apiid=${APIS.join(',')}\n` +
      '   Check that the box at the top shows multi-google-mcp (if not, click it and pick it).\n' +
      '   Click Next, then Enable. Gmail, Calendar, Drive, Docs, Sheets and Slides turn on together.',
  ],
  [
    'Set up the sign-in screen',
    'Open https://console.cloud.google.com/auth/overview and click Get started.\n' +
      '   App name: anything WITHOUT "Google", "Gmail" or "Inbox" in it, e.g. "My Mail Tool".\n' +
      '   Support email: yours. Next. Audience: External. Next. Contact email: yours. Next.\n' +
      '   Tick the policy box, Continue, then Create.',
  ],
  [
    'Add the two links Google needs before publishing',
    'Open https://console.cloud.google.com/auth/branding and fill in:\n' +
      `   Application home page:       ${SITE}\n` +
      `   Application privacy policy:  ${SITE}/privacy\n` +
      `   Authorized domains, Add domain:  ${new URL(SITE).host}\n` +
      '   Click Save at the bottom. (Your own pages work too, if you have them.)',
  ],
  [
    'Publish the app',
    'Open https://console.cloud.google.com/auth/audience , click Publish app, then Confirm.\n' +
      '   Google mentions verification: ignore it, this app is only for you.\n' +
      '   Without publishing, Google logs you out every 7 days.',
  ],
  [
    'Create your login key',
    'Open https://console.cloud.google.com/auth/clients/create\n' +
      '   Application type: Desktop app. Click Create.\n' +
      '   In the window that opens, click Download JSON. Google shows the secret only once.',
  ],
];

/** The newest client_secret_*.json in Downloads from the last hour, if any. */
function downloadedKey(): string | undefined {
  const dir = join(homedir(), 'Downloads');
  if (!existsSync(dir)) return;
  return readdirSync(dir)
    .filter((f) => /^client_secret_.*\.json$/.test(f))
    .map((f) => ({ path: join(dir, f), time: statSync(join(dir, f)).mtimeMs }))
    .filter((f) => Date.now() - f.time < 60 * 60_000)
    .sort((a, b) => b.time - a.time)[0]?.path;
}

function readKeyFile(path: string) {
  const raw = JSON.parse(readFileSync(path.trim().replace(/^['"]|['"]$/g, ''), 'utf8'));
  const key = raw.installed ?? raw.web ?? raw;
  if (!key.client_id || !key.client_secret) throw new Error('That file has no client_id and client_secret.');
  if (raw.web) console.log(dim('Note: this is a Web client. Create a Desktop app client instead if login fails.'));
  return { client_id: key.client_id as string, client_secret: key.client_secret as string };
}

async function setupClient() {
  console.log(`\n${bold('Part 1 of 3: your own Google login key')} ${dim('(one time, about 10 minutes)')}`);
  console.log(dim('Each user makes their own key, so your data never goes through anyone else.'));
  console.log(dim(`The same steps with pictures: ${SITE}/#setup\n`));
  for (const [i, [title, body]] of GOOGLE_STEPS.entries()) {
    console.log(`${bold(`${i + 1}/${GOOGLE_STEPS.length}  ${title}`)}\n   ${body}`);
    await ask(dim('   Press Enter when done. '));
  }
  let key: { client_id: string; client_secret: string } | undefined;
  const found = downloadedKey();
  if (found && (await yes(`Use the key you just downloaded (${found})?`))) key = readKeyFile(found);
  if (!key) {
    const answer = await ask('Drag the downloaded JSON file here and press Enter (or press Enter to paste instead): ');
    if (answer) key = readKeyFile(answer.replace(/\\ /g, ' '));
  }
  if (!key) {
    const client_id = await ask('Paste the Client ID: ');
    if (!client_id.endsWith('.apps.googleusercontent.com')) throw new Error('That does not look like a Client ID.');
    const client_secret = await askHidden('Paste the Client secret (hidden): ');
    if (!client_secret) throw new Error('Empty secret.');
    key = { client_id, client_secret };
  }
  saveClient(key);
  console.log(`Saved to ${join(DIR, 'client.json')} (only your user can read it). You can delete the downloaded file.`);
}

async function addAccount(email?: string) {
  console.log(dim('A browser tab opens. Pick the account. Google then warns "Google hasn\'t verified this app":'));
  console.log(dim('that is expected, it is your own app. Click Advanced, then Go to <your app name>.'));
  console.log(dim('On the next screen tick every box (Gmail, Drive, Calendar), then Continue.'));
  const acc = await login(email);
  console.log(`${bold('Connected')} ${acc.email}${acc.missing.length ? ` (missing: ${acc.missing.join(', ')})` : ''}`);
}

async function setupAccounts() {
  console.log(`\n${bold('Part 2 of 3: connect your accounts')}`);
  const have = readAccounts().map((a) => a.email);
  if (have.length) console.log(`Already connected: ${have.join(', ')}`);
  for (;;) {
    const email = await ask('Email address to connect (Enter to finish): ');
    if (!email) break;
    try {
      await addAccount(email);
    } catch (e) {
      console.log(`Not connected: ${(e as Error).message}`);
      console.log(dim('"admin_policy_enforced" means that organisation blocks outside apps.'));
    }
  }
}

/** One quick read per service and account, so problems show up now and not in Claude. */
async function check() {
  const accounts = readAccounts();
  if (!accounts.length) return console.log('No accounts yet. Run: npx multi-google-mcp add you@example.com');
  console.log(`\n${bold('Checking each account')}`);
  let ok = true;
  const probes: [string, (a: Account) => Promise<unknown>][] = [
    ['Gmail', (a) => gmailFor(a).users.getProfile({ userId: 'me' })],
    ['Drive', (a) => api(a, 'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)')],
    ['Calendar', (a) => calendarFor(a).calendarList.list({ maxResults: 1 })],
  ];
  for (const acc of accounts) {
    const results = await Promise.all(
      probes.map(([name, run]) => run(acc).then(() => null, (e: Error) => `${name}: ${e.message.split('\n')[0]}`)),
    );
    const failed = results.filter(Boolean);
    ok &&= !failed.length;
    console.log(`${failed.length ? 'FAILED' : 'ok    '}  ${acc.email}`);
    for (const f of failed) console.log(dim(`        ${f}`));
  }
  if (!ok) {
    console.log(dim('\n"not been used in project" or "disabled": turn the APIs on with the link from step 1.'));
    console.log(dim('"insufficient" or "permission": run add again for that account and tick every box.'));
  }
  return ok;
}

// From npx the package lives in a temporary cache, so Claude starts it through npx too.
const viaNpx = ROOT.includes(`${sep}_npx${sep}`);
const serverCommand = viaNpx
  ? process.platform === 'win32'
    ? ['cmd', '/c', 'npx', '-y', 'multi-google-mcp', 'mcp']
    : ['npx', '-y', 'multi-google-mcp', 'mcp']
  : [process.execPath, join(ROOT, 'dist', 'bin.js'), 'mcp'];

async function setupClaude() {
  console.log(`\n${bold('Part 3 of 3: connect Claude')}`);
  const cmd = ['mcp', 'add', 'multi-google', '-s', 'user', '--', ...serverCommand];
  let hasClaude = true;
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' });
  } catch {
    hasClaude = false;
  }
  if (hasClaude && (await yes('Register the server in Claude Code for all your projects?'))) {
    execFileSync('claude', cmd, { stdio: 'inherit' });
  } else {
    const [command, ...args] = serverCommand;
    console.log(`Claude Code: claude ${cmd.map((c) => (c.includes(' ') ? `"${c}"` : c)).join(' ')}`);
    console.log(`Other clients (Claude Desktop, Cursor): command "${command}", args ${JSON.stringify(args)}`);
  }
  const skills = join(homedir(), '.claude', 'skills');
  const target = join(skills, 'mail-triage');
  if (existsSync(join(homedir(), '.claude')) && (await yes('Install the /mail-triage skill for Claude Code?'))) {
    mkdirSync(skills, { recursive: true });
    cpSync(join(ROOT, 'skills', 'mail-triage'), target, { recursive: true });
    console.log(`Installed in ${target}`);
  }
  console.log(`\n${bold('Done.')} Open a new Claude Code session and ask: "what came in today across my inboxes?"`);
  console.log('or "find the budget sheet in any of my Drives and summarise it."');
}

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === 'setup') {
    if (!hasClient() || (await yes('A Google key is already saved. Replace it?'))) await setupClient();
    await setupAccounts();
    await check();
    await setupClaude();
  } else if (cmd === 'add') {
    await addAccount(arg);
  } else if (cmd === 'remove' && arg) {
    console.log(removeAccount(arg) ? `Removed ${arg}. Also revoke it at https://myaccount.google.com/permissions` : `No account ${arg}`);
  } else if (cmd === 'check') {
    if (!(await check())) process.exitCode = 1;
  } else if (cmd === 'accounts') {
    const all = readAccounts();
    console.log(all.length ? all.map((a) => `${a.email}  ${dim(`since ${a.added.slice(0, 10)}`)}`).join('\n') : 'No accounts yet.');
  } else {
    console.log('Usage: npx multi-google-mcp setup | add <email> | remove <email> | accounts | check | mcp');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`\nError: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
