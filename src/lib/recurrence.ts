import type { CalendarEvent, DateKey, Repeat } from '@/types';
import { addDays, diffDays, fromKey, toKey } from './date';

/** All dates in [from, to] (inclusive) on which the event takes place. */
export function occurrencesBetween(e: CalendarEvent, from: DateKey, to: DateKey): DateKey[] {
  const r = e.repeat;
  if (!r) return e.date >= from && e.date <= to ? [e.date] : [];

  const end = r.until && r.until < to ? r.until : to;
  if (end < e.date || end < from) return [];
  const skip = new Set(r.exceptions ?? []);
  const out: DateKey[] = [];

  if (r.freq === 'day' || r.freq === 'week') {
    const step = r.interval * (r.freq === 'week' ? 7 : 1);
    const k = Math.max(0, Math.ceil(diffDays(from, e.date) / step));
    for (let d = addDays(e.date, k * step); d <= end; d = addDays(d, step)) if (!skip.has(d)) out.push(d);
    return out;
  }

  // Monthly / yearly: same day of month; months without that day are skipped (as in iOS).
  const step = r.freq === 'year' ? 12 * r.interval : r.interval;
  const start = fromKey(e.date);
  const f = fromKey(from);
  const monthsToFrom = (f.getFullYear() - start.getFullYear()) * 12 + (f.getMonth() - start.getMonth());
  for (let k = Math.max(0, Math.floor(monthsToFrom / step)); ; k++) {
    const y = start.getFullYear();
    const m = start.getMonth() + k * step;
    if (toKey(new Date(y, m, 1)) > end) break;
    if (start.getDate() > new Date(y, m + 1, 0).getDate()) continue;
    const d = toKey(new Date(y, m, start.getDate()));
    if (d >= from && d <= end && !skip.has(d)) out.push(d);
  }
  return out;
}

export function occursOn(e: CalendarEvent, date: DateKey): boolean {
  return occurrencesBetween(e, date, date).length > 0;
}

export const REPEAT_OPTIONS: { label: string; value: Repeat | null }[] = [
  { label: 'Никогда', value: null },
  { label: 'Каждый день', value: { freq: 'day', interval: 1 } },
  { label: 'Каждую неделю', value: { freq: 'week', interval: 1 } },
  { label: 'Каждые 2 недели', value: { freq: 'week', interval: 2 } },
  { label: 'Каждые 3 недели', value: { freq: 'week', interval: 3 } },
  { label: 'Каждый месяц', value: { freq: 'month', interval: 1 } },
  { label: 'Каждый год', value: { freq: 'year', interval: 1 } },
];

export function sameRule(a: Repeat | null | undefined, b: Repeat | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.freq === b.freq && a.interval === b.interval;
}

export function repeatLabel(r: Repeat | null | undefined): string {
  if (!r) return 'Никогда';
  const known = REPEAT_OPTIONS.find((o) => sameRule(o.value, r));
  if (known) return known.label;
  const unit = { day: 'дн.', week: 'нед.', month: 'мес.', year: 'г.' }[r.freq];
  return `Каждые ${r.interval} ${unit}`;
}
