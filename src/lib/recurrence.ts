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

  // "каждый второй вторник", "последняя пятница месяца", "последний день месяца"
  if (r.freq === 'month' && r.nth) {
    const start = fromKey(e.date);
    const f = fromKey(first);
    const k0 = Math.max(0, (f.getFullYear() - start.getFullYear()) * 12 + (f.getMonth() - start.getMonth()) - 1);
    for (let k = Math.floor(k0 / r.interval) * r.interval; ; k += r.interval) {
      const y = start.getFullYear();
      const m = start.getMonth() + k;
      if (toKey(new Date(y, m, 1)) > end) break;
      const d = nthOfMonth(y, m, r.nth, r.byWeekday?.[0]);
      if (d && d >= first && d <= end && !skip.has(d)) out.push(d);
    }
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

/** The `nth` weekday (Mon=0) of a month; nth −1 = the last one. Without a weekday: day `nth` / the last day. */
export function nthOfMonth(year: number, month: number, nth: number, weekday?: number): DateKey | undefined {
  const last = new Date(year, month + 1, 0);
  if (weekday === undefined) return toKey(nth === -1 ? last : new Date(year, month, nth));
  if (nth === -1) return toKey(new Date(year, month, last.getDate() - ((weekdayMon(last) - weekday + 7) % 7)));
  const firstDay = new Date(year, month, 1);
  const day = 1 + ((weekday - weekdayMon(firstDay) + 7) % 7) + (nth - 1) * 7;
  return day <= last.getDate() ? toKey(new Date(year, month, day)) : undefined;
}

/** Cleans a repeat rule from an untrusted source (the model, synced data). */
export function sanitizeRepeat(r: any): Repeat | undefined {
  const int = (v: unknown, min: number, max: number) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : undefined);
  if (!r || !['day', 'week', 'month', 'year'].includes(r.freq)) return undefined;
  const rep: Repeat = { freq: r.freq, interval: int(r.interval, 1, 52) ?? 1 };
  const days = Array.isArray(r.byWeekday) ? [...new Set<number>(r.byWeekday.filter((d: unknown) => int(d, 0, 6) !== undefined))].sort() : [];
  const nth = int(r.nth, -1, 5);
  if (rep.freq === 'month' && nth) {
    rep.nth = nth;
    if (days.length) rep.byWeekday = [days[0]];
  } else if (rep.freq === 'week' && days.length) rep.byWeekday = days;
  const on = int(r.cycle?.on, 1, 14);
  const off = int(r.cycle?.off, 1, 14);
  if (rep.freq === 'day' && on && off) rep.cycle = { on, off };
  if (typeof r.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.until)) rep.until = r.until;
  return rep;
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

const key = (r: Repeat) => JSON.stringify([r.freq, r.interval, r.byWeekday ?? [], r.cycle ?? null, r.nth ?? null]);

export function sameRule(a: Repeat | null | undefined, b: Repeat | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return key(a) === key(b);
}

const WD_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const WD_ACC = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function repeatLabel(r: Repeat | null | undefined): string {
  if (!r) return 'Никогда';
  const base = baseLabel(r);
  if (!r.until) return base;
  const u = fromKey(r.until);
  return `${base} до ${u.getDate()} ${MONTHS_GEN[u.getMonth()]}`;
}

function baseLabel(r: Repeat): string {
  if (r.freq === 'month' && r.nth) {
    const wd = r.byWeekday?.[0];
    if (wd === undefined) return r.nth === -1 ? 'Последний день месяца' : `Каждое ${r.nth} число`;
    const fem = wd === 2 || wd === 4 || wd === 5;
    const ord = r.nth === -1 ? (fem ? 'последнюю' : wd === 6 ? 'последнее' : 'последний') : `${r.nth}-${fem ? 'ю' : wd === 6 ? 'е' : 'й'}`;
    return `${fem ? 'Каждую' : wd === 6 ? 'Каждое' : 'Каждый'} ${ord} ${WD_ACC[wd]} месяца`;
  }
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
