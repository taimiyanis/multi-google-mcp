import { DIR, hasClient, readAccounts, removeAccount, saveClient } from './store';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
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

const GOOGLE_STEPS = [
  [
    'Create a Google Cloud project',
    'Open https://console.cloud.google.com/projectcreate , name it "multi-google-mcp" (any name works) and click Create.',
  ],
  [
    'Turn on the Google APIs',
    'With that project selected, open each link and click Enable (six of them):\n' +
      '   https://console.cloud.google.com/apis/library/gmail.googleapis.com\n' +
      '   https://console.cloud.google.com/apis/library/calendar-json.googleapis.com\n' +
      '   https://console.cloud.google.com/apis/library/drive.googleapis.com\n' +
      '   https://console.cloud.google.com/apis/library/docs.googleapis.com\n' +
      '   https://console.cloud.google.com/apis/library/sheets.googleapis.com\n' +
      '   https://console.cloud.google.com/apis/library/slides.googleapis.com',
  ],
  [
    'Set up the sign-in screen',
    'Open https://console.cloud.google.com/auth/overview and click Get started.\n' +
      '   App name: anything WITHOUT "Google", "Gmail" or "Inbox" in it (Google rejects those), e.g. "My Mail Tool".\n' +
      '   Support email: yours. Audience: External. Contact email: yours. Accept the policy, then Create.',
  ],
  [
    'Publish the app',
    'Open https://console.cloud.google.com/auth/audience and click "Publish app", then Confirm.\n' +
      '   Ignore the "needs verification" notice: it is your private app. Without publishing,\n' +
      '   Google logs you out every 7 days.',
  ],
  [
    'Create the login key',
    'Open https://console.cloud.google.com/auth/clients , click Create client.\n' +
      '   Application type: Desktop app. Name: anything. Click Create and keep the window open.',
  ],
];

async function setupClient() {
  console.log(`\n${bold('Part 1 of 3: your own Google login key')} ${dim('(one time, about 10 minutes)')}`);
  console.log(dim('Each user makes their own key, so your mail never goes through anyone else.\n'));
  for (const [i, [title, body]] of GOOGLE_STEPS.entries()) {
    console.log(`${bold(`${i + 1}/${GOOGLE_STEPS.length}  ${title}`)}\n   ${body}`);
    await ask(dim('   Press Enter when done. '));
  }
  const client_id = await ask('Paste the Client ID: ');
  if (!client_id.endsWith('.apps.googleusercontent.com')) throw new Error('That does not look like a Client ID.');
  const client_secret = await askHidden('Paste the Client secret (hidden): ');
  if (!client_secret) throw new Error('Empty secret.');
  saveClient({ client_id, client_secret });
  console.log(`Saved to ${join(DIR, 'client.json')} (only your user can read it).`);
}

async function addAccount(email?: string) {
  console.log(dim('Google will say the app is not verified: click Advanced, then Go to <your app name>.'));
  console.log(dim('Tick every box on the permissions screen.'));
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

async function setupClaude() {
  console.log(`\n${bold('Part 3 of 3: connect Claude')}`);
  const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');
  const mcp = join(ROOT, 'src', 'mcp.ts');
  const cmd = ['mcp', 'add', 'multi-google', '-s', 'user', '--', tsx, mcp];
  let hasClaude = true;
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' });
  } catch {
    hasClaude = false;
  }
  if (hasClaude && (await yes('Register the server in Claude Code for all your projects?'))) {
    execFileSync('claude', cmd, { stdio: 'inherit' });
  } else {
    console.log(`Claude Code: claude ${cmd.map((c) => (c.includes(' ') ? `"${c}"` : c)).join(' ')}`);
    console.log(`Other clients (Claude Desktop, Cursor): command "${tsx}", args ["${mcp}"]`);
  }
  const skills = join(homedir(), '.claude', 'skills');
  const target = join(skills, 'mail-triage');
  if (existsSync(join(homedir(), '.claude')) && (await yes('Install the /mail-triage skill for Claude Code?'))) {
    mkdirSync(skills, { recursive: true });
    cpSync(join(ROOT, 'skills', 'mail-triage'), target, { recursive: true });
    console.log(`Installed in ${target}`);
  }
  console.log(`\n${bold('Done.')} Open a new Claude Code session and ask: "what came in today across my inboxes?"\nor "find the budget sheet in any of my Drives and summarise it."`);
}

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === 'setup') {
    if (!hasClient() || (await yes('A Google key is already saved. Replace it?'))) await setupClient();
    await setupAccounts();
    await setupClaude();
  } else if (cmd === 'add') {
    await addAccount(arg);
  } else if (cmd === 'remove' && arg) {
    console.log(removeAccount(arg) ? `Removed ${arg}. Also revoke it at https://myaccount.google.com/permissions` : `No account ${arg}`);
  } else if (cmd === 'accounts') {
    const all = readAccounts();
    console.log(all.length ? all.map((a) => `${a.email}  ${dim(`since ${a.added.slice(0, 10)}`)}`).join('\n') : 'No accounts yet.');
  } else {
    console.log('Usage: npm run setup | npm run add -- <email> | npm run remove -- <email> | npm run accounts');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`\nError: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
