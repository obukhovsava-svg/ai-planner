/**
 * The assistant's decision layer.
 *
 * Rules:
 *  • date + start + end known            → calendar event, created right away;
 *  • no time at all                       → task (unless it clearly is an event — then ask the time);
 *  • something is missing or ambiguous    → ask, with a mini picker card in the chat.
 * The user can answer by tapping the card or by typing ("в 15", "на час", "завтра", "задачей").
 *
 * Understanding comes from the AI worker (lib/ai.ts → /worker) when it is configured and
 * reachable, otherwise from the offline rules in lib/parser.ts — both produce `Analysis`.
 */
import type { CalendarEvent, DateKey, Task } from '@/types';
import { analyze, guardNoteMode, isConfident, normalizeAnswer, parseDurationText, parseOffsetText, splitRequests, type Analysis } from '@/lib/parser';
import { aiAnalyze } from '@/lib/ai';
import { addDays, humanDate, minutesToTime, timeToMinutes, todayKey } from '@/lib/date';
import { CATEGORY_TO_COLOR } from '@/lib/meta';
import { matchScore } from '@/lib/match';
import { saveDigest, serverSettingsAvailable } from '@/lib/settings';
import { useUIStore } from '@/store/useUIStore';
import { nextOccurrence, occurrencesBetween, occursOn, repeatLabel } from '@/lib/recurrence';
import { offsetLabel } from '@/lib/reminders';
import type { Reminder } from '@/types';
import { usePlannerStore } from '@/store/usePlannerStore';
import { useChatStore, type Ask, type Candidate, type ChatAttachment, type Draft } from '@/store/useChatStore';

export interface AssistantReply {
  text: string;
  attachment?: ChatAttachment;
}

const planner = () => usePlannerStore.getState();
const chat = () => useChatStore.getState();

/* ------------------------------------------------------------------ helpers */

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const when = (date?: DateKey) => (date ? lower(humanDate(date)) : '');

function durationLabel(min: number): string {
  if (min < 60) return `${min} мин`;
  const h = min / 60;
  return Number.isInteger(h) ? `${h} ч` : `${h.toString().replace('.', ',')} ч`;
}

/** Fuzzy matching across word forms ("учёбу" ≈ «Учеба») — see lib/match.ts. */
const score = matchScore;

/* ------------------------------------------------------------------ create */

function draftFrom(a: Analysis): Draft {
  let kind: Draft['kind'];
  if (a.kindWord) kind = a.kindWord;
  else if (a.repeat) kind = 'event';
  else if (a.taskHint && !a.eventHint) kind = 'task';
  else if (a.eventHint) kind = 'event';
  else if (a.date && a.start && a.end) kind = 'event';
  else if (a.start) kind = undefined; // has a time but nothing says "event" — ask
  else kind = 'task';

  // "напомни в 18" — today at 18:00, or tomorrow if that time has passed
  let date = a.date;
  if (!date && a.remind && a.start && kind === 'task') {
    const now = new Date();
    date = timeToMinutes(a.start) > now.getHours() * 60 + now.getMinutes() ? todayKey() : addDays(todayKey(), 1);
  }

  return {
    title: a.title || (kind === 'task' ? 'Новая задача' : 'Новое событие'),
    kind,
    date,
    start: a.start,
    end: a.end,
    duration: a.duration,
    note: a.note,
    repeat: a.repeat,
    needsStart: a.needsStart,
    priority: a.priority,
    category: a.category,
    remindOffset: a.remind ? (a.remindOffset ?? (kind === 'event' ? 30 : 0)) : undefined,
  };
}

function nextAsk(d: Draft): Ask | null {
  if (!d.kind) return 'kind';
  if (d.kind === 'task') {
    if (d.remindOffset === undefined) return null;
    if (!d.date) return 'date';
    if (!d.start) return 'time';
    return null;
  }
  if (d.needsStart) return 'start-day';
  if (!d.date) return 'date';
  if (!d.start) return 'time';
  if (!d.end && !d.duration) return 'end';
  return null;
}

function question(d: Draft, ask: Ask): string {
  const t = `«${d.title}»`;
  switch (ask) {
    case 'kind':
      return `${t} ${d.date ? when(d.date) : ''}${d.start ? ` в ${d.start}` : ''}. Добавить в календарь как событие или в задачи?`.replace(/\s+/g, ' ');
    case 'start-day':
      return `${t}: ${repeatLabel(d.repeat).toLowerCase()}${d.start ? `, ${d.start}–${d.end ?? '…'}` : ''}. С какого дня начинается график?`;
    case 'date':
      return d.kind === 'task' && d.remindOffset !== undefined ? `Когда напомнить: ${t}?` : `На какой день поставить ${t}?`;
    case 'time':
      return d.kind === 'task' && d.remindOffset !== undefined
        ? `Во сколько напомнить ${when(d.date)}?`
        : `Во сколько ${t}${d.date ? ` ${when(d.date)}` : ''}?`;
    case 'end':
      return `${t} ${when(d.date)} с ${d.start}. Сколько продлится?`;
  }
}

