/**
 * The assistant's decision layer.
 *
 * Rules:
 *  • date + start + end known            → calendar event, created right away;
 *  • no time at all                       → task (unless it clearly is an event — then ask the time);
 *  • something is missing or ambiguous    → ask, with a mini picker card in the chat.
 * The user can answer by tapping the card or by typing ("в 15", "на час", "завтра", "задачей").
 *
 * Everything runs offline on top of lib/parser.ts. A server-side LLM can later replace
 * `analyze()` with the same `Analysis` shape without touching this file.
 */
import type { CalendarEvent, DateKey, Task } from '@/types';
import { analyze, parseDurationText, type Analysis } from '@/lib/parser';
import { addDays, humanDate, minutesToTime, timeToMinutes, todayKey } from '@/lib/date';
import { CATEGORY_TO_COLOR } from '@/lib/meta';
import { nextOccurrence, occurrencesBetween, occursOn, repeatLabel } from '@/lib/recurrence';
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

/** Stems for fuzzy matching ("встречу" ≈ "встреча", "тренировки" ≈ "тренировка"). */
const STOP = new Set(['событи', 'задач', 'мою', 'мой', 'мне', 'для', 'это', 'все', 'всё', 'все']);
function stems(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\d]+/u)
    .filter((w) => w.length >= 3)
    .map((w) => w.slice(0, Math.min(5, Math.max(3, w.length - 1))))
    .filter((w) => !STOP.has(w));
}
function score(query: string, title: string): number {
  const q = stems(query);
  if (!q.length) return 0;
  const t = stems(title);
  return q.filter((s) => t.some((w) => w.startsWith(s) || s.startsWith(w))).length / q.length;
}

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

  return {
    title: a.title || (kind === 'task' ? 'Новая задача' : 'Новое событие'),
    kind,
    date: a.date,
    start: a.start,
    end: a.end,
    duration: a.duration,
    repeat: a.repeat,
    needsStart: a.needsStart,
    priority: a.priority,
    category: a.category,
  };
}

function nextAsk(d: Draft): Ask | null {
  if (!d.kind) return 'kind';
  if (d.kind === 'task') return null;
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
      return `На какой день поставить ${t}?`;
    case 'time':
      return `Во сколько ${t}${d.date ? ` ${when(d.date)}` : ''}?`;
    case 'end':
      return `${t} ${when(d.date)} с ${d.start}. Сколько продлится?`;
  }
}

