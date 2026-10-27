import { api } from './google';
import { DIR, getAccount, readAccounts, type Account } from './store';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Drive, Docs, Sheets and Slides across every account. Reads anything, creates Docs and Sheets,
// edits Docs and Sheets. Nothing here deletes or moves files to the trash.

const DRIVE = 'https://www.googleapis.com/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const MAX_CHARS = 60_000;

const MIME = {
  doc: 'application/vnd.google-apps.document',
  sheet: 'application/vnd.google-apps.spreadsheet',
  slides: 'application/vnd.google-apps.presentation',
  folder: 'application/vnd.google-apps.folder',
  pdf: 'application/pdf',
} as const;
export type FileType = keyof typeof MIME;

const OFFICE: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

const kind = (mime: string) =>
  (Object.entries(MIME).find(([, m]) => m === mime)?.[0] as FileType | undefined) ??
  OFFICE[mime] ??
  mime.replace('application/', '');

/** Accepts a file id or any Google Docs/Sheets/Slides/Drive link. */
export function fileId(ref: string): string {
  const m = ref.match(/\/d\/([\w-]{20,})/) ?? ref.match(/[?&]id=([\w-]{20,})/);
  return m ? m[1] : ref.trim();
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  ownedByMe?: boolean;
  shared?: boolean;
  driveId?: string;
  owners?: { emailAddress?: string }[];
  webViewLink: string;
};
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,ownedByMe,shared,driveId,owners(emailAddress),webViewLink';

/** Searches file names and contents across one account or all of them. */
export async function searchFiles(input: {
  text?: string;
  type?: FileType;
  account?: string;
  modifiedAfter?: string;
  max?: number;
}) {
  const accs = input.account ? [getAccount(input.account)] : readAccounts();
  const parts = ['trashed = false'];
  if (input.text) parts.push(`(name contains '${q(input.text)}' or fullText contains '${q(input.text)}')`);
  if (input.type) parts.push(`mimeType = '${MIME[input.type]}'`);
  if (input.modifiedAfter) parts.push(`modifiedTime > '${new Date(input.modifiedAfter).toISOString()}'`);
  const params = new URLSearchParams({
    q: parts.join(' and '),
    pageSize: String(input.max ?? 20),
    fields: `files(${FILE_FIELDS})`,
    corpora: 'allDrives',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
  });
  // Drive refuses an order when searching contents.
  if (!input.text) params.set('orderBy', 'modifiedTime desc');

  const merged = new Map<string, ReturnType<typeof summary> & { seenIn: string[] }>();
  const errors: string[] = [];
  await Promise.all(
    accs.map(async (acc) => {
      try {
        const res = await api<{ files: DriveFile[] }>(acc, `${DRIVE}/files?${params}`);
        for (const f of res.files ?? []) {
          const hit = merged.get(f.id);
          if (hit) hit.seenIn.push(acc.email);
          else merged.set(f.id, { ...summary(acc, f), seenIn: [acc.email] });
        }
      } catch (e) {
        errors.push(`${acc.email}: ${(e as Error).message}`);
      }
    }),
  );
  const files = [...merged.values()].sort((a, b) => b.modified.localeCompare(a.modified));
  return { files, errors };
}

function summary(acc: Account, f: DriveFile) {
  return {
    account: acc.email,
    id: f.id,
    name: f.name,
    type: kind(f.mimeType),
    modified: f.modifiedTime,
    owner: f.ownedByMe ? acc.email : (f.owners?.[0]?.emailAddress ?? (f.driveId ? 'shared drive' : '')),
    shared: Boolean(f.shared || f.driveId),
    url: f.webViewLink,
  };
}

async function meta(acc: Account, id: string) {
  return api<DriveFile>(acc, `${DRIVE}/files/${id}?fields=${FILE_FIELDS}&supportsAllDrives=true`);
}

