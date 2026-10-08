/**
 * A task finished after its deadline doesn't stay in the list: it glides to the bottom with
 * the other completed tasks (TasksTab animates it) and is removed a moment later, with
 * «Отменить» in the toast. Works however it was completed — tap, assistant, bot, Shortcut.
 * Only tasks completed just now count, so older history is never swept away in bulk.
 */
import { useEffect, useRef } from 'react';
import type { Task } from '@/types';
import { usePlannerStore } from '@/store/usePlannerStore';
import { useUIStore } from '@/store/useUIStore';
import { toKey } from './date';

/** Delay before removal: the tick, the glide down, then the row folds away (TasksTab). */
export const OVERDUE_REMOVE_MS = 1450;
export const OVERDUE_FOLD_MS = 1100;

/** Completed just now, after its deadline day. */
export function finishedLate(t: Task, now = Date.now()): boolean {
  return Boolean(t.done && t.date && t.completedAt && now - t.completedAt < 15_000 && t.date < toKey(new Date(t.completedAt)));
}

export function useOverdueCleanup() {
  const timers = useRef(new Map<string, number>());
  const tasks = usePlannerStore((s) => s.tasks);

  useEffect(() => {
    const live = timers.current;
    // Un-ticked (or deleted) in the meantime → keep it.
    for (const [id, timer] of live) {
      const t = tasks.find((x) => x.id === id);
      if (!t || !t.done) {
        window.clearTimeout(timer);
        live.delete(id);
      }
    }
    for (const t of tasks) {
      if (live.has(t.id) || !finishedLate(t)) continue;
      const wait = Math.max(0, OVERDUE_REMOVE_MS - (Date.now() - t.completedAt!));
      live.set(
        t.id,
        window.setTimeout(() => {
          live.delete(t.id);
          const store = usePlannerStore.getState();
          const current = store.tasks.find((x) => x.id === t.id);
          if (!current?.done) return;
          const removed = store.deleteTask(t.id);
          if (removed)
            useUIStore.getState().showToast('Просроченная задача выполнена и убрана', {
              label: 'Отменить',
              run: () => {
                const s = usePlannerStore.getState();
                s.restoreTask(removed);
                s.toggleTask(removed.id); // back to undone — most likely a mis-tap
              },
            });
        }, wait),
      );
    }
  }, [tasks]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
}
