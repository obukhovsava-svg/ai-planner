/**
 * Runs assistant actions (as parsed by the model) directly on the user's server-side planner
 * document — used by the iPhone Shortcut, so nothing has to wait for the app to open.
 * Anything that needs a human decision (bulk deletes, ambiguous matches, missing details)
 * is returned as `unresolved` and finished by the app's assistant later.
 */
import type { CalendarEvent, Task } from '../../src/types';
import type { PlannerDoc } from '../../src/lib/merge';
import { addDays, minutesToTime, timeToMinutes } from '../../src/lib/date';
import { nextOccurrence, occurrencesBetween, occursOn, sanitizeRepeat } from '../../src/lib/recurrence';

const COLOR = { work: 'blue', personal: 'violet', health: 'red', study: 'amber', other: 'green' } as const;
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function dayText(key: string, today: string): string {
  if (key === today) return 'сегодня';
  if (key === addDays(today, 1)) return 'завтра';
  const d = new Date(`${key}T00:00:00Z`);
  return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}`;
}

/* fuzzy title matching ("встречу" ≈ "встреча") */
const STOP = new Set(['событи', 'задач', 'мою', 'мой', 'мне', 'для', 'это', 'все', 'всё']);
const stems = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\d]+/u)
    .filter((w) => w.length >= 3)
    .map((w) => w.slice(0, Math.min(5, Math.max(3, w.length - 1))))
    .filter((w) => !STOP.has(w));
function score(query: string, title: string) {
  const q = stems(query);
  if (!q.length) return 0;
  const t = stems(title);
  return q.filter((s) => t.some((w) => w.startsWith(s) || s.startsWith(w))).length / q.length;
}

type Hit = { kind: 'event'; item: CalendarEvent; date?: string } | { kind: 'task'; item: Task; date?: string };

/** The single best match, or null when nothing / several equally good things match. */
function findOne(doc: PlannerDoc, query: string, date: string | undefined, today: string, kinds: ('event' | 'task')[]): Hit | null {
  const hits: (Hit & { s: number })[] = [];
  if (kinds.includes('event')) {
    for (const e of doc.events) {
      const s = score(query, e.title);
      if (s < 0.5) continue;
      const occ = date ? (occursOn(e, date) ? date : undefined) : (nextOccurrence(e, today) ?? (e.repeat ? undefined : e.date));
      if (date && !occ) continue;
      hits.push({ kind: 'event', item: e, date: occ, s });
    }
  }
  if (kinds.includes('task')) {
    for (const t of doc.tasks) {
      const s = score(query, t.title) - (t.done ? 0.3 : 0);
      if (s < 0.5 || (date && t.date !== date)) continue;
      hits.push({ kind: 'task', item: t, date: t.date, s });
    }
  }
  hits.sort((a, b) => b.s - a.s);
  if (!hits.length || (hits[1] && hits[1].s >= hits[0].s - 0.01)) return null;
  return hits[0];
}

export interface ExecResult {
  doc: PlannerDoc;
  /** Human lines for the bot ("записал встречу «…» — завтра, 15:00–16:00"). */
  lines: string[];
  /** Actions the app's assistant has to finish (with the user). */
  unresolved: any[];
}

export function execute(input: PlannerDoc, actions: any[], ctx: { today: string; now: number; nowMinutes?: number; newId(): string }): ExecResult {
  const doc: PlannerDoc = { tasks: [...input.tasks], events: [...input.events], deleted: { ...input.deleted } };
  const lines: string[] = [];
  const unresolved: any[] = [];
  const { today, now } = ctx;
  const str = (v: unknown, re: RegExp) => (typeof v === 'string' && re.test(v) ? v : undefined);

  const touchEvent = (id: string, patch: Partial<CalendarEvent>) => {
    doc.events = doc.events.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: now } : e));
  };
  const touchTask = (id: string, patch: Partial<Task>) => {
    doc.tasks = doc.tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: now } : t));
  };
  const remove = (hit: Hit) => {
    if (hit.kind === 'event') doc.events = doc.events.filter((e) => e.id !== hit.item.id);
    else doc.tasks = doc.tasks.filter((t) => t.id !== hit.item.id);
    doc.deleted[hit.item.id] = now;
  };
  const when = (date?: string, time?: string) => [date && dayText(date, today), time].filter(Boolean).join(', ');

  for (let a of actions) {
    const title = String(a.title ?? '').trim();
    let date = str(a.date, DATE);
    let start = str(a.start, TIME);
    const end = str(a.end, TIME);
    const kinds: ('event' | 'task')[] = a.targetKind === 'task' ? ['task'] : a.targetKind === 'event' ? ['event'] : ['event', 'task'];

    switch (a.intent) {
      case 'create':
      case 'remind': {
        if (a.intent === 'remind') {
          // "отключи все напоминания"
          if (a.remindCancel && a.all && !title) {
            const evs = doc.events.filter((e) => e.remind);
            const tks = doc.tasks.filter((t) => t.remind && !t.done);
            for (const e of evs) touchEvent(e.id, { remind: undefined });
            for (const t of tks) touchTask(t.id, { remind: undefined });
            lines.push(evs.length + tks.length ? `выключил все напоминания (${evs.length + tks.length})` : 'напоминаний нет');
            break;
          }
          const hit = title ? findOne(doc, title, date, today, kinds) : null;
          if (hit) {
            if (a.remindCancel) {
              hit.kind === 'event' ? touchEvent(hit.item.id, { remind: undefined }) : touchTask(hit.item.id, { remind: undefined });
              lines.push(`выключил напоминание для «${hit.item.title}»`);
            } else if (typeof a.remindAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(a.remindAt)) {
              // "напомни о созвоне в 16:55": tasks keep the moment, events get "N minutes before"
              const at: string = a.remindAt;
              const before = hit.kind === 'event' && hit.date ? Math.round((Date.parse(`${hit.date}T${hit.item.start}Z`) - Date.parse(`${at}Z`)) / 60_000) : -1;
              if (hit.kind === 'task') touchTask(hit.item.id, { remind: { at } });
              else if (before >= 0) touchEvent(hit.item.id, { remind: { offset: before } });
              else {
                unresolved.push(a);
                break;
              }
              lines.push(`напомню о «${hit.item.title}» ${dayText(at.slice(0, 10), today)} в ${at.slice(11)}`);
            } else if (hit.kind === 'task' && !hit.item.date) {
              unresolved.push(a); // needs a moment to remind at
            } else {
              const offset = typeof a.remindOffset === 'number' ? a.remindOffset : 30;
              hit.kind === 'event' ? touchEvent(hit.item.id, { remind: { offset } }) : touchTask(hit.item.id, { remind: { offset } });
              lines.push(`напомню о «${hit.item.title}» ${offset ? `за ${offset >= 1440 ? `${Math.round(offset / 1440)} дн.` : offset >= 60 ? `${Math.round((offset / 60) * 10) / 10} ч` : `${offset} мин`}` : 'вовремя'}`);
            }
            break;
          }
          if (a.remindCancel || !title) {
            unresolved.push(a);
            break;
          }
          // Nothing like it yet → create it with the reminder (at the said moment, if any).
          a = typeof a.remindAt === 'string' && a.remindAt.includes('T')
            ? { ...a, remind: true, remindOffset: 0, kindWord: 'task', date: a.remindAt.slice(0, 10), start: a.remindAt.slice(11) }
            : { ...a, remind: true };
          date = str(a.date, DATE);
          start = str(a.start, TIME);
        }
        const isEvent =
          a.kindWord === 'event' ||
          (a.kindWord !== 'task' && (Boolean(a.repeat) || (a.eventHint && !(a.taskHint && !a.eventHint)) || Boolean(date && start && end) || (Boolean(start) && !a.taskHint)));
        const category = (['work', 'personal', 'health', 'study', 'other'] as const).includes(a.category) ? a.category : 'other';
        // An event needs a day, a start and an end (or a duration). Missing → the app asks.
        if (isEvent && (!start || (!date && !a.repeat) || (!end && !Number.isInteger(a.duration)) || a.needsStart)) {
          unresolved.push(a);
          break;
        }
        if (isEvent && start) {
          const repeat = sanitizeRepeat(a.repeat);
          let d = date ?? today;
          // A repeating event starts on its first real occurrence ("каждый второй вторник" said on a Sunday).
          if (repeat) d = nextOccurrence({ id: '', title: '', date: d, start, end: start, color: 'blue', repeat, createdAt: 0 }, d) ?? d;
          const e = end ?? minutesToTime(timeToMinutes(start) + (Number.isInteger(a.duration) ? a.duration : 60));
          const ev: CalendarEvent = {
            id: ctx.newId(),
            title: title || 'Событие',
            date: d,
            start,
            end: e,
            color: COLOR[category as keyof typeof COLOR],
            repeat,
            note: typeof a.note === 'string' && a.note.trim() ? a.note.trim().slice(0, 2000) : undefined,
            remind: a.remind ? { offset: typeof a.remindOffset === 'number' ? a.remindOffset : 30 } : undefined,
            createdAt: now,
            updatedAt: now,
          };
          doc.events.push(ev);
          const lower = ev.title.toLowerCase();
          const noun = /встреч/.test(lower) ? 'встречу' : /смен/.test(lower) ? 'смену' : /тренир/.test(lower) ? 'тренировку' : /созвон/.test(lower) ? 'созвон' : 'событие';
          lines.push(`записал ${noun} «${ev.title}» — ${when(d)}, ${start}–${e}${ev.repeat ? ', с повтором' : ''}${ev.remind ? ', напомню' : ''}`);
        } else {
          const remind = a.remind ? { offset: typeof a.remindOffset === 'number' ? a.remindOffset : 0 } : undefined;
          const task: Task = {
            id: ctx.newId(),
            title: title || 'Задача',
            done: false,
            // "напомни в 18": today, or tomorrow if that time has passed
            date: date ?? (remind ? (start && ctx.nowMinutes !== undefined && timeToMinutes(start) <= ctx.nowMinutes ? addDays(today, 1) : today) : undefined),
            time: start,
            priority: (['low', 'medium', 'high'] as const).includes(a.priority) ? a.priority : 'medium',
            category,
            remind,
            note: typeof a.note === 'string' && a.note.trim() ? a.note.trim().slice(0, 2000) : undefined,
            createdAt: now,
            updatedAt: now,
          };
          doc.tasks.unshift(task);
          const noun = /домашк|дз|домашн|урок/.test(task.title.toLowerCase()) ? 'домашку' : 'задачу';
          const w = when(task.date, task.time);
          lines.push(`записал ${noun} «${task.title}»${w ? ` — ${w}` : ''}${remind ? ', напомню' : ''}`);
        }
        break;
      }
      case 'note': {
        const mode = ['append', 'replace', 'clear', 'read'].includes(a.noteMode) ? a.noteMode : 'append';
        let text = typeof a.note === 'string' && a.note.trim() ? a.note.trim().slice(0, 2000) : undefined;
        let hit = title ? findOne(doc, title, date, today, kinds) : null;
        // "допиши к встрече с Анной взять паспорт": the longest leading part that matches an item
        if (!text && (mode === 'append' || mode === 'replace') && title) {
          hit = null;
          const words = title.split(/\s+/);
          for (let k = words.length - 1; k >= 1 && !hit; k--) {
            const h = findOne(doc, words.slice(0, k).join(' '), date, today, kinds);
            if (h && score(words.slice(0, k).join(' '), h.item.title) >= 0.99) {
              hit = h;
              text = words.slice(k).join(' ');
            }
          }
        }
        if (!hit || ((mode === 'append' || mode === 'replace') && !text)) {
          unresolved.push(a);
          break;
        }
        const old = hit.item.note?.trim() ?? '';
        if (mode === 'read') {
          lines.push(old ? `заметка к «${hit.item.title}»: ${old}` : `у «${hit.item.title}» нет заметки`);
          break;
        }
        const note = mode === 'clear' ? undefined : mode === 'replace' || !old ? text : `${old}\n${text}`;
        hit.kind === 'event' ? touchEvent(hit.item.id, { note }) : touchTask(hit.item.id, { note });
        lines.push(mode === 'clear' ? `очистил заметку к «${hit.item.title}»` : `${old && mode === 'append' ? 'дописал' : 'записал'} в заметку к «${hit.item.title}»: ${text}`);
        break;
      }
      case 'complete': {
        const hit = findOne(doc, title, undefined, today, ['task']);
        if (!hit || hit.kind !== 'task') {
          unresolved.push(a);
          break;
        }
        touchTask(hit.item.id, { done: true, completedAt: now });
        lines.push(`отметил «${hit.item.title}» выполненной`);
        break;
      }
      case 'delete': {
        if (a.bulk || !title) {
          unresolved.push(a); // needs confirmation / a choice
          break;
        }
        const hit = findOne(doc, title, date, today, kinds);
        if (!hit) {
          unresolved.push(a);
          break;
        }
        if (hit.kind === 'event' && hit.item.repeat && hit.date && !a.all) {
          touchEvent(hit.item.id, { repeat: { ...hit.item.repeat, exceptions: [...(hit.item.repeat.exceptions ?? []), hit.date] } });
          lines.push(`убрал «${hit.item.title}» ${dayText(hit.date, today)}`);
        } else {
          remove(hit);
          lines.push(`удалил «${hit.item.title}»`);
        }
        break;
      }
      case 'move': {
        const src = str(a.sourceDate, DATE);
        const shift = Number.isInteger(a.shift) && a.shift !== 0 ? (a.shift as number) : 0;
        const hit = title && (date || start || shift) ? findOne(doc, title, src, today, kinds) : null;
        if (!hit) {
          unresolved.push(a);
          break;
        }
        // "на час позже": the same thing, moved by `shift` minutes (across midnight if needed)
        const moveBy = (d0: string, t0: string | undefined) => {
          if (!t0) return { d: addDays(d0, Math.round(shift / 1440)), t: undefined };
          const total = timeToMinutes(t0) + shift;
          const days = Math.floor(total / 1440);
          return { d: addDays(d0, days), t: minutesToTime(total - days * 1440) };
        };
        if (hit.kind === 'task') {
          const m = shift ? moveBy(hit.item.date ?? today, hit.item.time) : null;
          const nd = m ? m.d : (date ?? hit.item.date);
          const nt = m ? m.t : (start ?? hit.item.time);
          touchTask(hit.item.id, { date: nd, time: nt });
          lines.push(`перенёс «${hit.item.title}» на ${when(nd, nt)}`);
          break;
        }
        const ev = hit.item;
        const len = timeToMinutes(ev.end) - timeToMinutes(ev.start);
        const m = shift ? moveBy(hit.date ?? ev.date, ev.start) : null;
        const s = m?.t ?? start ?? ev.start;
        const e = m ? minutesToTime(Math.min(timeToMinutes(s) + len, 23 * 60 + 59)) : (end ?? minutesToTime(timeToMinutes(s) + len));
        const d = m?.d ?? date ?? hit.date ?? ev.date;
        if (ev.repeat && hit.date) {
          touchEvent(ev.id, { repeat: { ...ev.repeat, exceptions: [...(ev.repeat.exceptions ?? []), hit.date] } });
          doc.events.push({ id: ctx.newId(), title: ev.title, date: d, start: s, end: e, color: ev.color, createdAt: now, updatedAt: now });
        } else touchEvent(ev.id, { date: d, start: s, end: e });
        lines.push(`перенёс «${ev.title}» на ${when(d)}, ${s}–${e}`);
        break;
      }
      case 'agenda': {
        const from = str(a.range?.from, DATE) ?? date ?? today;
        const to = str(a.range?.to, DATE) ?? from;
        const items: string[] = [];
        for (let d = from; d <= to && items.length < 25; d = addDays(d, 1)) {
          const evs = doc.events.filter((e) => occurrencesBetween(e, d, d).length).sort((x, y) => x.start.localeCompare(y.start));
          const tks = doc.tasks.filter((t) => t.date === d && !t.done);
          if (!evs.length && !tks.length) continue;
          items.push(`${dayText(d, today)}:${evs.map((e) => `\n  ${e.start} ${e.title}`).join('')}${tks.map((t) => `\n  ☐ ${t.title}`).join('')}`);
        }
        lines.push(items.length ? `вот расписание:\n${items.join('\n')}` : 'ничего не запланировано');
        break;
      }
      default:
        unresolved.push(a);
    }
  }
  return { doc, lines, unresolved };
}
