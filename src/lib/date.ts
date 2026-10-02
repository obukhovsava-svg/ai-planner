import type { DateKey, TimeStr } from '@/types';

const pad = (n: number) => String(n).padStart(2, '0');

export function toKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(): DateKey {
  return toKey(new Date());
}

export function addDays(key: DateKey, days: number): DateKey {
  const d = fromKey(key);
  d.setDate(d.getDate() + days);
  return toKey(d);
}

export function addMonths(key: DateKey, months: number): DateKey {
  const d = fromKey(key);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toKey(d);
}

/** Monday-based weekday index: Mon=0 … Sun=6. */
export function weekdayMon(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function startOfWeek(key: DateKey): DateKey {
  return addDays(key, -weekdayMon(fromKey(key)));
}

export function weekDays(key: DateKey): DateKey[] {
  const start = startOfWeek(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** 6×7 grid of date keys covering the month of `key` (Monday-first). */
export function monthGrid(key: DateKey): DateKey[] {
  const d = fromKey(key);
  const first = toKey(new Date(d.getFullYear(), d.getMonth(), 1));
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function sameMonth(a: DateKey, b: DateKey): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((fromKey(a).getTime() - fromKey(b).getTime()) / 86_400_000);
}

export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const MONTHS_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

export function monthTitle(key: DateKey): string {
  const d = fromKey(key);
  return `${MONTHS_NOM[d.getMonth()]} ${d.getFullYear()}`;
}

/** "2 октября", "сегодня", "завтра" … */
export function humanDate(key: DateKey, opts: { relative?: boolean } = { relative: true }): string {
  if (opts.relative) {
    const diff = diffDays(key, todayKey());
    if (diff === 0) return 'Сегодня';
    if (diff === 1) return 'Завтра';
    if (diff === -1) return 'Вчера';
  }
  const d = fromKey(key);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}

export function longDate(key: DateKey): string {
  const d = fromKey(key);
  const wd = d.toLocaleDateString('ru-RU', { weekday: 'long' });
  return `${wd[0].toUpperCase()}${wd.slice(1)}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

export function timeToMinutes(t: TimeStr): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(min: number): TimeStr {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, min));
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

export function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** Number of week rows the month of `key` actually occupies (4–6). */
export function monthRows(key: DateKey): number {
  const d = fromKey(key);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return Math.ceil((weekdayMon(first) + days) / 7);
}
