/**
 * Pure reminder math, shared by the app and the worker (no browser / store imports).
 * Times are computed for the user's timezone, so the server can schedule them too.
 */
import type { CalendarEvent, Reminder, Task } from '@/types';
import { addDays, fromKey, humanDate } from './date';
import { occurrencesBetween } from './recurrence';

export const WINDOW_DAYS = 35;
const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export const REMIND_PRESETS = [0, 5, 15, 30, 60, 120, 1440, 2880];

/** "за 30 мин", "за 1 ч 30 мин", "за 1 день", "в момент начала". */
export function offsetLabel(min: number, startWord = 'начала'): string {
  if (!min) return `в момент ${startWord}`;
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const parts = [d && `${d} ${d === 1 ? 'день' : d < 5 ? 'дня' : 'дней'}`, h && `${h} ч`, m && `${m} мин`].filter(Boolean);
  return `за ${parts.join(' ')}`;
}

export function reminderLabel(r: Reminder | undefined, hasDate: boolean): string {
  if (!r) return 'Выкл.';
  if (r.at) return atLabel(r.at);
  return hasDate ? offsetLabel(r.offset ?? 0) : 'Выкл.';
}

export function atLabel(at: string): string {
  const [date, time] = at.split('T');
  return `${humanDate(date)}, ${time}`;
}

/** Epoch ms of a local date+time; `tz` = JS getTimezoneOffset() of the user (minutes). */
export function localMs(date: string, time: string, tz?: number): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  if (tz === undefined) return new Date(y, mo - 1, d, h, m, 0, 0).getTime();
  return Date.UTC(y, mo - 1, d, h, m) + tz * 60_000;
}

const dayLabel = (date: string) => `${WD[(fromKey(date).getDay() + 6) % 7]}, ${humanDate(date, { relative: false })}`;

export interface ReminderInstance {
  rid: string;
  at: number;
  text: string;
}

interface Opts {
  now?: number;
  /** The user's local today (YYYY-MM-DD). */
  today: string;
  /** User timezone (getTimezoneOffset); omit to use the runtime's local time. */
  tz?: number;
}

/** All reminders that should fire in the next WINDOW_DAYS. */
export function reminderInstances(events: CalendarEvent[], tasks: Task[], { now = Date.now(), today, tz }: Opts): ReminderInstance[] {
  const out: ReminderInstance[] = [];
  const to = addDays(today, WINDOW_DAYS);

  for (const e of events) {
    if (!e.remind) continue;
    const offset = e.remind.offset ?? 0;
    // Look a bit further too: a "1 day before" reminder for an occurrence just past the window.
    for (const d of occurrencesBetween(e, today, addDays(to, Math.ceil(offset / 1440)))) {
      const at = localMs(d, e.start, tz) - offset * 60_000;
      if (at < now - 60_000 || at > now + WINDOW_DAYS * 86_400_000) continue;
      out.push({
        rid: `e:${e.id}:${d}`,
        at,
        text: `⏰ ${e.title}\n${dayLabel(d)}, ${e.start}–${e.end}${offset ? `\nНачало ${offsetLabel(offset).replace('за ', 'через ')}` : ''}${e.note ? `\n📝 ${e.note}` : ''}`,
      });
    }
  }

  for (const t of tasks) {
    if (!t.remind || t.done) continue;
    let at: number | undefined;
    if (t.remind.at) {
      const [d, time] = t.remind.at.split('T');
      at = localMs(d, time, tz);
    } else if (t.date) {
      at = localMs(t.date, t.time ?? '09:00', tz) - (t.remind.offset ?? 0) * 60_000;
    }
    if (at === undefined || at < now - 60_000) continue;
    out.push({
      rid: `t:${t.id}`,
      at,
      text: `⏰ ${t.title}${t.date ? `\nСрок: ${dayLabel(t.date)}${t.time ? `, ${t.time}` : ''}` : ''}${t.note ? `\n📝 ${t.note}` : ''}`,
    });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 300);
}