function commit(d: Draft): AssistantReply {
  const p = planner();
  if (d.kind === 'task') {
    const remind = d.remindOffset !== undefined ? { offset: d.remindOffset } : undefined;
    const task = p.addTask({ title: d.title, date: d.date, time: d.start, priority: d.priority, category: d.category, remind, note: d.note });
    chat().pushUndo({ op: 'created-task', id: task.id });
    return {
      text: remind
        ? `Напомню ${remind.offset ? offsetLabel(remind.offset) + ' до ' : ''}${when(task.date)}${task.time ? ` в ${task.time}` : ''}: «${task.title}».`
        : task.date
          ? `Создал задачу на ${when(task.date)}${task.time ? `, ${task.time}` : ''}.`
          : 'Добавил задачу во «Входящие».',
      attachment: { type: 'task', task },
    };
  }
  const start = d.start!;
  const end = d.end ?? minutesToTime(timeToMinutes(start) + (d.duration ?? 60));
  const remind = d.remindOffset !== undefined ? { offset: d.remindOffset } : undefined;
  // A repeating event starts on its first real occurrence.
  const date = d.repeat ? (nextOccurrence({ id: '', title: '', date: d.date!, start, end, color: 'blue', repeat: d.repeat, createdAt: 0 }, d.date!) ?? d.date!) : d.date!;
  const event = p.addEvent({ title: d.title, date, start, end, color: CATEGORY_TO_COLOR[d.category], repeat: d.repeat, remind, note: d.note });
  chat().pushUndo({ op: 'created-event', id: event.id });
  return {
    text: remind
      ? `Добавил в календарь: ${when(event.date)}, ${start}–${end}. Напомню ${offsetLabel(remind.offset)}.`
      : event.repeat
      ? `Готово: ${repeatLabel(event.repeat).toLowerCase()}, ${start}–${end}, начиная с ${humanDate(event.date, { relative: false })}.`
      : `Добавил в календарь: ${when(event.date)}, ${start}–${end}.`,
    attachment: { type: 'event', event },
  };
}

function proceed(d: Draft): AssistantReply {
  const ask = nextAsk(d);
  if (!ask) return commit(d);
  return { text: question(d, ask), attachment: { type: 'clarify', draft: d, ask } };
}

/** Applied when the user taps an option in a clarification card. */
export function answerClarify(messageId: string, patch: Partial<Draft>) {
  const msg = chat().messages.find((m) => m.id === messageId);
  if (!msg || msg.attachment?.type !== 'clarify' || msg.attachment.state) return;
  const reply = proceed({ ...msg.attachment.draft, ...patch });
  chat().update(messageId, reply);
}

export function cancelClarify(messageId: string) {
  const msg = chat().messages.find((m) => m.id === messageId);
  if (!msg || msg.attachment?.type !== 'clarify') return;
  chat().update(messageId, { text: 'Хорошо, не добавляю.', attachment: { ...msg.attachment, state: 'cancelled' } });
}

/** Typed answer to an open question: "в 15", "на час", "до 18", "завтра", "задачей", "отмена". */
function fillFromText(text: string, ask: Ask | 'move-date' | 'move-time', start?: string): Partial<Draft> | 'cancel' | null {
  // Same cleaning as requests: dictation punctuation, number words, fillers ("ну давай до семи.")
  const t = normalizeAnswer(text).toLowerCase();
  if (/^(нет|отмена|отмени|отменить|не надо|не нужно|забудь|стоп|передумал\p{L}*)(?![\p{L}])/u.test(t)) return 'cancel';
  if (/^(?:это\s+|как\s+|сделай\s+|в\s+)?(задач|задачей|задачу)/u.test(t)) return { kind: 'task' };
  if (/^(?:это\s+|как\s+|сделай\s+|в\s+)?(событи|календарь|событием|встреч)/u.test(t)) return { kind: 'event' };

  const patch: Partial<Draft> = {};
  const bare = t.match(/^(?:в\s+|к\s+|до\s+|на\s+)?(\d{1,2})(?:[:.\s](\d{2}))?(?:\s*час(?:а|ов)?)?(?:\s+(утра|дня|вечера|ночи))?$/u);
  if (bare) {
    let h = Number(bare[1]);
    const part = bare[3];
    if (part && /дня|вечера/u.test(part) && h < 12) h += 12;
    // "в 3" for an appointment means 15:00.
    else if (!part && !bare[2] && h >= 1 && h <= 6) h += 12;
    const isEnd = ask === 'end' || /^до/u.test(t);
    // "до семи" after an 18:00 start is 19:00
    if (isEnd && !part && start && h * 60 <= timeToMinutes(start) && h + 12 < 24) h += 12;
    if (h > 23) return null;
    const time = `${String(h).padStart(2, '0')}:${bare[2] ?? '00'}`;
    if (isEnd) patch.end = time;
    else patch.start = time;
    return patch;
  }
  const dur = parseDurationText(t);
  if (dur && ask === 'end') return { duration: dur };

  // Several requests in one message are never an answer.
  if (/[;\n]/u.test(text)) return null;
  const a = analyze(t);
  if (a.intent !== 'create' && !(a.intent === 'move' && ask.startsWith('move'))) return null;
  // Anything left besides date/time/filler words ("давай", "лучше") is a new request, not an answer.
  const rest = a.title.replace(/(?<![\p{L}])(давай(?:те)?|лучше|тогда|ну|ок|окей|можно|пусть|пожалуй|наверное|наверно|да|в|на|с|со)(?![\p{L}])/giu, '').trim();
  if (rest) return null;
  if (a.date) patch.date = a.date;
  if (a.start) patch.start = a.start;
  if (a.end) patch.end = a.end;
  if (a.duration) patch.duration = a.duration;
  if (ask === 'start-day' && a.date) patch.needsStart = false;
  if (a.kindWord) patch.kind = a.kindWord;
  return Object.keys(patch).length ? patch : null;
}

/* ------------------------------------------------------------------ find / act */

