import { gmailFor, withRetry } from './google';
import { getAccount } from './store';

// Sorting actions. All reversible: labels can be removed, archived threads stay in All Mail and
// come back to the inbox on any reply, read can be set unread. Nothing here deletes or sends.

const SYSTEM = new Set(['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT', 'SPAM', 'TRASH', 'SENT', 'DRAFT']);

export async function listLabels(account: string) {
  const acc = getAccount(account);
  const res = await withRetry(() => gmailFor(acc).users.labels.list({ userId: 'me' }));
  return (res.data.labels ?? [])
    .filter((l) => l.type === 'user')
    .map((l) => l.name!)
    .sort();
}

/** Label names -> ids, creating user labels that do not exist yet. */
async function labelIds(account: string, names: string[]) {
  const acc = getAccount(account);
  const g = gmailFor(acc);
  const res = await withRetry(() => g.users.labels.list({ userId: 'me' }));
  const byName = new Map((res.data.labels ?? []).map((l) => [l.name!.toLowerCase(), l.id!]));
  const ids: string[] = [];
  const created: string[] = [];
  for (const name of names) {
    if (SYSTEM.has(name.toUpperCase())) {
      ids.push(name.toUpperCase());
      continue;
    }
    let id = byName.get(name.toLowerCase());
    if (!id) {
      const made = await withRetry(() =>
        g.users.labels.create({
          userId: 'me',
          requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
        }),
      );
      id = made.data.id!;
      byName.set(name.toLowerCase(), id);
      created.push(name);
    }
    ids.push(id);
  }
  return { ids, created };
}

async function modify(account: string, threadIds: string[], add: string[], remove: string[]) {
  const acc = getAccount(account);
  const g = gmailFor(acc);
  const done: string[] = [];
  const failed: string[] = [];
  for (const id of threadIds) {
    try {
      await withRetry(() =>
        g.users.threads.modify({ userId: 'me', id, requestBody: { addLabelIds: add, removeLabelIds: remove } }),
      );
      done.push(id);
    } catch (e) {
      failed.push(`${id}: ${(e as Error).message}`);
    }
  }
  return { account: acc.email, done: done.length, failed };
}

export async function labelThreads(account: string, threadIds: string[], add: string[] = [], remove: string[] = []) {
  const a = await labelIds(account, add);
  const r = await labelIds(account, remove);
  return { ...(await modify(account, threadIds, a.ids, r.ids)), createdLabels: [...a.created, ...r.created] };
}

export const archiveThreads = (account: string, threadIds: string[]) => modify(account, threadIds, [], ['INBOX']);

export const markRead = (account: string, threadIds: string[], read = true) =>
  read ? modify(account, threadIds, [], ['UNREAD']) : modify(account, threadIds, ['UNREAD'], []);