const cap = (s: string) =>
  s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}\n\n[cut at ${MAX_CHARS} characters of ${s.length}]` : s;

/** Collects every text run under a Slides element, in order. */
function slideText(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => slideText(n, out));
  else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    const run = (o.textRun as { content?: string } | undefined)?.content;
    if (run) out.push(run);
    for (const [k, v] of Object.entries(o)) if (k !== 'textRun' && k !== 'notesPage') slideText(v, out);
  }
  return out;
}

/** Reads a file as text: Docs as Markdown, Sheets tab by tab, Slides slide by slide. */
export async function readFile(account: string, ref: string) {
  const acc = getAccount(account);
  const id = fileId(ref);
  const f = await meta(acc, id);
  const head = summary(acc, f);

  if (f.mimeType === MIME.doc) {
    let text: string;
    try {
      text = await api<string>(acc, `${DRIVE}/files/${id}/export?mimeType=text/markdown`, { text: true });
    } catch {
      text = await api<string>(acc, `${DRIVE}/files/${id}/export?mimeType=text/plain`, { text: true });
    }
    return { ...head, content: cap(text) };
  }

  if (f.mimeType === MIME.sheet) {
    const book = await api<{ sheets: { properties: { title: string } }[] }>(
      acc,
      `${SHEETS}/${id}?fields=sheets.properties.title`,
    );
    const titles = book.sheets.map((s) => s.properties.title);
    const ranges = titles.map((t) => `ranges=${encodeURIComponent(`'${t.replace(/'/g, "''")}'`)}`).join('&');
    const vals = await api<{ valueRanges: { values?: string[][] }[] }>(acc, `${SHEETS}/${id}/values:batchGet?${ranges}`);
    let budget = MAX_CHARS;
    const tabs = titles.map((title, i) => {
      const rows = vals.valueRanges[i]?.values ?? [];
      const kept: string[][] = [];
      for (const r of rows) {
        const size = r.join('\t').length + 1;
        if (budget - size < 0) break;
        budget -= size;
        kept.push(r);
      }
      return { tab: title, totalRows: rows.length, rows: kept, ...(kept.length < rows.length ? { cut: true } : {}) };
    });
    return { ...head, tabs };
  }

  if (f.mimeType === MIME.slides) {
    const deck = await api<{ slides?: { pageElements?: unknown; slideProperties?: { notesPage?: unknown } }[] }>(
      acc,
      `https://slides.googleapis.com/v1/presentations/${id}`,
    );
    const slides = (deck.slides ?? []).map((s, i) => ({
      slide: i + 1,
      text: slideText(s.pageElements).join('').trim(),
      notes: slideText((s.slideProperties?.notesPage as { pageElements?: unknown })?.pageElements).join('').trim(),
    }));
    return { ...head, slides };
  }

  if (f.mimeType.startsWith('text/') || f.mimeType === 'application/json') {
    return { ...head, content: cap(await api<string>(acc, `${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`, { text: true })) };
  }

  // PDFs and images: saved locally so Claude can open the file itself.
  if (f.mimeType === MIME.pdf || f.mimeType.startsWith('image/')) {
    const res = await api<string>(acc, `${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`, { bytes: true });
    const dir = join(DIR, 'files');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${id}-${f.name.replace(/[^\w.-]+/g, '_')}`);
    writeFileSync(path, Buffer.from(res, 'base64'), { mode: 0o600 });
    return { ...head, content: null, localPath: path, note: 'Saved locally: open localPath to read it.' };
  }

  return { ...head, content: null, note: 'This file type cannot be read as text here. Open the link instead.' };
}

/** Edits to files other people can see wait for an explicit OK. */
async function guardShared(acc: Account, id: string, confirmed?: boolean) {
  const f = await meta(acc, id);
  if ((f.shared || f.driveId) && !confirmed) {
    throw new Error(
      `"${f.name}" is shared with other people, who would see this edit. Show the user the exact change, ` +
        'and call again with confirmed: true only after they approve it.',
    );
  }
  return f;
}

/** New Google Doc from Markdown, in the given account. */
export async function createDoc(account: string, title: string, markdown: string, folder?: string) {
  const acc = getAccount(account);
  const boundary = `b${Date.now()}`;
  const metadata = { name: title, mimeType: MIME.doc, ...(folder ? { parents: [fileId(folder)] } : {}) };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${markdown}\r\n--${boundary}--`;
  const f = await api<DriveFile>(
    acc,
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=${FILE_FIELDS}`,
    { upload: { body, contentType: `multipart/related; boundary=${boundary}` } },
  );
  return summary(acc, f);
}

/** Appends plain text to a Doc and/or replaces text everywhere in it. */
export async function editDoc(input: {
  account: string;
  file: string;
  append?: string;
  replace?: { find: string; with: string }[];
  confirmed?: boolean;
}) {
  const acc = getAccount(input.account);
  const id = fileId(input.file);
  const f = await guardShared(acc, id, input.confirmed);
  const requests: unknown[] = (input.replace ?? []).map((r) => ({
    replaceAllText: { containsText: { text: r.find, matchCase: true }, replaceText: r.with },
  }));
  if (input.append) requests.push({ insertText: { text: `\n${input.append}`, endOfSegmentLocation: {} } });
  if (!requests.length) throw new Error('Nothing to change: give append and/or replace.');
  const res = await api<{ replies?: { replaceAllText?: { occurrencesChanged?: number } }[] }>(
    acc,
    `https://docs.googleapis.com/v1/documents/${id}:batchUpdate`,
    { json: { requests } },
  );
  const replaced = (res.replies ?? []).map((r) => r.replaceAllText?.occurrencesChanged).filter((n) => n !== undefined);
  return { ...summary(acc, f), replaced: replaced.map((n) => n ?? 0), appended: Boolean(input.append) };
}

