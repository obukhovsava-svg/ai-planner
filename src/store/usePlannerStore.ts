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
  /** Two-way step with the device's calendar; `revive` also returns meetings removed from the planner. */
  reconcileDevice(items: DeviceItem[], owner: string, revive: boolean): { ops: DeviceOp[]; reverted: number; waiting: boolean };
}

const now = () => Date.now();

/** A meeting as the app reads it from the calendar; `ref` finds it there again. */
export type DeviceItem = CalendarEvent & { ref?: { eid: string; at: number }; modified?: number };
export type DeviceOp =
  | { op: 'update'; ref: { eid: string; at: number }; title: string; date: string; start: string; end: string; note?: string }
  | { op: 'remove'; ref: { eid: string; at: number } };

const DELETE_GRACE = 8000;
/** Marks a delete made by the user (synced with the tombstones, so any device's copy can act on it). */
const calendarDeleteKey = (id: string) => `calendar-delete:${id}`;
const deviceSig = (e: CalendarEvent, cut?: boolean) => JSON.stringify([e.title, e.date, e.start, e.end, cut ? null : (e.note ?? null)]);
/** The same meeting seen from two devices: each calendar account may give it its own identifier. */
const meetingKey = (e: CalendarEvent) => JSON.stringify([e.title, e.date, e.start, e.end]);
/** What was last sent to the calendar for a meeting. */
const pushed = new Map<string, string>();
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
        const at = now();
        const mark = event?.device && !event.device.readOnly ? { [calendarDeleteKey(id)]: at } : {};
        set((s) => ({ events: s.events.filter((e) => e.id !== id), deleted: { ...s.deleted, [id]: at, ...mark } }));
        return event;
      },
      restoreEvent(event) {
        const restored = { ...event, updatedAt: now() };
        set((s) => ({ events: [...s.events.filter((e) => e.id !== event.id), restored], deleted: without(s.deleted, event.id) }));
      },

      replaceAll(doc) {
        set({ tasks: doc.tasks, events: doc.events, deleted: doc.deleted });
      },
      reconcileDevice(items, owner, revive) {
        const s = get();
        const stamp = now();
        const deleted = { ...s.deleted };
        const events: CalendarEvent[] = [];
        const ops: DeviceOp[] = [];
        let reverted = 0;
        let waiting = false;
        let changed = false;
        const fresh = new Map(items.map((i) => [i.id, i]));
        // One copy per meeting, whichever devices brought it in: the same one survives on every device.
        // Only the planner's copy goes (a tombstone, no calendar-delete mark): the calendars aren't touched.
        const keeper = new Map<string, string>();
        for (const e of s.events) {
          if (!e.device) continue;
          const k = meetingKey(e);
          const o = e.device.owner ?? '';
          if (!keeper.has(k) || o < keeper.get(k)!) keeper.set(k, o);
        }
        for (const e of s.events) {
          const item = e.device && fresh.get(e.id);
          if (e.device && (e.device.owner ?? '') !== keeper.get(meetingKey(e))) {
            if (item) fresh.delete(e.id);
            deleted[e.id] = stamp;
            changed = true;
          } else if (!e.device) events.push(e);
          else if (item) {
            fresh.delete(e.id);
            const cut = item.device!.noteCut;
            const there = deviceSig(item, cut);
            const here = deviceSig(e, cut);
            const last = e.device.sig;
            const device = { ...item.device!, owner: e.device.owner, sig: there, noteSeen: item.note ?? '' };
            // Brought in before descriptions were cleaned: the calendar's version replaces it, nothing goes back.
            const legacy = e.device.noteSeen === undefined;
            if (there === here && !legacy) {
              // A digest stays out of the comparison: only a new description in the calendar replaces it.
              if (cut && e.device.noteSeen !== device.noteSeen) {
                events.push({ ...e, note: item.note, device, updatedAt: stamp });
                changed = true;
                continue;
              }
              // In step. Only the bookkeeping may be behind (no new stamp: nothing the user sees changed).
              const same = (['calendar', 'location', 'allDay', 'readOnly', 'noteCut', 'sig'] as const).every((k) => e.device![k] === device[k]);
              if (same) events.push(e);
              else {
                events.push({ ...e, device });
                changed = true;
              }
              pushed.delete(e.id);
              continue;
            }
            const editedHere = here !== last && !legacy;
            const newerHere = there === last || e.updatedAt! > item.modified!;
            // A write that didn't take (declined, or the server reformatted it) isn't retried forever.
            if (editedHere && newerHere && !item.device!.readOnly && pushed.get(e.id) !== here) {
              pushed.set(e.id, here);
              ops.push({ op: 'update', ref: item.ref!, title: e.title, date: e.date, start: e.start, end: e.end, note: cut ? undefined : (e.note ?? '') });
              events.push(e);
              continue;
            }
            if (editedHere) reverted++;
            pushed.delete(e.id);
            const { ref: _ref, modified: _modified, ...data } = item;
            events.push({ ...data, color: e.color, remind: e.remind, createdAt: e.createdAt, updatedAt: stamp, device });
            changed = true;
          } else if (e.device.owner === owner) {
            deleted[e.id] = stamp;
            changed = true;
          } else events.push(e);
        }
        for (const item of fresh.values()) {
          // Deleted by the user (the mark and the tombstone agree) → from the calendar too, once «Отменить» has passed.
          const mark = deleted[calendarDeleteKey(item.id)];
          if (mark && mark === deleted[item.id] && !item.device!.readOnly) {
            if (stamp - mark > DELETE_GRACE) ops.push({ op: 'remove', ref: item.ref! });
            else waiting = true;
            continue;
          }
          if (deleted[item.id] && !revive) continue; // removed from the planner: stays removed
          if (keeper.has(meetingKey(item))) continue; // another device has already brought it in
          delete deleted[item.id];
          const { ref: _ref, modified: _modified, ...data } = item;
          const cut = item.device!.noteCut;
          events.push({ ...data, createdAt: stamp, updatedAt: stamp, device: { ...item.device!, owner, sig: deviceSig(item, cut), noteSeen: item.note ?? '' } });
          changed = true;
        }
        if (changed) set({ events, deleted });
        return { ops, reverted, waiting };
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
