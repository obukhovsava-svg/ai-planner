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
import { occurrencesBetween } from './recurrence';

const TIMEOUT_MS = 12_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const INTENTS: Intent[] = ['create', 'agenda', 'delete', 'move', 'complete', 'undo', 'help', 'smalltalk'];

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

function toRepeat(r: any): Repeat | undefined {
  if (!r || !['day', 'week', 'month', 'year'].includes(r.freq)) return undefined;
  const rep: Repeat = { freq: r.freq, interval: int(r.interval, 1, 52) ?? 1 };
  const days = Array.isArray(r.byWeekday) ? [...new Set(r.byWeekday.filter((d: unknown) => int(d, 0, 6) !== undefined))].sort() : [];
  if (rep.freq === 'week' && days.length) rep.byWeekday = days as number[];
  const on = int(r.cycle?.on, 1, 14);
  const off = int(r.cycle?.off, 1, 14);
  if (rep.freq === 'day' && on && off) rep.cycle = { on, off };
  const until = str(r.until, DATE);
  if (until) rep.until = until;
  return rep;
}

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
    range: x.intent === 'agenda' ? (range ?? { from: todayKey(), to: todayKey(), label: '' }) : undefined,
    sourceDate: str(x.sourceDate, DATE),
    all: Boolean(x.all),
  };
}

export async function aiAnalyze(text: string): Promise<AiResult | null> {
  if (!aiAvailable()) return null;
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
    if (!res.ok) return null;
    const data = await res.json();
    const actions = Array.isArray(data.actions) ? data.actions.map(toAnalysis).filter(Boolean) : [];
    const reply = typeof data.reply === 'string' && data.reply.trim() ? data.reply.trim() : undefined;
    if (!actions.length && !reply) return null;
    return { actions: actions as Analysis[], reply };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
