import type { Task } from '@/types';
import { SwipeableRow } from '@/components/SwipeableRow';
import { usePlannerStore } from '@/store/usePlannerStore';
import { useUIStore } from '@/store/useUIStore';
import { CATEGORY_META, PRIORITY_META } from '@/lib/meta';
import { humanDate, todayKey } from '@/lib/date';
import { atLabel, offsetLabel } from '@/lib/reminders';
import { haptic } from '@/lib/telegram';

interface TaskItemProps {
  task: Task;
  showDate?: boolean;
  onOpen(task: Task): void;
}

/** A row in an inset-grouped list, styled after iOS Reminders. */
export function TaskItem({ task, showDate = true, onOpen }: TaskItemProps) {
  const toggle = usePlannerStore((s) => s.toggleTask);
  const remove = usePlannerStore((s) => s.deleteTask);
  const restore = usePlannerStore((s) => s.restoreTask);
  const showToast = useUIStore((s) => s.showToast);
  const overdue = !task.done && task.date !== undefined && task.date < todayKey();

  const meta = [
    showDate && task.date ? humanDate(task.date) : null,
    task.time,
    task.remind && !task.done ? `🔔 ${task.remind.at ? atLabel(task.remind.at) : offsetLabel(task.remind.offset ?? 0).replace('в момент начала', 'вовремя')}` : null,
    `${CATEGORY_META[task.category].emoji} ${CATEGORY_META[task.category].label}`,
  ].filter(Boolean);

  return (
    <SwipeableRow
      onDelete={() => {
        const removed = remove(task.id);
        if (removed) showToast('Задача удалена', { label: 'Отменить', run: () => restore(removed) });
      }}
    >
      <div className="relative flex items-start gap-3 bg-surface py-[11px] pl-4 pr-4">
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
            className={`grid size-[22px] place-items-center rounded-full border-[1.5px] transition-colors duration-300 ${
              task.done ? 'border-blue' : 'border-faint'
            }`}
          >
            <span
              className={`size-[14px] rounded-full bg-blue transition-transform duration-500 ease-spring ${task.done ? 'scale-100' : 'scale-0'}`}
            />
          </span>
        </button>

        <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left active:opacity-60">
          <p
            className={`text-[17px] leading-[22px] decoration-[1.5px] transition-colors duration-300 ${
              task.done ? 'text-faint line-through decoration-faint' : ''
            }`}
          >
            {!task.done && task.priority !== 'medium' && (
              <span className={`mr-1 font-semibold ${task.priority === 'high' ? 'text-red' : 'text-muted'}`}>
                {PRIORITY_META[task.priority].marks}
              </span>
            )}
            {task.title}
          </p>
          <p className={`mt-0.5 truncate text-[15px] transition-colors duration-300 ${task.done ? 'text-faint' : overdue ? 'text-red' : 'text-muted'}`}>
            {meta.join(' · ')}
          </p>
        </button>

        <span className="sep absolute bottom-0 left-[52px] right-0 h-[0.5px] bg-line" />
      </div>
    </SwipeableRow>
  );
}
