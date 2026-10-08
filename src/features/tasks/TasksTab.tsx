import { useEffect, useMemo, useRef, useState } from 'react';
import { Inbox } from 'lucide-react';
import type { Category, Task } from '@/types';
import { Header } from '@/components/Header';
import { usePlannerStore } from '@/store/usePlannerStore';
import { useUIStore } from '@/store/useUIStore';
import { CATEGORY_META } from '@/lib/meta';
import { haptic } from '@/lib/telegram';
import { useFlip } from '@/hooks/useFlip';
import { todayKey } from '@/lib/date';
import { finishedLate, OVERDUE_FOLD_MS } from '@/lib/overdueCleanup';
import { QuickAdd } from './QuickAdd';
import { TaskItem } from './TaskItem';
import { TaskSheet } from './TaskSheet';

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/** Open tasks first (by priority, then date), completed ones sink to the bottom. */
function orderTasks(tasks: Task[]): string[] {
  const active = tasks
    .filter((t) => !t.done)
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        (a.date ?? '9999').localeCompare(b.date ?? '9999') ||
        (a.time ?? '99').localeCompare(b.time ?? '99') ||
        b.createdAt - a.createdAt,
    );
  const done = tasks.filter((t) => t.done).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  return [...active, ...done].map((t) => t.id);
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/** Start of today (local), ms. */
const startOfToday = () => new Date(`${todayKey()}T00:00:00`).getTime();

export function TasksTab() {
  const allTasks = usePlannerStore((s) => s.tasks);
  const hideDone = useUIStore((s) => s.hideDoneNextDay);
  // Done today: stays (grey, struck through) so you can see progress and undo a mis-tap.
  // Done before today: leaves the list (unless kept in Settings).
  const tasks = useMemo(() => {
    if (!hideDone) return allTasks;
    const today = startOfToday();
    return allTasks.filter((t) => !t.done || (t.completedAt ?? t.createdAt) >= today);
  }, [allTasks, hideDone]);
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [editing, setEditing] = useState<Task | null>(null);
  const list = useRef<HTMLDivElement>(null);

  // Deep link from a reminder: scroll to the task and make it glow for a moment.
  const focus = useUIStore((s) => s.focus);
  const setFocus = useUIStore((s) => s.setFocus);
  useEffect(() => {
    if (focus?.kind !== 'task') return;
    setFocus(null);
    window.setTimeout(() => {
      const row = list.current?.querySelector<HTMLElement>(`[data-flip-id="${focus.id}"]`);
      if (!row) return;
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.remove('flash');
      void row.offsetWidth; // restart the animation
      row.classList.add('flash');
    }, 450);
  }, [focus, setFocus]);
  useFlip(list);

  // Additions/removals apply instantly; a re-order after ticking a task waits a beat,
  // so the checkmark and strike-through are seen before the row glides down.
  const [order, setOrder] = useState(() => orderTasks(tasks));
  useEffect(() => {
    const next = orderTasks(tasks);
    if (!sameSet(next, order)) {
      setOrder(next);
      return;
    }
    if (next.join() === order.join()) return;
    const t = window.setTimeout(() => setOrder(next), 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  // A task finished after its deadline: once it has glided down, its row folds away
  // (useOverdueCleanup then removes it).
  useEffect(() => {
    const timers = tasks
      .filter((t) => finishedLate(t))
      .map((t) =>
        window.setTimeout(() => {
          const row = list.current?.querySelector<HTMLElement>(`[data-flip-id="${t.id}"]`);
          if (!row || row.dataset.folding) return;
          row.dataset.folding = '1';
          row.style.overflow = 'hidden';
          row.animate(
            [
              { height: `${row.offsetHeight}px`, opacity: 1, transform: 'scale(1)' },
              { height: '0px', opacity: 0, transform: 'scale(0.96)' },
            ],
            { duration: 320, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' },
          );
        }, Math.max(0, OVERDUE_FOLD_MS - (Date.now() - t.completedAt!))),
      );
    return () => timers.forEach((x) => window.clearTimeout(x));
  }, [tasks]);

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const visible = order
    .map((id) => byId.get(id))
    .filter((t): t is Task => Boolean(t) && (category === 'all' || t!.category === category));
  const activeCount = tasks.filter((t) => !t.done).length;

  return (
    <div className="flex h-full flex-col">
      <Header title="Задачи" subtitle={activeCount ? `${activeCount} активн${activeCount === 1 ? 'ая' : 'ых'}` : 'Всё сделано'} />

      <div className="pb-tabbar min-h-0 flex-1 overflow-y-auto">
        <div className="px-4">
          <QuickAdd />
        </div>

        <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-1 pt-3">
          {(['all', ...Object.keys(CATEGORY_META)] as (Category | 'all')[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                haptic.selection();
                setCategory(c);
              }}
              className={`shrink-0 rounded-full px-3.5 py-[7px] text-[14px] font-medium transition-all duration-300 ease-spring active:scale-95 ${
                category === c ? 'bg-blue text-white' : 'bg-surface text-fg'
              }`}
            >
              {c === 'all' ? 'Все' : `${CATEGORY_META[c].emoji} ${CATEGORY_META[c].label}`}
            </button>
          ))}
        </div>

        <div className="px-4 pt-4">
          {visible.length ? (
            <div ref={list} className="overflow-hidden rounded-[16px] bg-surface [&>*:first-child_.sep]:hidden">
              {visible.map((t) => (
                <div key={t.id} data-flip-id={t.id} className="relative bg-surface">
                  <TaskItem task={t} onOpen={setEditing} />
                </div>
              ))}
            </div>
          ) : (
            <div className="animate-fade-up flex flex-col items-center gap-3 py-14 text-center text-muted">
              <Inbox className="size-10 text-faint" strokeWidth={1.4} />
              <p className="max-w-60 text-[15px]">
                {tasks.length ? 'В этой категории задач нет' : 'Задач пока нет. Добавьте первую выше или попросите ассистента.'}
              </p>
            </div>
          )}
        </div>
      </div>

      <TaskSheet task={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
