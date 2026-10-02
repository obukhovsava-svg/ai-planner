/** ISO calendar date without time, e.g. "2026-10-02". */
export type DateKey = string;

/** Local time "HH:mm". */
export type TimeStr = string;

export type Priority = 'low' | 'medium' | 'high';

export type Category = 'work' | 'personal' | 'health' | 'study' | 'other';

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
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: DateKey;
  start: TimeStr;
  end: TimeStr;
  color: EventColor;
  note?: string;
  createdAt: number;
}

export type EventColor = 'blue' | 'red' | 'violet' | 'green' | 'amber';

export type TabId = 'calendar' | 'assistant' | 'tasks';

export type ThemeMode = 'light' | 'dark';