function commit(d: Draft): AssistantReply {
  const p = planner();
  if (d.kind === 'task') {
    const task = p.addTask({ title: d.title, date: d.date, time: d.start, priority: d.priority, category: d.category });
    chat().pushUndo({ op: 'created-task', id: task.id });
    return {
      text: task.date ? `Создал задачу на ${when(task.date)}${task.time ? `, ${task.time}` : ''}.` : 'Добавил задачу во «Входящие».',
      attachment: { type: 'task', task },
    };
  }
  const start = d.start!;
  const end = d.end ?? minutesToTime(timeToMinutes(start) + (d.duration ?? 60));
  const event = p.addEvent({ title: d.title, date: d.date!, start, end, color: CATEGORY_TO_COLOR[d.category], repeat: d.repeat });
  chat().pushUndo({ op: 'created-event', id: event.id });
  return {
    text: event.repeat
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
function fillFromText(text: string, ask: Ask): Partial<Draft> | 'cancel' | null {
  const t = text.trim().toLowerCase();
  if (/^(нет|отмена|отмени|не надо|не нужно|забудь)\b/u.test(t)) return 'cancel';
  if (/^(задач|в задачи|задачей|как задачу)/u.test(t)) return { kind: 'task' };
  if (/^(событи|в календарь|событием|как событие)/u.test(t)) return { kind: 'event' };

  const patch: Partial<Draft> = {};
  const bare = t.match(/^(?:в\s+|к\s+|до\s+)?(\d{1,2})(?:[:.](\d{2}))?$/u);
  if (bare) {
    let h = Number(bare[1]);
    // "в 3" for an appointment means 15:00.
    if (!bare[2] && h >= 1 && h <= 6) h += 12;
    if (h > 23) return null;
    const time = `${String(h).padStart(2, '0')}:${bare[2] ?? '00'}`;
    if (ask === 'end' || /^до/u.test(t)) patch.end = time;
    else patch.start = time;
    return patch;
  }
  const dur = parseDurationText(t);
  if (dur && ask === 'end') return { duration: dur };

  const a = analyze(text);
  if (a.intent !== 'create') return null;
  // Too much new content → it's a new request, not an answer.
  if (a.title && a.title.split(/\s+/).length > 2 && !a.date && !a.start) return null;
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

type MoveTarget = { date?: DateKey; start?: string; end?: string; duration?: number };

function doMove(c: Candidate, to: MoveTarget): AssistantReply {
  const p = planner();
  if (c.kind === 'task') {
    const before = p.tasks.find((t) => t.id === c.id)!;
    chat().pushUndo({ op: 'updated-task', before });
    p.updateTask(c.id, { date: to.date ?? before.date, time: to.start ?? before.time });
    return { text: `Перенёс задачу «${c.title}» на ${when(to.date ?? before.date)}${to.start ? `, ${to.start}` : ''}.`, attachment: { type: 'undo' } };
  }
  const ev = p.events.find((e) => e.id === c.id)!;
  const len = timeToMinutes(ev.end) - timeToMinutes(ev.start);
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
    action === 'delete' ? doDelete(candidate, Boolean(target?.all)) : action === 'move' ? doMove(candidate, target ?? {}) : doComplete(candidate);
  chat().update(messageId, { text: reply.text, attachment: reply.attachment ?? { ...msg.attachment, state: 'done' } });
}

export function undoLast(): string {
  const entry = chat().popUndo();
  if (!entry) return 'Отменять нечего.';
  return revert(entry);
}

function revert(entry: import('@/store/useChatStore').UndoEntry): string {
  const p = planner();
  switch (entry.op) {
    case 'batch':
      return [...entry.entries].reverse().map(revert)[entry.entries.length - 1];
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

function handleOne(text: string): AssistantReply {
  // An open question waiting for an answer?
  const pending = [...chat().messages].reverse().find((m) => m.role === 'assistant' && m.attachment);
  if (pending?.attachment?.type === 'clarify' && !pending.attachment.state) {
    const fill = fillFromText(text, pending.attachment.ask);
    if (fill === 'cancel') {
      cancelClarify(pending.id);
      return { text: 'Отменил.' };
    }
    if (fill) {
      const reply = proceed({ ...pending.attachment.draft, ...fill });
      // The question card collapses; the answer (next question or result) follows the user's message.
      chat().update(pending.id, { attachment: { ...pending.attachment, state: 'answered' } });
      return reply;
    }
    // Not an answer — drop the question silently and handle as a new request.
    chat().update(pending.id, { attachment: { ...pending.attachment, state: 'cancelled' } });
  }

  const a = analyze(text);
  switch (a.intent) {
    case 'help':
      return { text: HELP };
    case 'smalltalk':
      return { text: /спасиб|благодар/iu.test(text) ? 'Всегда пожалуйста! 🙂' : /пока/iu.test(text) ? 'До встречи!' : 'Привет! Скажите, что запланировать, или спросите «что у меня сегодня?».' };
    case 'undo':
      return { text: undoLast() };
    case 'agenda':
      return agenda(a);
    case 'complete': {
      const found = findCandidates(a.title, undefined, ['task']).filter((c) => !planner().tasks.find((t) => t.id === c.id)?.done);
      if (!found.length) return { text: `Не нашёл открытую задачу «${a.title}».` };
      if (found.length === 1) return doComplete(found[0]);
      return { text: 'Какую задачу отметить?', attachment: { type: 'choose', action: 'complete', candidates: found } };
    }
    case 'delete':
    case 'move': {
      if (a.intent === 'move' && !a.date && !a.start) {
        return { text: `На когда перенести «${a.title}»? Скажите, например: «перенеси ${lower(a.title)} на пятницу в 16».` };
      }
      const lookDate = a.intent === 'move' ? a.sourceDate : a.date;
      const found = findCandidates(a.title, lookDate, ['event', 'task']);
      if (!found.length) return { text: `Не нашёл «${a.title}»${lookDate ? ` ${when(lookDate)}` : ''}.` };
      const target = { date: a.intent === 'move' ? a.date : undefined, start: a.start, end: a.end, duration: a.duration, all: a.all };
      if (found.length === 1) return a.intent === 'delete' ? doDelete(found[0], a.all) : doMove(found[0], target);
      return {
        text: a.intent === 'delete' ? 'Нашёл несколько. Что удалить?' : 'Нашёл несколько. Что перенести?',
        attachment: { type: 'choose', action: a.intent, candidates: found, target },
      };
    }
    case 'create': {
      if (!a.title && !a.date && !a.start && !a.repeat) return { text: 'Не совсем понял. Скажите, например: «встреча завтра с 15 до 16» или «купить хлеб».' };
      return proceed(draftFrom(a));
    }
  }
}

/** Handles a whole message; several requests can be separated by ";", new lines or sentences. */
export async function handleUtterance(text: string): Promise<AssistantReply[]> {
  const parts = text
    .split(/\n+|;\s*|\.\s+(?=[А-ЯЁA-Z])/u)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.map(handleOne);
}

export { candLabel, durationLabel };
