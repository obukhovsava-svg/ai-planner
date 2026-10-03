import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CalendarEvent, DateKey, Task } from '@/types';
import { STORAGE_KEYS, storage, uid } from '@/lib/storage';
import { occurrencesBetween } from '@/lib/recurrence';
import type { PlannerDoc } from '@/lib/merge';

export type NewTask = Omit<Task, 'id' | 'done' | 'createdAt' | 'completedAt'>;
export type NewEvent = Omit<CalendarEvent, 'id' | 'createdAt'>;

interface PlannerState {
  tasks: Task[];
  events: CalendarEvent[];
  /** Deleted ids → deletion time; synced so other devices drop them too. */
  deleted: Record<string, number>;

  addTask(task: NewTask): Task;
  updateTask(id: string, patch: Partial<Task>): void;
  toggleTask(id: string): void;
  deleteTask(id: string): Task | undefined;
  restoreTask(task: Task): void;

  addEvent(event: NewEvent): CalendarEvent;
  updateEvent(id: string, patch: Partial<CalendarEvent>): void;
  deleteEvent(id: string): CalendarEvent | undefined;
  restoreEvent(event: CalendarEvent): void;

  /** Replace everything with the merged server copy (sync). */
  replaceAll(doc: PlannerDoc): void;
}

const now = () => Date.now();
const without = (deleted: Record<string, number>, id: string) => {
  const { [id]: _gone, ...rest } = deleted;
  return rest;
};

export const usePlannerStore = create<PlannerState>()(
  persist(
    (set, get) => ({
      tasks: [],
      events: [],
      deleted: {},

      addTask(input) {
        const task: Task = { ...input, id: uid(), done: false, createdAt: now(), updatedAt: now() };
        set((s) => ({ tasks: [task, ...s.tasks] }));
        return task;
      },
      updateTask(id, patch) {
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: now() } : t)) }));
      },
      toggleTask(id) {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, done: !t.done, completedAt: t.done ? undefined : now(), updatedAt: now() } : t,
          ),
        }));
      },
      deleteTask(id) {
        const task = get().tasks.find((t) => t.id === id);
        set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id), deleted: { ...s.deleted, [id]: now() } }));
        return task;
      },
      restoreTask(task) {
        const restored = { ...task, updatedAt: now() };
        set((s) => ({ tasks: [restored, ...s.tasks.filter((t) => t.id !== task.id)], deleted: without(s.deleted, task.id) }));
      },

      addEvent(input) {
        const event: CalendarEvent = { ...input, id: uid(), createdAt: now(), updatedAt: now() };
        set((s) => ({ events: [...s.events, event] }));
        return event;
      },
      updateEvent(id, patch) {
        set((s) => ({ events: s.events.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: now() } : e)) }));
      },
      deleteEvent(id) {
        const event = get().events.find((e) => e.id === id);
        set((s) => ({ events: s.events.filter((e) => e.id !== id), deleted: { ...s.deleted, [id]: now() } }));
        return event;
      },
      restoreEvent(event) {
        const restored = { ...event, updatedAt: now() };
        set((s) => ({ events: [...s.events.filter((e) => e.id !== event.id), restored], deleted: without(s.deleted, event.id) }));
      },

      replaceAll(doc) {
        set({ tasks: doc.tasks, events: doc.events, deleted: doc.deleted });
      },
    }),
    {
      name: STORAGE_KEYS.planner,
      storage,
      version: 2,
      partialize: (s) => ({ tasks: s.tasks, events: s.events, deleted: s.deleted }),
      // v1 had no tombstones / updatedAt — createdAt serves as the first stamp.
      migrate: (state) => ({ deleted: {}, ...(state as object) }) as PlannerState,
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
