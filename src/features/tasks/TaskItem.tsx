import { Check, Clock } from 'lucide-react';
import type { Task } from '@/types';
import { SwipeableRow } from '@/components/SwipeableRow';
import { usePlannerStore } from '@/store/usePlannerStore';
import { useUIStore } from '@/store/useUIStore';
import { CATEGORY_META, PRIORITY_META } from '@/lib/meta';
import { humanDate, todayKey } from '@/lib/date';
import { haptic } from '@/lib/telegram';

interface TaskItemProps {
  task: Task;
  showDate?: boolean;
  onOpen(task: Task): void;
}

export function TaskItem({ task, showDate = true, onOpen }: TaskItemProps) {
  const toggle = usePlannerStore((s) => s.toggleTask);
  const remove = usePlannerStore((s) => s.deleteTask);
  const restore = usePlannerStore((s) => s.restoreTask);
  const showToast = useUIStore((s) => s.showToast);
  const overdue = !task.done && task.date !== undefined && task.date < todayKey();

  return (
    <SwipeableRow
      onDelete={() => {
        const removed = remove(task.id);
        if (removed) showToast('Задача удалена', { label: 'Отменить', run: () => restore(removed) });
      }}
    >
      <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 shadow-card">
        <button
          type="button"
          role="checkbox"
          aria-checked={task.done}
          aria-label={task.done ? 'Отметить невыполненной' : 'Отметить выполненной'}
          onClick={() => {
            if (task.done) haptic.impact('light');
            else haptic.notify('success');
            toggle(task.id);
          }}
          className="-m-2 grid shrink-0 place-items-center p-2"
        >
          <span
            className={`grid size-[22px] place-items-center rounded-full border-2 transition-all duration-200 ${
              task.done
                ? 'animate-check-pop border-transparent bg-gemini text-white'
                : task.priority === 'high'
                  ? 'border-red/70'
                  : 'border-faint/70'
            }`}
          >
            {task.done && <Check className="size-3.5" strokeWidth={3.5} />}
          </span>
        </button>

        <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left">
          <p className={`text-[15px] leading-snug transition-colors ${task.done ? 'text-faint line-through' : ''}`}>{task.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {showDate && task.date && (
              <span className={`inline-flex items-center gap-1 text-xs ${overdue ? 'font-semibold text-red' : 'text-muted'}`}>
                {humanDate(task.date)}
              </span>
            )}
            {task.time && (
              <span className="inline-flex items-center gap-1 text-xs text-muted">
                <Clock className="size-3" />
                {task.time}
              </span>
            )}
            {!task.done && task.priority !== 'medium' && (
              <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${PRIORITY_META[task.priority].className}`}>
                {PRIORITY_META[task.priority].label}
              </span>
            )}
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
              {CATEGORY_META[task.category].emoji} {CATEGORY_META[task.category].label}
            </span>
          </div>
        </button>
      </div>
    </SwipeableRow>
  );
}
