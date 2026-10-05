/**
 * Morning / evening summary the bot sends ("☀️ Доброе утро! … события … задачи …").
 * Pure: builds the message from the user's server-side document.
 */
import type { PlannerDoc } from '../../src/lib/merge';
import { addDays } from '../../src/lib/date';
import { occurrencesBetween } from '../../src/lib/recurrence';

export interface DigestSettings {
  morning: boolean;
  morningTime: string;
  evening: boolean;
  eveningTime: string;
}

export const DEFAULT_DIGEST: DigestSettings = { morning: true, morningTime: '08:00', evening: false, eveningTime: '21:00' };

const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

function dayTitle(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  const wd = WD[d.getUTCDay()];
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export interface Digest {
  text: string;
  /** Nothing planned that day. */
  empty: boolean;
}

/** kind 'morning' → the plan for `today`; 'evening' → the plan for tomorrow. */
export function buildDigest(doc: PlannerDoc, today: string, kind: 'morning' | 'evening'): Digest {
  const day = kind === 'morning' ? today : addDays(today, 1);
  const events = doc.events
    .filter((e) => occurrencesBetween(e, day, day).length)
    .sort((a, b) => a.start.localeCompare(b.start));
  const tasks = doc.tasks.filter((t) => !t.done && t.date === day).sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));
  const overdue = kind === 'morning' ? doc.tasks.filter((t) => !t.done && t.date && t.date < today) : [];
  const empty = !events.length && !tasks.length && !overdue.length;

  const head = kind === 'morning' ? `☀️ <b>Доброе утро! ${dayTitle(day)}</b>` : `🌙 <b>Завтра, ${dayTitle(day).replace(/^[^,]+, /, '')}</b>`;
  if (empty) {
    return {
      empty,
      text:
        kind === 'morning'
          ? `${head}\n\nНа сегодня пока ничего не запланировано. Скажите, что сделать, — я запишу.`
          : `${head}\n\nНа завтра пока пусто. Запланировать что-нибудь?`,
    };
  }

  const lines = [head];
  if (events.length) {
    lines.push('', '📅 <b>События</b>');
    for (const e of events.slice(0, 12)) {
      const extras = [e.remind ? '🔔' : '', e.note ? `· 📝 ${esc(e.note.split('\n')[0].slice(0, 60))}` : ''].filter(Boolean).join(' ');
      lines.push(`${e.start === '00:00' && e.end === '23:59' ? 'весь день' : `${e.start}–${e.end}`} ${esc(e.title)}${extras ? ` ${extras}` : ''}`);
    }
    if (events.length > 12) lines.push(`…и ещё ${events.length - 12}`);
  }
  if (tasks.length) {
    lines.push('', `✅ <b>Задачи ${kind === 'morning' ? 'на сегодня' : 'на завтра'}</b>`);
    for (const t of tasks.slice(0, 12)) lines.push(`• ${t.time ? `${t.time} ` : ''}${esc(t.title)}`);
    if (tasks.length > 12) lines.push(`…и ещё ${tasks.length - 12}`);
  }
  if (overdue.length) {
    lines.push('', `⚠️ <b>Просрочено</b>`);
    for (const t of overdue.slice(0, 5)) lines.push(`• ${esc(t.title)}`);
    if (overdue.length > 5) lines.push(`…и ещё ${overdue.length - 5}`);
  }
  return { empty, text: lines.join('\n') };
}

/** Minutes since local midnight for "HH:MM". */
export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