function findCandidates(query: string, date: DateKey | undefined, kinds: ('event' | 'task')[]): Candidate[] {
  const p = planner();
  const today = todayKey();
  const out: (Candidate & { score: number })[] = [];
  if (kinds.includes('event')) {
    for (const e of p.events) {
      const s = query ? score(query, e.title) : 1;
      if (s < 0.5) continue;
      const occ = date ? (occursOn(e, date) ? date : undefined) : (nextOccurrence(e, today) ?? (e.date < today ? undefined : e.date));
      if (date && !occ) continue;
      if (!occ && e.repeat) continue;
      out.push({ kind: 'event', id: e.id, title: e.title, date: occ ?? e.date, time: e.start, score: s });
    }
  }
  if (kinds.includes('task')) {
    for (const t of p.tasks) {
      const s = query ? score(query, t.title) : 1;
      if (s < 0.5 || (date && t.date !== date)) continue;
      out.push({ kind: 'task', id: t.id, title: t.title, date: t.date, time: t.time, score: s + (t.done ? -0.3 : 0) });
    }
  }
  out.sort((a, b) => b.score - a.score || (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  const best = out[0]?.score ?? 0;
  return out.filter((c) => c.score >= best - 0.01).slice(0, 5);
}

const candLabel = (c: Candidate) => `«${c.title}»${c.date ? ` ${when(c.date)}` : ''}${c.time ? ` в ${c.time}` : ''}`;

function doDelete(c: Candidate, all: boolean): AssistantReply {
  const p = planner();
  if (c.kind === 'task') {
    const removed = p.deleteTask(c.id);
    if (removed) chat().pushUndo({ op: 'deleted-task', task: removed });
    return { text: `Удалил задачу «${c.title}».`, attachment: { type: 'undo' } };
  }
  const ev = p.events.find((e) => e.id === c.id)!;
  if (ev.repeat && !all && c.date) {
    chat().pushUndo({ op: 'updated-event', before: ev });
    p.updateEvent(ev.id, { repeat: { ...ev.repeat, exceptions: [...(ev.repeat.exceptions ?? []), c.date] } });
    return { text: `Убрал «${c.title}» ${when(c.date)}. Остальные повторы остались — скажите «удали все», чтобы убрать серию.`, attachment: { type: 'undo' } };
  }
  const removed = p.deleteEvent(ev.id);
  if (removed) chat().pushUndo({ op: 'deleted-event', event: removed });
  return { text: ev.repeat ? `Удалил все повторы «${c.title}».` : `Удалил ${candLabel(c)}.`, attachment: { type: 'undo' } };
}

/** `shift`: minutes later (+) / earlier (−) — "на час позже". */
type MoveTarget = { date?: DateKey; start?: string; end?: string; duration?: number; shift?: number };

/** Date + time moved by `shift` minutes. */
function shifted(date: DateKey, time: string | undefined, shift: number): { date: DateKey; time?: string } {
  if (!time) return { date: addDays(date, Math.round(shift / 1440)) };
  const total = timeToMinutes(time) + shift;
  const days = Math.floor(total / 1440);
  return { date: addDays(date, days), time: minutesToTime(total - days * 1440) };
}

function doMove(c: Candidate, to: MoveTarget): AssistantReply {
  const p = planner();
  if (c.kind === 'task') {
    const before = p.tasks.find((t) => t.id === c.id)!;
    if (to.shift) {
      const s = shifted(before.date ?? todayKey(), before.time, to.shift);
      to = { date: s.date, start: s.time };
    }
    chat().pushUndo({ op: 'updated-task', before });
    p.updateTask(c.id, { date: to.date ?? before.date, time: to.start ?? before.time });
    return { text: `Перенёс задачу «${c.title}» на ${when(to.date ?? before.date)}${to.start ? `, ${to.start}` : ''}.`, attachment: { type: 'undo' } };
  }
  const ev = p.events.find((e) => e.id === c.id)!;
  const len = timeToMinutes(ev.end) - timeToMinutes(ev.start);
  if (to.shift) {
    const s = shifted(c.date ?? ev.date, ev.start, to.shift);
    to = { date: s.date, start: s.time };
  }
  const start = to.start ?? ev.start;
  const end = to.end ?? minutesToTime(timeToMinutes(start) + (to.duration ?? len));
  const date = to.date ?? c.date ?? ev.date;
  chat().pushUndo({ op: 'updated-event', before: ev });
  if (ev.repeat && c.date) {
    // Move one occurrence: skip it in the series and add a standalone copy.
    p.updateEvent(ev.id, { repeat: { ...ev.repeat, exceptions: [...(ev.repeat.exceptions ?? []), c.date] } });
    const copy = p.addEvent({ title: ev.title, date, start, end, color: ev.color, note: ev.note });
    chat().popUndo();
    chat().pushUndo({ op: 'batch', entries: [{ op: 'updated-event', before: ev }, { op: 'created-event', id: copy.id }] });
    return {
      text: `Перенёс «${ev.title}» с ${when(c.date)} на ${when(date)}, ${start}–${end}. Остальные повторы без изменений.`,
      attachment: { type: 'undo' },
    };
  }
  p.updateEvent(ev.id, { date, start, end });
  return { text: `Перенёс «${ev.title}» на ${when(date)}, ${start}–${end}.`, attachment: { type: 'undo' } };
}

function doComplete(c: Candidate): AssistantReply {
  const p = planner();
  const before = p.tasks.find((t) => t.id === c.id)!;
  if (before.done) return { text: `«${c.title}» уже отмечена выполненной.` };
  chat().pushUndo({ op: 'updated-task', before });
  p.toggleTask(c.id);
  return { text: `Отметил «${c.title}» выполненной. Так держать!`, attachment: { type: 'undo' } };
}

/** Applied when the user picks one of several matching items. */
export function answerChoose(messageId: string, candidate: Candidate) {
  const msg = chat().messages.find((m) => m.id === messageId);
  if (!msg || msg.attachment?.type !== 'choose' || msg.attachment.state) return;
  const { action, target } = msg.attachment;
  const reply =
    action === 'note'
      ? doNote(candidate, target?.noteMode ?? 'append', target?.note)
      : action === 'remind'
      ? target?.cancel
        ? doUnremind(candidate)
        : remindOrAsk(candidate, target?.offset)
      : action === 'delete'
      ? doDelete(candidate, Boolean(target?.all))
      : action === 'move'
        ? target?.date || target?.start || target?.shift
          ? doMove(candidate, target)
          : moveAsk(candidate)
        : doComplete(candidate);
  chat().update(messageId, { text: reply.text, attachment: reply.attachment ?? { ...msg.attachment, state: 'done' } });
}

/** Nearest upcoming events (occurrences) and open tasks — for "удали / перенеси" without a name. */
function upcoming(kinds: ('event' | 'task')[], date?: DateKey): Candidate[] {
  const p = planner();
  const from = date ?? todayKey();
  const to = date ?? addDays(from, 14);
  const out: Candidate[] = [];
  if (kinds.includes('event')) {
    for (const e of p.events) {
      for (const d of occurrencesBetween(e, from, to).slice(0, 2)) out.push({ kind: 'event', id: e.id, title: e.title, date: d, time: e.start });
    }
  }
  if (kinds.includes('task')) {
    for (const t of p.tasks) {
      if (t.done || (date && t.date !== date)) continue;
      out.push({ kind: 'task', id: t.id, title: t.title, date: t.date, time: t.time });
    }
  }
  return out
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || (a.time ?? '99').localeCompare(b.time ?? '99'))
    .slice(0, 6);
}

function moveAsk(c: Candidate): AssistantReply {
  return { text: `На какой день перенести ${candLabel(c)}?`, attachment: { type: 'move-ask', candidate: c, step: 'date' } };
}

/** Tapped a day / time in the move card. */
export function answerMove(messageId: string, patch: { date?: DateKey; start?: string; keepTime?: boolean }) {
  const msg = chat().messages.find((m) => m.id === messageId);
  if (!msg || msg.attachment?.type !== 'move-ask' || msg.attachment.state) return;
  const a = msg.attachment;
  if (a.step === 'date' && patch.date) {
    const c = a.candidate;
    // Tasks without a time move by date only.
    if (c.kind === 'task' && !c.time) {
      const r = doMove(c, { date: patch.date });
      chat().update(messageId, { text: r.text, attachment: r.attachment ?? { ...a, state: 'done' } });
      return;
    }
    chat().update(messageId, { text: `Во сколько ${when(patch.date)}?`, attachment: { ...a, step: 'time', date: patch.date } });
    return;
  }
  if (a.step === 'time') {
    const r = doMove(a.candidate, { date: a.date, start: patch.keepTime ? undefined : patch.start });
    chat().update(messageId, { text: r.text, attachment: r.attachment ?? { ...a, state: 'done' } });
  }
}

export function cancelCard(messageId: string) {
  const msg = chat().messages.find((m) => m.id === messageId);
  const a = msg?.attachment;
  if (!a || !['confirm', 'move-ask', 'remind-ask', 'choose', 'clarify'].includes(a.type)) return;
  chat().update(messageId, { text: 'Хорошо, ничего не меняю.', attachment: { ...a, state: 'cancelled' } as ChatAttachment });
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}

/** "Удали все события на понедельник" → confirmation card listing what will go. */
function bulkDeleteAsk(a: Analysis): AssistantReply {
  const p = planner();
  const range = a.range ?? (a.date ? { from: a.date, to: a.date, label: '' } : undefined);
  const wantEvents = a.targetKind !== 'task';
  const wantTasks = a.targetKind !== 'event';
  const events: { id: string; date?: DateKey }[] = [];
  if (wantEvents) {
    for (const e of p.events) {
      if (!range) events.push({ id: e.id });
      else for (const d of occurrencesBetween(e, range.from, range.to)) events.push({ id: e.id, date: d });
    }
  }
  const tasks = wantTasks ? p.tasks.filter((t) => !range || (t.date && t.date >= range.from && t.date <= range.to)).map((t) => t.id) : [];
  const where = range ? (range.label || (range.from === range.to ? `на ${when(range.from)}` : '')) : '';
  if (!events.length && !tasks.length) return { text: `Удалять нечего${where ? ` ${where}` : ''}.` };
  const parts = [
    events.length && `${events.length} ${plural(events.length, 'событие', 'события', 'событий')}`,
    tasks.length && `${tasks.length} ${plural(tasks.length, 'задачу', 'задачи', 'задач')}`,
  ].filter(Boolean);
  const label = `${parts.join(' и ')}${where ? ` ${where}` : ''}`;
  return { text: `Удалить ${label}?`, attachment: { type: 'confirm', events, tasks, label } };
}

export function answerConfirm(messageId: string) {
  const msg = chat().messages.find((m) => m.id === messageId);
  if (!msg || msg.attachment?.type !== 'confirm' || msg.attachment.state) return;
  const { events, tasks, label } = msg.attachment;
  const p = planner();
  const entries: import('@/store/useChatStore').UndoEntry[] = [];
  // Occurrences of repeating events are skipped; whole events are removed.
  const byId = new Map<string, DateKey[]>();
  for (const e of events) if (e.date) byId.set(e.id, [...(byId.get(e.id) ?? []), e.date]);
  for (const { id, date } of events) {
    const ev = p.events.find((x) => x.id === id);
    if (!ev) continue;
    if (date && ev.repeat) {
      if (!byId.has(id)) continue;
      entries.push({ op: 'updated-event', before: ev });
      p.updateEvent(id, { repeat: { ...ev.repeat, exceptions: [...(ev.repeat.exceptions ?? []), ...byId.get(id)!] } });
      byId.delete(id);
    } else {
      const removed = p.deleteEvent(id);
      if (removed) entries.push({ op: 'deleted-event', event: removed });
    }
  }
  for (const id of tasks) {
    const removed = p.deleteTask(id);
    if (removed) entries.push({ op: 'deleted-task', task: removed });
  }
  chat().pushUndo({ op: 'batch', entries });
  chat().update(messageId, { text: `Удалил ${label}.`, attachment: { type: 'undo' } });
}

/* ------------------------------------------------------------------ reminders */

function itemOf(c: Candidate): { remind?: Reminder; date?: DateKey } | undefined {
  const p = planner();
  return c.kind === 'event' ? p.events.find((e) => e.id === c.id) : p.tasks.find((t) => t.id === c.id);
}

/** Apply a reminder to an existing event/task (undoable). */
function setRemind(c: Candidate, remind: Reminder | undefined): void {
  const p = planner();
  if (c.kind === 'event') {
    const before = p.events.find((e) => e.id === c.id)!;
    chat().pushUndo({ op: 'updated-event', before });
    p.updateEvent(c.id, { remind });
  } else {
    const before = p.tasks.find((t) => t.id === c.id)!;
    chat().pushUndo({ op: 'updated-task', before });
    p.updateTask(c.id, { remind });
  }
}

function remindDone(c: Candidate, r: Reminder): AssistantReply {
  setRemind(c, r);
  const item = itemOf(c) as { repeat?: unknown } | undefined;
  const text = r.at
    ? `Напомню о «${c.title}» ${when(r.at.split('T')[0])} в ${r.at.split('T')[1]}.`
    : `Напомню о «${c.title}» ${offsetLabel(r.offset ?? 0)}${item?.repeat ? ' — перед каждым повтором' : c.date ? ` (${when(c.date)}${c.time ? ` в ${c.time}` : ''})` : ''}.`;
  return { text, attachment: { type: 'undo' } };
}

/* ------------------------------------------------------------------ notes */

const noteOf = (c: Candidate) => (itemOf(c) as { note?: string } | undefined)?.note?.trim() || '';

function doNote(c: Candidate, mode: 'append' | 'replace' | 'clear' | 'read', text?: string): AssistantReply {
  const old = noteOf(c);
  if (mode === 'read') return { text: old ? `Заметка к «${c.title}»:\n${old}` : `У «${c.title}» пока нет заметки.` };
  const note = mode === 'clear' ? undefined : mode === 'replace' || !old ? text : `${old}\n${text}`;
  if (mode === 'clear' && !old) return { text: `У «${c.title}» и так нет заметки.` };
  const p = planner();
  if (c.kind === 'event') {
    chat().pushUndo({ op: 'updated-event', before: p.events.find((e) => e.id === c.id)! });
    p.updateEvent(c.id, { note });
  } else {
    chat().pushUndo({ op: 'updated-task', before: p.tasks.find((t) => t.id === c.id)! });
    p.updateTask(c.id, { note });
  }
  const reply =
    mode === 'clear' ? `Очистил заметку к «${c.title}».` : mode === 'replace' ? `Заменил заметку к «${c.title}»:\n${note}` : old ? `Дописал к «${c.title}»:\n${note}` : `Добавил заметку к «${c.title}»:\n${note}`;
  return { text: reply, attachment: { type: 'undo' } };
}

/**
 * "допиши к встрече с Анной взять паспорт": which words name the item and which are the note?
 * The longest leading part that still matches something wins.
 */
function splitTargetAndNote(words: string, kinds: ('event' | 'task')[], date?: DateKey): { found: Candidate[]; title: string; note: string } | null {
  const parts = words.split(/\s+/);
  for (let k = parts.length - 1; k >= 1; k--) {
    const title = parts.slice(0, k).join(' ');
    const found = findCandidates(title, date, kinds);
    if (found.length && score(title, found[0].title) >= 0.99) {
      const note = parts.slice(k).join(' ');
      return { found, title, note: note.charAt(0).toUpperCase() + note.slice(1) };
    }
  }
  return null;
}

/** "напомни о созвоне в 16:55": tasks keep the exact moment; events get "N minutes before". */
function remindAtMoment(c: Candidate, at: string): AssistantReply {
  const item = itemOf(c) as { start?: string; time?: string } | undefined;
  const time = c.kind === 'event' ? item?.start : undefined;
  if (c.kind === 'task' || !c.date || !time) return remindDone(c, { at });
  const before = Math.round((new Date(`${c.date}T${time}`).getTime() - new Date(at).getTime()) / 60_000);
  return before >= 0 ? remindDone(c, { offset: before }) : remindOrAsk(c);
}

/** Reminder known → set it; otherwise ask how long before (or when, for undated tasks). */
function remindOrAsk(c: Candidate, offset?: number): AssistantReply {
  const item = itemOf(c);
  if (c.kind === 'task' && !item?.date) {
    return { text: `Когда напомнить: «${c.title}»?`, attachment: { type: 'remind-ask', candidate: c, step: 'date' } };
  }
  if (offset !== undefined) return remindDone(c, { offset });
  return { text: `За сколько напомнить о «${c.title}»?`, attachment: { type: 'remind-ask', candidate: c, step: 'offset' } };
}

function doUnremind(c: Candidate): AssistantReply {
  setRemind(c, undefined);
  return { text: `Выключил напоминание для «${c.title}».`, attachment: { type: 'undo' } };
}

/** Tapped an option in the reminder card. */
export function answerRemind(messageId: string, patch: { offset?: number; date?: DateKey; time?: string }) {
  const msg = chat().messages.find((m) => m.id === messageId);
  if (!msg || msg.attachment?.type !== 'remind-ask' || msg.attachment.state) return;
  const a = msg.attachment;
  let reply: AssistantReply | null = null;
  if (a.step === 'offset' && patch.offset !== undefined) reply = remindDone(a.candidate, { offset: patch.offset });
  else if (a.step === 'date' && patch.date) {
    chat().update(messageId, { text: `Во сколько напомнить ${when(patch.date)}?`, attachment: { ...a, step: 'time', date: patch.date } });
    return;
  } else if (a.step === 'time' && patch.time) reply = remindDone(a.candidate, { at: `${a.date}T${patch.time}` });
  if (reply) chat().update(messageId, { text: reply.text, attachment: reply.attachment });
}

export function undoLast(): string {
  const entry = chat().popUndo();
  if (!entry) return 'Отменять нечего.';
  return revert(entry);
}

function revert(entry: import('@/store/useChatStore').UndoEntry): string {
  const p = planner();
  switch (entry.op) {
    case 'batch': {
      const texts = [...entry.entries].reverse().map(revert);
      return entry.entries.length > 1 ? `Вернул как было: ${entry.entries.length} шт.` : texts[0] ?? 'Готово.';
    }
    case 'created-event':
      p.deleteEvent(entry.id);
      return 'Убрал только что созданное событие.';
    case 'created-task':
      p.deleteTask(entry.id);
      return 'Убрал только что созданную задачу.';
    case 'deleted-event':
      p.restoreEvent(entry.event);
      return `Вернул «${entry.event.title}».`;
    case 'deleted-task':
      p.restoreTask(entry.task);
      return `Вернул задачу «${entry.task.title}».`;
    case 'updated-event':
      p.restoreEvent(entry.before);
      return `Вернул «${entry.before.title}» как было.`;
    case 'updated-task':
      p.updateTask(entry.before.id, entry.before);
      return `Вернул задачу «${entry.before.title}» как было.`;
  }
}

/* ------------------------------------------------------------------ entry point */

const HELP =
  'Я понимаю обычную речь. Например:\n' +
  '• «Встреча с Анной завтра с 15 до 16» — событие\n' +
  '• «Купить продукты в субботу» — задача\n' +
  '• «Смены с 9 до 21 по графику 2/2» или «сутки через трое»\n' +
  '• «Английский по вторникам и четвергам в 19:00»\n' +
  '• «Перенеси встречу на пятницу в 16», «Удали тренировку в среду»\n' +
  '• «Я сделал отчёт», «Что у меня на неделе?», «Отмени последнее»\n' +
  'Если чего-то не хватает — я уточню.';

function agenda(a: Analysis): AssistantReply {
  const { from, to, label } = a.range!;
  const p = planner();
  const days: { date: DateKey; events: CalendarEvent[]; tasks: Task[] }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const events = p.events
      .filter((e) => occurrencesBetween(e, d, d).length)
      .sort((x, y) => x.start.localeCompare(y.start));
    const tasks = p.tasks.filter((t) => t.date === d && !t.done);
    if (events.length || tasks.length) days.push({ date: d, events, tasks });
  }
  const what = label || (from === to ? `на ${when(from)}` : '');
  if (!days.length) return { text: `${what ? `${what[0].toUpperCase()}${what.slice(1)}` : 'Пока'} ничего не запланировано — свободно ✨` };
  const nE = days.reduce((s, d) => s + d.events.length, 0);
  const nT = days.reduce((s, d) => s + d.tasks.length, 0);
  const parts = [nE && `${nE} ${nE === 1 ? 'событие' : nE < 5 ? 'события' : 'событий'}`, nT && `${nT} ${nT === 1 ? 'задача' : nT < 5 ? 'задачи' : 'задач'}`].filter(Boolean);
  return { text: `${what ? `${what[0].toUpperCase()}${what.slice(1)}` : 'Запланировано'}: ${parts.join(' и ')}.`, attachment: { type: 'agenda', days } };
}

