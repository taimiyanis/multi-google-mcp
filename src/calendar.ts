import { calendarFor, withRetry } from './google';
import type { calendar_v3 } from '@googleapis/calendar';
import { getAccount, readAccounts } from './store';

export type CalEvent = {
  account: string;
  calendar: string;
  calendarId: string;
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  attendees: string[];
};

/** Events from every visible calendar of every account, in [from, to). */
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
            calendarId: c.id!,
            id: e.id!,
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

export type EventInput = {
  account: string;
  calendarId?: string;
  summary?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  description?: string;
  guests?: string[];
  guestsConfirmed?: boolean;
  meet?: boolean;
};

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const when = (v: string, allDay?: boolean) => (allDay ? { date: v.slice(0, 10) } : { dateTime: v, timeZone: zone });

// Guests get an email and the event on their own calendar, so any event with guests waits for
// the user's explicit OK on that exact event.
function checkGuests(hasGuests: boolean, confirmed?: boolean) {
  if (hasGuests && !confirmed) {
    throw new Error(
      'This event has guests, who would be notified. Show the user the event and guest list, and call again ' +
        'with guests_confirmed: true only after they approve it.',
    );
  }
}

function shape(acc: string, calendarId: string, e: calendar_v3.Schema$Event) {
  return {
    account: acc,
    calendarId,
    id: e.id!,
    summary: e.summary ?? '',
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    guests: (e.attendees ?? []).map((a) => a.email ?? '').filter(Boolean),
    meet: e.hangoutLink ?? '',
    url: e.htmlLink ?? '',
  };
}

export async function createEvent(input: EventInput) {
  if (!input.summary || !input.start || !input.end) throw new Error('An event needs summary, start and end.');
  const acc = getAccount(input.account);
  const guests = input.guests ?? [];
  checkGuests(guests.length > 0, input.guestsConfirmed);
  const calendarId = input.calendarId ?? 'primary';
  const res = await withRetry(() =>
    calendarFor(acc).events.insert({
      calendarId,
      sendUpdates: guests.length ? 'all' : 'none',
      conferenceDataVersion: input.meet ? 1 : 0,
      requestBody: {
        summary: input.summary,
        location: input.location,
        description: input.description,
        start: when(input.start!, input.allDay),
        end: when(input.end!, input.allDay),
        attendees: guests.map((email) => ({ email })),
        ...(input.meet ? { conferenceData: { createRequest: { requestId: `m${Date.now()}` } } } : {}),
      },
    }),
  );
  return shape(acc.email, calendarId, res.data);
}

/** Changes only the fields given. guests replaces the whole guest list. */
export async function updateEvent(input: EventInput & { eventId: string }) {
  const acc = getAccount(input.account);
  const cal = calendarFor(acc);
  const calendarId = input.calendarId ?? 'primary';
  const current = await withRetry(() => cal.events.get({ calendarId, eventId: input.eventId }));
  const others = (current.data.attendees ?? []).filter((a) => !a.self);
  const guests = input.guests ?? [];
  checkGuests(others.length > 0 || guests.length > 0, input.guestsConfirmed);
  const allDay = input.allDay ?? !current.data.start?.dateTime;
  const res = await withRetry(() =>
    cal.events.patch({
      calendarId,
      eventId: input.eventId,
      sendUpdates: others.length || guests.length ? 'all' : 'none',
      conferenceDataVersion: input.meet ? 1 : 0,
      requestBody: {
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.start ? { start: when(input.start, allDay) } : {}),
        ...(input.end ? { end: when(input.end, allDay) } : {}),
        ...(input.guests ? { attendees: guests.map((email) => ({ email })) } : {}),
        ...(input.meet ? { conferenceData: { createRequest: { requestId: `m${Date.now()}` } } } : {}),
      },
    }),
  );
  return shape(acc.email, calendarId, res.data);
}
