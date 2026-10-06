import { useEffect, useState } from 'react';
import { CalendarDays, ChevronRight, Trash2 } from 'lucide-react';
import type { Category, Priority, Task } from '@/types';
import { Sheet } from '@/components/Sheet';
import { DatePickerSheet, formatDateTime } from '@/components/DatePickerSheet';
import { RemindRow } from '@/components/RemindRow';
import { usePlannerStore } from '@/store/usePlannerStore';
import { useUIStore } from '@/store/useUIStore';
import { CATEGORY_META, PRIORITY_META } from '@/lib/meta';
import { haptic } from '@/lib/telegram';
import { addDays } from '@/lib/date';

const fieldClass =
  'block w-full min-w-0 max-w-full appearance-none rounded-[14px] bg-surface px-4 py-[11px] text-[17px] text-fg outline-none placeholder:text-faint';

/**
 * The reminder after the task's date / time changed:
 *  • with a time → "N minutes before" (an exact moment becomes "at the time");
 *  • a date without a time → an exact moment that day (keeps the chosen time and "накануне" shift);
 *  • no date → only an exact moment survives.
 */
function keepRemind(task: Task, date?: string, time?: string): Task['remind'] {
  const r = task.remind;
  if (!r) return undefined;
  if (!date) return r.at ? r : undefined;
  if (time) return r.at ? { offset: 0 } : r;
  const [atDate, atTime = '09:00'] = r.at?.split('T') ?? [];
  const before = task.date && atDate ? Math.max(0, Math.round((new Date(`${task.date}T00:00`).getTime() - new Date(`${atDate}T00:00`).getTime()) / 86_400_000)) : 0;
  return { at: `${addDays(date, -Math.min(before, 2))}T${atTime}` };
}

export function TaskSheet({ task, onClose }: { task: Task | null; onClose(): void }) {
  const updateTask = usePlannerStore((s) => s.updateTask);
  const deleteTask = usePlannerStore((s) => s.deleteTask);
  const restoreTask = usePlannerStore((s) => s.restoreTask);
  const showToast = useUIStore((s) => s.showToast);
  const [form, setForm] = useState<Task | null>(task);
  const [picker, setPicker] = useState(false);

  // Keep the last task while the sheet animates out.
  useEffect(() => {
    if (task) setForm(task);
  }, [task]);
  if (!form) return null;

  const set = <K extends keyof Task>(k: K, v: Task[K]) => setForm({ ...form, [k]: v });

  return (
    <Sheet open={Boolean(task)} title="Задача" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.title.trim()) return;
          updateTask(form.id, { ...form, title: form.title.trim() });
          haptic.notify('success');
          onClose();
        }}
      >
        <input className={`${fieldClass} font-medium`} value={form.title} onChange={(e) => set('title', e.target.value)} />

        <button
          type="button"
          onClick={() => {
            haptic.selection();
            setPicker(true);
          }}
          className="flex items-center gap-3 rounded-[16px] bg-surface px-4 py-[11px] text-left transition-colors active:bg-surface-2"
        >
          <span className="grid size-[30px] place-items-center rounded-[7px] bg-red text-white">
            <CalendarDays className="size-[18px]" />
          </span>
          <span className="flex-1 text-[17px]">Дата</span>
          <span className={`text-[17px] ${form.date ? 'text-blue' : 'text-muted'}`}>{formatDateTime(form)}</span>
          <ChevronRight className="size-5 text-faint" />
        </button>

        <textarea
          rows={2}
          className={`${fieldClass} resize-none`}
          placeholder="Заметка"
          value={form.note ?? ''}
          onChange={(e) => set('note', e.target.value || undefined)}
        />

        <RemindRow
          value={form.remind}
          onChange={(r) => setForm({ ...form, remind: r })}
          hasDate={Boolean(form.date)}
          timeMissing={Boolean(form.date && !form.time)}
          date={form.date}
        />

        <div className="flex flex-col gap-1.5">
          <span className="px-4 text-[13px] uppercase text-muted">Приоритет</span>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(PRIORITY_META) as Priority[]).reverse().map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  haptic.selection();
                  set('priority', p);
                }}
                className={`rounded-full py-2.5 text-[15px] font-medium transition-all duration-300 ease-spring active:scale-95 ${
                  form.priority === p ? 'bg-blue text-white' : 'bg-surface text-fg'
                }`}
              >
                {PRIORITY_META[p].label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="px-4 text-[13px] uppercase text-muted">Категория</span>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CATEGORY_META) as Category[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  haptic.selection();
                  set('category', c);
                }}
                className={`rounded-full px-3.5 py-2 text-[15px] transition-all duration-300 ease-spring active:scale-95 ${form.category === c ? 'bg-blue text-white' : 'bg-surface text-fg'}`}
              >
                {CATEGORY_META[c].emoji} {CATEGORY_META[c].label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            aria-label="Удалить задачу"
            onClick={() => {
              const removed = deleteTask(form.id);
              haptic.notify('warning');
              onClose();
              if (removed) showToast('Задача удалена', { label: 'Отменить', run: () => restoreTask(removed) });
            }}
            className="grid size-[50px] shrink-0 place-items-center rounded-full bg-surface text-red transition-transform duration-300 ease-spring active:scale-95"
          >
            <Trash2 className="size-5" />
          </button>
          <button
            type="submit"
            disabled={!form.title.trim()}
            className="h-[50px] flex-1 rounded-full bg-blue text-[17px] font-semibold text-white transition-[transform,opacity] duration-300 ease-spring active:scale-[0.97] active:opacity-80 disabled:opacity-30"
          >
            Сохранить
          </button>
        </div>
      </form>
      <DatePickerSheet
        open={picker}
        value={{ date: form.date, time: form.time }}
        onChange={({ date, time }) =>
          setForm({
            ...form,
            date,
            time,
            remind: keepRemind(form, date, time),
          })
        }
        onClose={() => setPicker(false)}
      />
    </Sheet>
  );
}
