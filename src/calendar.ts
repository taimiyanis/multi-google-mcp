import { calendarFor, withRetry } from './google';
import { readAccounts } from './store';

export type CalEvent = {
  account: string;
  calendar: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  attendees: string[];
};

/** Events from every visible calendar of every account, in [from, to). Read-only. */
export async function listEvents(from: Date, to: Date) {
  const events: CalEvent[] = [];
  const errors: string[] = [];
  for (const acc of readAccounts()) {
    try {
      const cal = calendarFor(acc);
      const cals = await withRetry(() => cal.calendarList.list({ minAccessRole: 'reader' }));
      for (const c of cals.data.items ?? []) {
        if (c.selected === false || c.hidden) continue;
        const res = await withRetry(() =>
          cal.events.list({
            calendarId: c.id!,
            timeMin: from.toISOString(),
            timeMax: to.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 250,
          }),
        );
        for (const e of res.data.items ?? []) {
          if (e.status === 'cancelled') continue;
          events.push({
            account: acc.email,
            calendar: c.summaryOverride ?? c.summary ?? c.id!,
            summary: e.summary ?? '(no title)',
            start: e.start?.dateTime ?? e.start?.date ?? '',
            end: e.end?.dateTime ?? e.end?.date ?? '',
            allDay: !e.start?.dateTime,
            location: e.location ?? '',
            attendees: (e.attendees ?? []).map((a) => a.email ?? '').filter(Boolean),
          });
        }
      }
    } catch (err) {
      errors.push(`${acc.email}: ${(err as Error).message}`);
    }
  }
  // Accounts often see each other's calendars: keep one copy of each event, listing every account.
  const merged = new Map<string, CalEvent & { seenIn: string[] }>();
  for (const e of events) {
    const key = `${e.start}|${e.end}|${e.summary}`;
    const hit = merged.get(key);
    if (hit) {
      if (!hit.seenIn.includes(e.account)) hit.seenIn.push(e.account);
    } else merged.set(key, { ...e, seenIn: [e.account] });
  }
  const unique = [...merged.values()].sort((a, b) => a.start.localeCompare(b.start));
  return { events: unique, errors };
}
