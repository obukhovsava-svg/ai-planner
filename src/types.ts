/** ISO calendar date without time, e.g. "2026-10-02". */
export type DateKey = string;

/** Local time "HH:mm". */
export type TimeStr = string;

export type Priority = 'low' | 'medium' | 'high';

export type Category = 'work' | 'personal' | 'health' | 'study' | 'other';

/**
 * A reminder sent by the Telegram bot.
 *  • offset — minutes before the item's time (0 = at that moment);
 *  • at     — exact local time 'YYYY-MM-DDTHH:MM', for tasks without a date.
 */
export interface Reminder {
  offset?: number;
  at?: string;
}

export interface Task {
  id: string;
  title: string;
  done: boolean;
  /** Optional due date. Tasks without a date live in the inbox. */
  date?: DateKey;
  time?: TimeStr;
  priority: Priority;
  category: Category;
  createdAt: number;
  completedAt?: number;
  remind?: Reminder;
}

export type RepeatFreq = 'day' | 'week' | 'month' | 'year';

/** Recurrence rule (a small subset of RFC 5545 RRULE). */
export interface Repeat {
  freq: RepeatFreq;
  /** Every N days/weeks/months/years. */
  interval: number;
  /** Last day an occurrence may fall on (inclusive). */
  until?: DateKey;
  /** Individual occurrences deleted with "only this event". */
  exceptions?: DateKey[];
  /** freq 'week': specific weekdays (Mon=0 … Sun=6), e.g. weekdays [0..4]. */
  byWeekday?: number[];
  /** freq 'day': shift rota — `on` working days, then `off` days off (2/2, 1/3…). */
  cycle?: { on: number; off: number };
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: DateKey;
  start: TimeStr;
  end: TimeStr;
  color: EventColor;
  note?: string;
  /** Present for repeating events; `date` is the first occurrence. */
  repeat?: Repeat;
  remind?: Reminder;
  createdAt: number;
}

export type EventColor = 'blue' | 'red' | 'violet' | 'green' | 'amber';

export type TabId = 'calendar' | 'assistant' | 'tasks';

export type ThemeMode = 'light' | 'dark';