/** Typed answer to an open clarification question, if the text is one. */
function answerPending(text: string): AssistantReply | null {
  const pending = [...chat().messages].reverse().find((m) => m.role === 'assistant' && m.attachment);
  if (pending?.attachment?.type === 'move-ask' && !pending.attachment.state) return answerMoveText(pending.id, pending.attachment, text);
  if (pending?.attachment?.type === 'remind-ask' && !pending.attachment.state) return answerRemindText(pending.id, pending.attachment, text);
  if (pending?.attachment?.type !== 'clarify' || pending.attachment.state) return null;
  const fill = fillFromText(text, pending.attachment.ask, pending.attachment.draft.start);
  if (fill === 'cancel') {
    cancelClarify(pending.id);
    return { text: 'Отменил.' };
  }
  if (fill) {
    // The question card collapses; the answer (next question or result) follows the user's message.
    chat().update(pending.id, { attachment: { ...pending.attachment, state: 'answered' } });
    return proceed({ ...pending.attachment.draft, ...fill });
  }
  // Not an answer — a new request; the question stays open until it is answered.
  return null;
}

/** A typed / spoken answer to "На какой день перенести …?" / "Во сколько …?". */
function answerMoveText(id: string, a: Extract<ChatAttachment, { type: 'move-ask' }>, text: string): AssistantReply | null {
  const fill = fillFromText(text, a.step === 'date' ? 'move-date' : 'move-time');
  if (!fill) return null;
  if (fill === 'cancel') {
    chat().update(id, { attachment: { ...a, state: 'cancelled' } });
    return { text: 'Отменил.' };
  }
  const c = a.candidate;
  const date = fill.date ?? a.date;
  if (a.step === 'date' && fill.date && !fill.start && !(c.kind === 'task' && !c.time)) {
    chat().update(id, { attachment: { ...a, state: 'done' } });
    return { text: `Во сколько ${when(fill.date)}?`, attachment: { type: 'move-ask', candidate: c, step: 'time', date: fill.date } };
  }
  if (!date && !fill.start) return null;
  chat().update(id, { attachment: { ...a, state: 'done' } });
  return doMove(c, { date: date ?? c.date, start: fill.start, end: fill.end });
}

