/**
 * Reminders: the app computes the exact moments (repeating events expanded 35 days ahead)
 * and syncs the list to the worker, which stores it and has the Telegram bot send each one
 * on time — even when the Mini App is closed.
 */
import { useEffect } from 'react';
import type { CalendarEvent, Reminder, Task } from '@/types';
import { AI_URL } from '@/config';
import { usePlannerStore } from '@/store/usePlannerStore';
import { getInitData } from './telegram';
import { addDays, fromKey, humanDate, todayKey } from './date';
import { occurrencesBetween } from './recurrence';

const WINDOW_DAYS = 35;
const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export const REMIND_PRESETS = [0, 5, 15, 30, 60, 120, 1440, 2880];

/** "за 30 мин", "за 1 ч 30 мин", "за 1 день", "в момент начала". */
export function offsetLabel(min: number, startWord = 'начала'): string {
  if (!min) return `в момент ${startWord}`;
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const parts = [d && `${d} ${d === 1 ? 'день' : d < 5 ? 'дня' : 'дней'}`, h && `${h} ч`, m && `${m} мин`].filter(Boolean);
  return `за ${parts.join(' ')}`;
}

export function reminderLabel(r: Reminder | undefined, hasDate: boolean): string {
  if (!r) return 'Выкл.';
  if (r.at) return atLabel(r.at);
  return hasDate ? offsetLabel(r.offset ?? 0) : 'Выкл.';
}

export function atLabel(at: string): string {
  const [date, time] = at.split('T');
  return `${humanDate(date)}, ${time}`;
}

const localMs = (date: string, time: string) => {
  const [h, m] = time.split(':').map(Number);
  const d = fromKey(date);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

const dayLabel = (date: string) => `${WD[(fromKey(date).getDay() + 6) % 7]}, ${humanDate(date, { relative: false })}`;

export interface ReminderInstance {
  rid: string;
  at: number;
  text: string;
}

/** All reminders that should fire in the next WINDOW_DAYS. */
export function reminderInstances(events: CalendarEvent[], tasks: Task[], now = Date.now()): ReminderInstance[] {
  const out: ReminderInstance[] = [];
  const today = todayKey();
  const to = addDays(today, WINDOW_DAYS);

  for (const e of events) {
    if (!e.remind) continue;
    const offset = e.remind.offset ?? 0;
    // Look a bit back too: a "1 day before" reminder for tomorrow's occurrence fires today.
    for (const d of occurrencesBetween(e, today, addDays(to, Math.ceil(offset / 1440)))) {
      const at = localMs(d, e.start) - offset * 60_000;
      if (at < now - 60_000 || at > now + WINDOW_DAYS * 86_400_000) continue;
      out.push({
        rid: `e:${e.id}:${d}`,
        at,
        text: `⏰ ${e.title}\n${dayLabel(d)}, ${e.start}–${e.end}${offset ? `\nНачало ${offsetLabel(offset).replace('за ', 'через ')}` : ''}`,
      });
    }
  }

  for (const t of tasks) {
    if (!t.remind || t.done) continue;
    let at: number | undefined;
    if (t.remind.at) {
      const [d, time] = t.remind.at.split('T');
      at = localMs(d, time);
    } else if (t.date) {
      at = localMs(t.date, t.time ?? '09:00') - (t.remind.offset ?? 0) * 60_000;
    }
    if (at === undefined || at < now - 60_000) continue;
    out.push({
      rid: `t:${t.id}`,
      at,
      text: `⏰ ${t.title}${t.date ? `\nСрок: ${dayLabel(t.date)}${t.time ? `, ${t.time}` : ''}` : ''}`,
    });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 300);
}

/* ------------------------------------------------------------------ sync */

let lastSent = '';
let timer = 0;

async function sync() {
  const initData = getInitData();
  if (!AI_URL || !initData) return;
  const { events, tasks } = usePlannerStore.getState();
  const reminders = reminderInstances(events, tasks);
  const body = JSON.stringify({ reminders });
  if (body === lastSent) return;
  try {
    const res = await fetch(`${AI_URL.replace(/\/$/, '')}/reminders/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
      body,
    });
    if (res.ok) lastSent = body;
  } catch {
    /* offline — next change or app start retries */
  }
}

const schedule = () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(sync, 1500);
};

/** Keeps the bot's reminder list in sync with the planner (on start and after every change). */
export function useReminderSync() {
  useEffect(() => {
    schedule();
    const unsub = usePlannerStore.subscribe(schedule);
    // Roll the 35-day window forward while the app stays open.
    const roll = window.setInterval(schedule, 60 * 60_000);
    return () => {
      unsub();
      window.clearInterval(roll);
    };
  }, []);
}
