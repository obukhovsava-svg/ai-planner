import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CalendarEvent, DateKey, Task } from '@/types';
import { STORAGE_KEYS, storage, uid } from '@/lib/storage';
import { addDays, todayKey } from '@/lib/date';
import { occurrencesBetween } from '@/lib/recurrence';

export type NewTask = Omit<Task, 'id' | 'done' | 'createdAt' | 'completedAt'>;
export type NewEvent = Omit<CalendarEvent, 'id' | 'createdAt'>;

interface PlannerState {
  tasks: Task[];
  events: CalendarEvent[];

  addTask(task: NewTask): Task;
  updateTask(id: string, patch: Partial<Task>): void;
  toggleTask(id: string): void;
  deleteTask(id: string): Task | undefined;
  restoreTask(task: Task): void;

  addEvent(event: NewEvent): CalendarEvent;
  updateEvent(id: string, patch: Partial<CalendarEvent>): void;
  deleteEvent(id: string): CalendarEvent | undefined;
  restoreEvent(event: CalendarEvent): void;
}

function seed(): Pick<PlannerState, 'tasks' | 'events'> {
  const t = todayKey();
  const now = Date.now();
  return {
    events: [
      { id: uid(), title: 'Планёрка с командой', date: t, start: '10:00', end: '10:30', color: 'blue', createdAt: now },
      { id: uid(), title: 'Обед', date: t, start: '13:00', end: '14:00', color: 'green', createdAt: now },
      { id: uid(), title: 'Тренировка', date: addDays(t, 1), start: '19:00', end: '20:30', color: 'red', createdAt: now },
    ],
    tasks: [
      { id: uid(), title: 'Подготовить презентацию', done: false, date: t, priority: 'high', category: 'work', createdAt: now },
      { id: uid(), title: 'Купить продукты', done: false, date: addDays(t, 1), priority: 'medium', category: 'personal', createdAt: now },
      { id: uid(), title: 'Прочитать книгу', done: false, priority: 'low', category: 'study', createdAt: now },
      { id: uid(), title: 'Записаться к врачу', done: true, priority: 'medium', category: 'health', createdAt: now, completedAt: now },
    ],
  };
}

export const usePlannerStore = create<PlannerState>()(
  persist(
    (set, get) => ({
      ...seed(),

      addTask(input) {
        const task: Task = { ...input, id: uid(), done: false, createdAt: Date.now() };
        set((s) => ({ tasks: [task, ...s.tasks] }));
        return task;
      },
      updateTask(id, patch) {
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
      },
      toggleTask(id) {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, done: !t.done, completedAt: t.done ? undefined : Date.now() } : t,
          ),
        }));
      },
      deleteTask(id) {
        const task = get().tasks.find((t) => t.id === id);
        set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
        return task;
      },
      restoreTask(task) {
        set((s) => ({ tasks: [task, ...s.tasks.filter((t) => t.id !== task.id)] }));
      },

      addEvent(input) {
        const event: CalendarEvent = { ...input, id: uid(), createdAt: Date.now() };
        set((s) => ({ events: [...s.events, event] }));
        return event;
      },
      updateEvent(id, patch) {
        set((s) => ({ events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
      },
      deleteEvent(id) {
        const event = get().events.find((e) => e.id === id);
        set((s) => ({ events: s.events.filter((e) => e.id !== id) }));
        return event;
      },
      restoreEvent(event) {
        set((s) => ({ events: [...s.events.filter((e) => e.id !== event.id), event] }));
      },
    }),
    {
      name: STORAGE_KEYS.planner,
      storage,
      version: 1,
      partialize: (s) => ({ tasks: s.tasks, events: s.events }),
    },
  ),
);

/** Dates in [from, to] with at least one event (repeats expanded) or open task — drives calendar dots. */
export function useBusyDates(from: DateKey, to: DateKey): { events: Set<DateKey>; tasks: Set<DateKey> } {
  const events = usePlannerStore((s) => s.events);
  const tasks = usePlannerStore((s) => s.tasks);
  return useMemo(
    () => ({
      events: new Set(events.flatMap((e) => occurrencesBetween(e, from, to))),
      tasks: new Set(tasks.filter((t) => !t.done && t.date).map((t) => t.date!)),
    }),
    [events, tasks, from, to],
  );
}