/** A typed / spoken answer to "За сколько напомнить?" / "Когда напомнить?". */
function answerRemindText(id: string, a: Extract<ChatAttachment, { type: 'remind-ask' }>, text: string): AssistantReply | null {
  if (/^\s*(нет|отмена|отмени|не надо|не нужно)/iu.test(text)) {
    chat().update(id, { attachment: { ...a, state: 'cancelled' } });
    return { text: 'Отменил.' };
  }
  if (a.step === 'offset') {
    const offset = parseOffsetText(text);
    if (offset === undefined) return null;
    chat().update(id, { attachment: { ...a, state: 'done' } });
    return remindDone(a.candidate, { offset });
  }
  const fill = fillFromText(text, a.step === 'date' ? 'date' : 'time');
  if (!fill || fill === 'cancel') return null;
  const date = fill.date ?? a.date;
  if (date && fill.start) {
    chat().update(id, { attachment: { ...a, state: 'done' } });
    return remindDone(a.candidate, { at: `${date}T${fill.start}` });
  }
  if (a.step === 'date' && fill.date) {
    chat().update(id, { attachment: { ...a, state: 'done' } });
    return { text: `Во сколько напомнить ${when(fill.date)}?`, attachment: { type: 'remind-ask', candidate: a.candidate, step: 'time', date: fill.date } };
  }
  return null;
}

