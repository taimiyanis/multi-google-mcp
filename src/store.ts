import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Everything secret lives outside the repo, in ~/.config/multi-google-mcp (mode 700, files 600).
export const DIR = process.env.MULTI_GOOGLE_MCP_HOME ?? join(homedir(), '.config', 'multi-google-mcp');
const CLIENT = join(DIR, 'client.json');
const ACCOUNTS = join(DIR, 'accounts.json');

export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

export type Client = { client_id: string; client_secret: string };
export type Account = { email: string; refresh_token: string; scope: string; added: string };

function writePrivate(path: string, data: unknown) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(data, null, 2));
  chmodSync(path, 0o600);
}

export const hasClient = () => existsSync(CLIENT);

export function readClient(): Client {
  if (!hasClient()) throw new Error('No Google OAuth client yet. Run: npx multi-google-mcp setup');
  return JSON.parse(readFileSync(CLIENT, 'utf8'));
}

export const saveClient = (c: Client) => writePrivate(CLIENT, c);

export function readAccounts(): Account[] {
  return existsSync(ACCOUNTS) ? JSON.parse(readFileSync(ACCOUNTS, 'utf8')) : [];
}

export function saveAccount(acc: Account) {
  writePrivate(ACCOUNTS, [...readAccounts().filter((a) => a.email !== acc.email), acc]);
}

export function removeAccount(email: string) {
  const all = readAccounts();
  const left = all.filter((a) => a.email.toLowerCase() !== email.toLowerCase());
  writePrivate(ACCOUNTS, left);
  return all.length !== left.length;
}

export function getAccount(email: string): Account {
  const all = readAccounts();
  const hit = all.find((a) => a.email.toLowerCase() === email.trim().toLowerCase());
  if (!hit) {
    throw new Error(`No account "${email}". Connected: ${all.map((a) => a.email).join(', ') || 'none'}`);
  }
  return hit;
}
