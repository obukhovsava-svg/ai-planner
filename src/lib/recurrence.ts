import type { CalendarEvent, DateKey, Repeat } from '@/types';
import { addDays, diffDays, fromKey, startOfWeek, toKey, weekdayMon } from './date';

/** All dates in [from, to] (inclusive) on which the event takes place. */
export function occurrencesBetween(e: CalendarEvent, from: DateKey, to: DateKey): DateKey[] {
  const r = e.repeat;
  if (!r) return e.date >= from && e.date <= to ? [e.date] : [];

  const end = r.until && r.until < to ? r.until : to;
  if (end < e.date || end < from) return [];
  const skip = new Set(r.exceptions ?? []);
  const out: DateKey[] = [];
  const first = from > e.date ? from : e.date;

  // Shift rota: `on` days working, `off` days free, repeating from the start date.
  if (r.freq === 'day' && r.cycle) {
    const len = r.cycle.on + r.cycle.off;
    for (let d = first; d <= end; d = addDays(d, 1)) {
      if (diffDays(d, e.date) % len < r.cycle.on && !skip.has(d)) out.push(d);
    }
    return out;
  }

  // Specific weekdays every N weeks (по будням, пн и ср…).
  if (r.freq === 'week' && r.byWeekday?.length) {
    const days = new Set(r.byWeekday);
    const week0 = startOfWeek(e.date);
    for (let d = first; d <= end; d = addDays(d, 1)) {
      const weekIdx = diffDays(startOfWeek(d), week0) / 7;
      if (weekIdx % r.interval === 0 && days.has(weekdayMon(fromKey(d))) && !skip.has(d)) out.push(d);
    }
    return out;
  }

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

/** First occurrence on or after `from` (within a year), if any. */
export function nextOccurrence(e: CalendarEvent, from: DateKey): DateKey | undefined {
  return occurrencesBetween(e, from, addDays(from, 366))[0];
}

export const REPEAT_OPTIONS: { label: string; value: Repeat | null }[] = [
  { label: 'Никогда', value: null },
  { label: 'Каждый день', value: { freq: 'day', interval: 1 } },
  { label: 'По будням', value: { freq: 'week', interval: 1, byWeekday: [0, 1, 2, 3, 4] } },
  { label: 'Каждую неделю', value: { freq: 'week', interval: 1 } },
  { label: 'Каждые 2 недели', value: { freq: 'week', interval: 2 } },
  { label: 'Каждые 3 недели', value: { freq: 'week', interval: 3 } },
  { label: 'Каждый месяц', value: { freq: 'month', interval: 1 } },
  { label: 'Каждый год', value: { freq: 'year', interval: 1 } },
];

const key = (r: Repeat) => JSON.stringify([r.freq, r.interval, r.byWeekday ?? [], r.cycle ?? null]);

export function sameRule(a: Repeat | null | undefined, b: Repeat | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return key(a) === key(b);
}

const WD_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export function repeatLabel(r: Repeat | null | undefined): string {
  if (!r) return 'Никогда';
  const known = REPEAT_OPTIONS.find((o) => sameRule(o.value, r));
  if (known) return known.label;
  if (r.cycle) return `График ${r.cycle.on}/${r.cycle.off}`;
  if (r.byWeekday?.length) {
    const days = [...r.byWeekday].sort();
    if (days.join() === '5,6') return 'По выходным';
    const list = `По ${days.map((d) => WD_SHORT[d]).join(', ')}`;
    return r.interval > 1 ? `${list} (раз в ${r.interval} нед.)` : list;
  }
  const unit = { day: 'дн.', week: 'нед.', month: 'мес.', year: 'г.' }[r.freq];
  return `Каждые ${r.interval} ${unit}`;
}
