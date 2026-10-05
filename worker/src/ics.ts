/**
 * The planner as an iCalendar feed (RFC 5545) for "Подписаться на календарь" on iPhone / Mac /
 * Google Calendar. Times are "floating" (no time zone): a 15:00 meeting shows at 15:00 on the
 * user's devices, exactly as in the planner.
 */
import type { CalendarEvent, Repeat } from '../../src/types';
import type { PlannerDoc } from '../../src/lib/merge';
import { addDays, minutesToTime, timeToMinutes } from '../../src/lib/date';
import { nextOccurrence, occurrencesBetween } from '../../src/lib/recurrence';

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** Escapes TEXT values. */
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Folds a content line at 75 octets (UTF-8 safe). */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const d8 = (key: string) => key.replace(/-/g, '');
const dt = (key: string, time: string) => `${d8(key)}T${time.replace(':', '')}00`;
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const allDay = (e: CalendarEvent) => e.start === '00:00' && e.end === '23:59';

function rrule(r: Repeat, timed: boolean): string {
  const parts: string[] = [];
  if (r.freq === 'day') parts.push('FREQ=DAILY');
  else if (r.freq === 'week') parts.push('FREQ=WEEKLY');
  else if (r.freq === 'month') parts.push('FREQ=MONTHLY');
  else parts.push('FREQ=YEARLY');
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === 'week' && r.byWeekday?.length) parts.push(`BYDAY=${r.byWeekday.map((d) => BYDAY[d]).join(',')}`);
  if (r.freq === 'month' && r.nth) {
    if (r.byWeekday?.length) parts.push(`BYDAY=${r.nth}${BYDAY[r.byWeekday[0]]}`);
    else parts.push(`BYMONTHDAY=${r.nth}`);
  }
  // UNTIL must match DTSTART's type: a date for all-day events, a (floating) date-time otherwise.
  if (r.until) parts.push(`UNTIL=${d8(r.until)}${timed ? 'T235959' : ''}`);
  return `RRULE:${parts.join(';')}`;
}

function vevent(lines: string[], o: { uid: string; updated: number; date: string; start?: string; end?: string; summary: string; note?: string; url: string; extra?: string[] }) {
  lines.push('BEGIN:VEVENT', `UID:${o.uid}`, `DTSTAMP:${stamp(o.updated)}`);
  if (!o.start) {
    lines.push(`DTSTART;VALUE=DATE:${d8(o.date)}`, `DTEND;VALUE=DATE:${d8(addDays(o.date, 1))}`);
  } else {
    lines.push(`DTSTART:${dt(o.date, o.start)}`, `DTEND:${dt(o.date, o.end ?? o.start)}`);
  }
  lines.push(`SUMMARY:${text(o.summary)}`);
  if (o.note) lines.push(`DESCRIPTION:${text(o.note)}`);
  lines.push(`URL:${o.url}`, ...(o.extra ?? []), 'END:VEVENT');
}

export function buildIcs(doc: PlannerDoc, opts: { today: string; appUrl: string; tasks: boolean }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AI Planner//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Планер',
    'X-WR-CALDESC:События из AI-планера в Telegram',
    'X-APPLE-CALENDAR-COLOR:#A78BFA',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
  ];
  const from = addDays(opts.today, -60);
  const to = addDays(opts.today, 400);
  const link = (open: string) => `${opts.appUrl}?open=${encodeURIComponent(open)}`;

  for (const e of doc.events) {
    const updated = e.updatedAt ?? e.createdAt;
    const timed = !allDay(e);
    const url = link(`e:${e.id}:${e.date}`);
    const r = e.repeat;
    if (!r) {
      if (e.date < from) continue;
      vevent(lines, { uid: `${e.id}@planner`, updated, date: e.date, start: timed ? e.start : undefined, end: e.end, summary: e.title, note: e.note, url });
      continue;
    }
    // Shift rotas (2/2, "сутки через трое") have no RRULE equivalent: list the days themselves.
    if (r.freq === 'day' && r.cycle) {
      for (const d of occurrencesBetween(e, from, addDays(opts.today, 180))) {
        vevent(lines, { uid: `${e.id}-${d}@planner`, updated, date: d, start: timed ? e.start : undefined, end: e.end, summary: e.title, note: e.note, url: link(`e:${e.id}:${d}`) });
      }
      continue;
    }
    // DTSTART must itself be an occurrence ("по вторникам" created on a Sunday).
    const first = nextOccurrence(e, e.date) ?? e.date;
    if (r.until && r.until < from) continue;
    const extra = [rrule(r, timed)];
    for (const x of r.exceptions ?? []) extra.push(timed ? `EXDATE:${dt(x, e.start)}` : `EXDATE;VALUE=DATE:${d8(x)}`);
    vevent(lines, { uid: `${e.id}@planner`, updated, date: first, start: timed ? e.start : undefined, end: e.end, summary: e.title, note: e.note, url, extra });
  }

  if (opts.tasks) {
    for (const t of doc.tasks) {
      if (t.done || !t.date || t.date < from || t.date > to) continue;
      const end = t.time ? minutesToTime(Math.min(timeToMinutes(t.time) + 30, 23 * 60 + 59)) : undefined;
      vevent(lines, {
        uid: `${t.id}@planner`,
        updated: t.updatedAt ?? t.createdAt,
        date: t.date,
        start: t.time,
        end,
        summary: `☐ ${t.title}`,
        note: t.note,
        url: link(`t:${t.id}`),
      });
    }
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
