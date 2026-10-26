import { addresses, attachments, bodyText, gmailFor, header, withRetry } from './google';
import { getAccount, readAccounts } from './store';

export type ThreadSummary = {
  account: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  messages: number;
  snippet: string;
  unread: boolean;
};

/** Gmail search across one account or all of them. Uses Gmail's own query syntax. */
export async function searchMail(query: string, account?: string, max = 15) {
  const accs = account ? [getAccount(account)] : readAccounts();
  const threads: ThreadSummary[] = [];
  const errors: string[] = [];
  await Promise.all(
    accs.map(async (acc) => {
      try {
        const g = gmailFor(acc);
        const list = await withRetry(() => g.users.threads.list({ userId: 'me', q: query, maxResults: max }));
        for (const t of list.data.threads ?? []) {
          const th = await withRetry(() =>
            g.users.threads.get({ userId: 'me', id: t.id!, format: 'metadata', metadataHeaders: ['From', 'Subject'] }),
          );
          const msgs = th.data.messages ?? [];
          const last = msgs[msgs.length - 1];
          threads.push({
            account: acc.email,
            threadId: t.id!,
            subject: header(msgs[0], 'Subject') || '(no subject)',
            from: header(last, 'From'),
            date: new Date(Number(last?.internalDate ?? 0)).toISOString(),
            messages: msgs.length,
            snippet: last?.snippet ?? '',
            unread: msgs.some((m) => m.labelIds?.includes('UNREAD')),
          });
        }
      } catch (e) {
        errors.push(`${acc.email}: ${(e as Error).message}`);
      }
    }),
  );
  threads.sort((a, b) => b.date.localeCompare(a.date));
  return { threads, errors };
}

export async function getThread(account: string, threadId: string) {
  const acc = getAccount(account);
  const th = await withRetry(() => gmailFor(acc).users.threads.get({ userId: 'me', id: threadId, format: 'full' }));
  return {
    account: acc.email,
    threadId,
    messages: (th.data.messages ?? []).map((m) => ({
      from: header(m, 'From'),
      to: header(m, 'To'),
      cc: header(m, 'Cc'),
      subject: header(m, 'Subject'),
      date: new Date(Number(m.internalDate ?? 0)).toISOString(),
      attachments: attachments(m),
      body: bodyText(m).slice(0, 10_000),
    })),
  };
}

function encodeHeader(v: string) {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

/**
 * Creates a Gmail draft in the given account, so it is sent from that address. Never sends.
 * With threadId it is a reply in that thread: recipients and subject default to the thread.
 */
export async function createDraft(input: {
  account: string;
  body: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  threadId?: string;
}) {
  const acc = getAccount(input.account);
  const g = gmailFor(acc);
  const me = acc.email.toLowerCase();
  let { to, cc, subject } = input;
  let inReplyTo = '';
  let references = '';

  if (input.threadId) {
    const th = await withRetry(() =>
      g.users.threads.get({
        userId: 'me',
        id: input.threadId!,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Message-ID', 'References', 'Reply-To'],
      }),
    );
    const msgs = th.data.messages ?? [];
    const last = msgs[msgs.length - 1];
    const lastFromMe = addresses(header(last, 'From')).includes(me);
    if (!to?.length) {
      to = lastFromMe ? addresses(header(last, 'To')) : addresses(header(last, 'Reply-To') || header(last, 'From'));
    }
    if (!cc) cc = addresses(header(last, 'Cc')).filter((a) => a !== me && !to!.includes(a));
    const orig = header(msgs[0], 'Subject');
    subject ??= /^re:/i.test(orig) ? orig : `Re: ${orig}`;
    inReplyTo = header(last, 'Message-ID');
    references = [header(last, 'References'), inReplyTo].filter(Boolean).join(' ');
  }
  if (!to?.length) throw new Error('A draft needs at least one recipient');

  const lines = [
    `From: ${acc.email}`,
    `To: ${to.join(', ')}`,
    cc?.length ? `Cc: ${cc.join(', ')}` : '',
    `Subject: ${encodeHeader(subject ?? '')}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : '',
    references ? `References: ${references}` : '',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  const raw = `${lines.join('\r\n')}\r\n\r\n${Buffer.from(input.body, 'utf8').toString('base64')}`;

  const res = await withRetry(() =>
    g.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw: Buffer.from(raw).toString('base64url'), threadId: input.threadId } },
    }),
  );
  return { account: acc.email, draftId: res.data.id!, to, cc: cc ?? [], subject: subject ?? '' };
}
