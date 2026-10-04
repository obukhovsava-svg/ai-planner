/**
 * Client for the AI worker (/worker). Returns validated `Analysis` objects or null —
 * on any failure (offline, no Telegram signature, timeout, odd output) the caller
 * falls back to the offline rules in lib/parser.ts.
 */
import type { Repeat } from '@/types';
import type { Analysis, Intent } from './parser';
import { AI_URL } from '@/config';
import { getInitData } from './telegram';
import { usePlannerStore } from '@/store/usePlannerStore';
import { addDays, fromKey, todayKey } from './date';
import { occurrencesBetween, sanitizeRepeat } from './recurrence';

const TIMEOUT_MS = 12_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const INTENTS: Intent[] = ['create', 'agenda', 'delete', 'move', 'complete', 'remind', 'undo', 'help', 'smalltalk'];

/** Last AI round-trip outcome, shown under the assistant title. */
export type AiStatus = { state: 'idle' | 'ok' | 'error' | 'off'; detail?: string };
let status: AiStatus = { state: 'idle' };
const listeners = new Set<() => void>();
const setStatus = (s: AiStatus) => {
  status = s;
  listeners.forEach((l) => l());
};
export const aiStatus = {
  get: () => status,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export interface AiResult {
  actions: Analysis[];
  reply?: string;
}

export const aiAvailable = () => Boolean(AI_URL && getInitData());

/** Compact list of upcoming items so the model can resolve "перенеси встречу…". */
function contextItems(): string {
  const { events, tasks } = usePlannerStore.getState();
  const today = todayKey();
  const to = addDays(today, 30);
  const lines: string[] = [];
  for (const e of events) {
    for (const d of occurrencesBetween(e, addDays(today, -7), to).slice(0, 3)) {
      lines.push(`событие: ${e.title} — ${d} ${e.start}-${e.end}${e.repeat ? ' (повтор)' : ''}`);
    }
  }
  for (const t of tasks.filter((t) => !t.done).slice(0, 30)) {
    lines.push(`задача: ${t.title}${t.date ? ` — ${t.date}${t.time ? ` ${t.time}` : ''}` : ''}`);
  }
  return lines.sort().slice(0, 60).join('\n');
}

const str = (v: unknown, re?: RegExp) => (typeof v === 'string' && (!re || re.test(v)) ? v : undefined);
const int = (v: unknown, min: number, max: number) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : undefined);

const toRepeat = (r: any): Repeat | undefined => sanitizeRepeat(r);

function toAnalysis(x: any): Analysis | null {
  if (!x || !INTENTS.includes(x.intent)) return null;
  const range = x.range && str(x.range.from, DATE) && str(x.range.to, DATE) ? { from: x.range.from, to: x.range.to, label: String(x.range.label ?? '') } : undefined;
  return {
    intent: x.intent,
    title: typeof x.title === 'string' ? x.title.trim().slice(0, 120) : '',
    date: str(x.date, DATE),
    start: str(x.start, TIME),
    end: str(x.end, TIME),
    duration: int(x.duration, 5, 24 * 60),
    repeat: toRepeat(x.repeat),
    needsStart: Boolean(x.needsStart),
    kindWord: x.kindWord === 'event' || x.kindWord === 'task' ? x.kindWord : undefined,
    eventHint: Boolean(x.eventHint),
    taskHint: Boolean(x.taskHint),
    priority: ['low', 'medium', 'high'].includes(x.priority) ? x.priority : 'medium',
    category: ['work', 'personal', 'health', 'study', 'other'].includes(x.category) ? x.category : 'other',
    range: x.intent === 'agenda' ? (range ?? { from: todayKey(), to: todayKey(), label: '' }) : range,
    sourceDate: str(x.sourceDate, DATE),
    shift: x.intent === 'move' && Number.isInteger(x.shift) && x.shift !== 0 && Math.abs(x.shift) <= 60 * 24 * 60 ? x.shift : undefined,
    all: Boolean(x.all),
    targetKind: ['event', 'task', 'any'].includes(x.targetKind) ? x.targetKind : undefined,
    bulk: x.intent === 'delete' && Boolean(x.bulk),
    remind: x.intent === 'create' && Boolean(x.remind),
    remindOffset: int(x.remindOffset, 0, 60 * 24 * 60),
    remindCancel: x.intent === 'remind' && Boolean(x.remindCancel),
  };
}

/** Validates raw model actions (also used for commands queued by the iPhone Shortcut). */
export function toAnalyses(raw: unknown): Analysis[] {
  return Array.isArray(raw) ? (raw.map(toAnalysis).filter(Boolean) as Analysis[]) : [];
}

export async function aiAnalyze(text: string): Promise<AiResult | null> {
  if (!aiAvailable()) {
    setStatus({ state: 'off', detail: AI_URL ? 'Откройте приложение внутри Telegram' : 'AI-сервер не настроен' });
    return null;
  }
  const now = new Date();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${AI_URL.replace(/\/$/, '')}/analyze`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getInitData() },
      body: JSON.stringify({
        text,
        today: todayKey(),
        weekday: fromKey(todayKey()).toLocaleDateString('ru-RU', { weekday: 'long' }),
        time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        items: contextItems(),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const reason =
        res.status === 401
          ? 'сервер не принял подпись Telegram — проверьте BOT_TOKEN'
          : res.status === 429
            ? 'слишком много запросов, подождите минуту'
            : `ошибка провайдера ${err.status ?? res.status}: ${String(err.detail ?? err.error ?? '').slice(0, 160)}`;
      setStatus({ state: 'error', detail: reason });
      return null;
    }
    const data = await res.json();
    const actions = Array.isArray(data.actions) ? data.actions.map(toAnalysis).filter(Boolean) : [];
    const reply = typeof data.reply === 'string' && data.reply.trim() ? data.reply.trim() : undefined;
    if (!actions.length && !reply) {
      setStatus({ state: 'error', detail: 'модель вернула пустой ответ' });
      return null;
    }
    setStatus({ state: 'ok' });
    return { actions: actions as Analysis[], reply };
  } catch (e) {
    setStatus({ state: 'error', detail: (e as Error)?.name === 'AbortError' ? 'модель не ответила за 12 секунд' : 'нет связи с AI-сервером' });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