/** Carries out one analysed request. */
function act(a: Analysis, text: string, aiReply?: string): AssistantReply {
  switch (a.intent) {
    case 'help':
      return { text: HELP };
    case 'smalltalk':
      return {
        text:
          aiReply ??
          (/спасиб|благодар/iu.test(text) ? 'Всегда пожалуйста! 🙂' : /пока/iu.test(text) ? 'До встречи!' : 'Привет! Скажите, что запланировать, или спросите «что у меня сегодня?».'),
      };
    case 'undo':
      return { text: undoLast() };
    case 'agenda':
      return agenda(a);
    case 'remind': {
      const kinds: ('event' | 'task')[] = a.eventHint && !a.taskHint ? ['event'] : ['event', 'task'];
      let found = a.title ? findCandidates(a.title, a.date, kinds) : upcoming(kinds, a.date);
      // "отключи все напоминания" — everything, not just the next two weeks
      if (a.remindCancel && a.all && !a.title) {
        const p = planner();
        const events = p.events.filter((e) => e.remind);
        const tasks = p.tasks.filter((t) => t.remind && !t.done);
        if (!events.length && !tasks.length) return { text: 'Напоминаний нет.' };
        chat().pushUndo({
          op: 'batch',
          entries: [...events.map((e) => ({ op: 'updated-event', before: e }) as const), ...tasks.map((t) => ({ op: 'updated-task', before: t }) as const)],
        });
        for (const e of events) p.updateEvent(e.id, { remind: undefined });
        for (const t of tasks) p.updateTask(t.id, { remind: undefined });
        return { text: `Выключил все напоминания (${events.length + tasks.length}).`, attachment: { type: 'undo' } };
      }
      if (a.remindCancel) {
        found = found.filter((c) => itemOf(c)?.remind);
        if (!found.length) return { text: a.title ? `У «${a.title}» нет напоминания.` : 'Напоминаний нет.' };
        if (found.length === 1) return doUnremind(found[0]);
        return { text: 'Для чего выключить напоминание?', attachment: { type: 'choose', action: 'remind', candidates: found, target: { cancel: true } } };
      }
      if (a.remindAt) {
        const [d, t] = a.remindAt.split('T');
        // Nothing like that yet → a to-do at that moment, with the reminder.
        if (!found.length) return proceed(draftFrom({ ...a, intent: 'create', date: d, start: t, remind: true, remindOffset: 0, kindWord: 'task' }));
        if (found.length === 1) return remindAtMoment(found[0], a.remindAt);
      }
      // Nothing like that yet → create it, with the reminder.
      if (!found.length) return proceed(draftFrom({ ...a, intent: 'create', remind: true }));
      if (found.length === 1) return remindOrAsk(found[0], a.remindOffset);
      return {
        text: 'О чём напомнить?',
        attachment: { type: 'choose', action: 'remind', candidates: found, target: { offset: a.remindOffset } },
      };
    }
    case 'note': {
      const kinds: ('event' | 'task')[] = a.targetKind === 'task' ? ['task'] : a.targetKind === 'event' ? ['event'] : ['event', 'task'];
      const mode = a.noteMode ?? 'append';
      let found = a.title ? findCandidates(a.title, a.date, kinds) : upcoming(kinds, a.date);
      let text = a.note;
      if ((mode === 'append' || mode === 'replace') && !text && a.title) {
        const split = splitTargetAndNote(a.title, kinds, a.date);
        if (!split || !split.note) return { text: 'Что записать в заметку и к какому делу? Например: «добавь в заметку к встрече с Анной: взять документы».' };
        found = split.found;
        text = split.note;
      }
      if (!found.length) return { text: `Не нашёл «${a.title}».` };
      if (found.length === 1) return doNote(found[0], mode, text);
      return {
        text: mode === 'read' ? 'Чью заметку показать?' : 'К какому делу?',
        attachment: { type: 'choose', action: 'note', candidates: found, target: { note: text, noteMode: mode } },
      };
    }
    case 'digest': {
      if (!serverSettingsAvailable()) return { text: 'Сводку присылает бот — откройте планер в Telegram.' };
      const evening = a.digestKind === 'evening';
      const patch = evening ? { evening: a.digestOn !== false, ...(a.start ? { eveningTime: a.start } : {}) } : { morning: a.digestOn !== false, ...(a.start ? { morningTime: a.start } : {}) };
      void saveDigest(patch).then((saved) => {
        if (!saved) useUIStore.getState().showToast('Не удалось сохранить настройку сводки — проверьте интернет');
      });
      if (a.digestOn === false) return { text: evening ? 'Вечернюю сводку выключил.' : 'Утреннюю сводку выключил. Включить снова — в настройках или скажите «присылай сводку».' };
      return {
        text: evening
          ? `Буду присылать вечером план на завтра${a.start ? ` в ${a.start}` : ''}.`
          : `Буду присылать каждое утро план на день${a.start ? ` в ${a.start}` : ''}.`,
      };
    }
    case 'complete': {
      const found = findCandidates(a.title, undefined, ['task']).filter((c) => !planner().tasks.find((t) => t.id === c.id)?.done);
      if (!found.length) return { text: `Не нашёл открытую задачу «${a.title}».` };
      if (found.length === 1) return doComplete(found[0]);
      return { text: 'Какую задачу отметить?', attachment: { type: 'choose', action: 'complete', candidates: found } };
    }
    case 'delete':
    case 'move': {
      if (a.intent === 'delete' && a.bulk) return bulkDeleteAsk(a);
      const kinds: ('event' | 'task')[] = a.targetKind === 'task' ? ['task'] : a.targetKind === 'event' ? ['event'] : ['event', 'task'];
      const lookDate = a.intent === 'move' ? a.sourceDate : a.date;
      const target = { date: a.intent === 'move' ? a.date : undefined, start: a.start, end: a.end, duration: a.duration, shift: a.shift, all: a.all };

      // Nothing specific named ("удали", "перенеси задачу") → pick from what's coming up.
      if (!a.title) {
        const list = upcoming(kinds, lookDate);
        if (!list.length) return { text: lookDate ? `На ${when(lookDate)} ничего нет.` : 'Пока нечего — список пуст.' };
        return {
          text: `${a.targetKind === 'task' ? 'Какую задачу' : a.targetKind === 'event' ? 'Какое событие' : 'Что'} ${a.intent === 'delete' ? 'удалить' : 'перенести'}?`,
          attachment: { type: 'choose', action: a.intent, candidates: list, target },
        };
      }

      const found = findCandidates(a.title, lookDate, kinds);
      if (!found.length) return { text: `Не нашёл «${a.title}»${lookDate ? ` ${when(lookDate)}` : ''}.` };
      if (found.length === 1) {
        if (a.intent === 'delete') return doDelete(found[0], a.all);
        return target.date || target.start || target.shift ? doMove(found[0], target) : moveAsk(found[0]);
      }
      return {
        text: a.intent === 'delete' ? 'Нашёл несколько. Что удалить?' : 'Нашёл несколько. Что перенести?',
        attachment: { type: 'choose', action: a.intent, candidates: found, target },
      };
    }
    case 'create': {
      if (!a.title && !a.date && !a.start && !a.repeat) {
        // Bare commands: "напомни", "создай задачу", "добавь событие"
        if (a.remind) return { text: 'О чём и когда напомнить? Например: «напомни завтра в 9 позвонить в банк».' };
        if (a.kindWord === 'task') return { text: 'Какую задачу добавить? Например: «задача купить хлеб на завтра».' };
        if (a.kindWord === 'event') return { text: 'Что добавить в календарь? Например: «встреча с Анной завтра с 15 до 16».' };
        return { text: aiReply ?? 'Не совсем понял. Скажите, например: «встреча завтра с 15 до 16» или «купить хлеб».' };
      }
      return proceed(draftFrom(a));
    }
  }
}