const quoteTab = (t: string) => `'${t.replace(/'/g, "''")}'`;

async function firstTab(acc: Account, id: string) {
  const book = await api<{ sheets: { properties: { sheetId: number; title: string } }[] }>(
    acc,
    `${SHEETS}/${id}?fields=sheets.properties(sheetId,title)`,
  );
  return book.sheets[0].properties;
}

/** New Google Sheet, optionally filled with rows (first row = headers). Formulas work. */
export async function createSheet(account: string, title: string, rows: string[][] = [], tab?: string, folder?: string) {
  const acc = getAccount(account);
  const f = await api<DriveFile>(acc, `${DRIVE}/files?supportsAllDrives=true&fields=${FILE_FIELDS}`, {
    json: { name: title, mimeType: MIME.sheet, ...(folder ? { parents: [fileId(folder)] } : {}) },
  });
  let { sheetId, title: tabTitle } = await firstTab(acc, f.id);
  if (tab && tab !== tabTitle) {
    await api(acc, `${SHEETS}/${f.id}:batchUpdate`, {
      json: { requests: [{ updateSheetProperties: { properties: { sheetId, title: tab }, fields: 'title' } }] },
    });
    tabTitle = tab;
  }
  if (rows.length) {
    const range = encodeURIComponent(`${quoteTab(tabTitle)}!A1`);
    await api(acc, `${SHEETS}/${f.id}/values/${range}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      json: { values: rows },
    });
  }
  return { ...summary(acc, f), tab: tabTitle, rowsWritten: rows.length };
}

/** Writes rows into a Sheet: append below the last row, or overwrite from a cell. */
export async function updateSheet(input: {
  account: string;
  file: string;
  rows: string[][];
  mode: 'append' | 'overwrite';
  tab?: string;
  start?: string;
  confirmed?: boolean;
}) {
  const acc = getAccount(input.account);
  const id = fileId(input.file);
  const f = await guardShared(acc, id, input.confirmed);
  const tab = input.tab ?? (await firstTab(acc, id)).title;
  const range = encodeURIComponent(`${quoteTab(tab)}${input.mode === 'overwrite' ? `!${input.start ?? 'A1'}` : ''}`);
  const res =
    input.mode === 'append'
      ? await api<{ updates?: { updatedRange?: string } }>(
          acc,
          `${SHEETS}/${id}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          { json: { values: input.rows } },
        )
      : await api<{ updatedRange?: string }>(acc, `${SHEETS}/${id}/values/${range}?valueInputOption=USER_ENTERED`, {
          method: 'PUT',
          json: { values: input.rows },
        });
  const updated = 'updates' in res ? res.updates?.updatedRange : (res as { updatedRange?: string }).updatedRange;
  return { ...summary(acc, f), tab, updatedRange: updated ?? '' };
}