/** Requests from the iPhone Shortcut that the server couldn't finish alone (missing details, choices). */
export async function applyQueued(text: string, actions: Analysis[] | null): Promise<AssistantReply[]> {
  // The server already did everything it could; what's left needs the user — ask as usual.
  if (!actions) return handleUtterance(text);
  return actions.map((a) => act(a, text));
}

/**
 * Handles a whole message:
 *  1. a typed answer to an open question, or undo/help/small talk → instant, offline;
 *  2. otherwise the AI worker (if configured and reachable) — it also splits several requests;
 *  3. fallback: offline rules, requests separated by ";", new lines or sentences.
 */
export async function handleUtterance(text: string): Promise<AssistantReply[]> {
  const answered = answerPending(text);
  if (answered) return [answered];

  const local = analyze(text);
  if (local.intent === 'undo' || local.intent === 'help' || local.intent === 'smalltalk') return [act(local, text)];

  // Simple phrases: offline rules, instantly and for free. The model only when they're unsure.
  const parts = splitRequests(text);
  const analyses = parts.map((p) => analyze(p));
  if (analyses.length && analyses.every((a, i) => isConfident(a, parts[i]))) {
    return analyses.map((a, i) => act(a, parts[i]));
  }

  const ai = await aiAnalyze(text);
  if (ai) {
    if (!ai.actions.length) return [{ text: ai.reply! }];
    return ai.actions.map((a) => act(guardNoteMode(a, text), text, ai.reply));
  }

  return splitRequests(text).map((part) => act(analyze(part), part));
}

export { candLabel, durationLabel };
