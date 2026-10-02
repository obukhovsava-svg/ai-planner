import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { Category, Priority, Task } from '@/types';
import { Sheet } from '@/components/Sheet';
import { usePlannerStore } from '@/store/usePlannerStore';
import { useUIStore } from '@/store/useUIStore';
import { CATEGORY_META, PRIORITY_META } from '@/lib/meta';
import { haptic } from '@/lib/telegram';

const fieldClass =
  'w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-fg outline-none transition-colors placeholder:text-faint focus:border-blue';

export function TaskSheet({ task, onClose }: { task: Task | null; onClose(): void }) {
  const updateTask = usePlannerStore((s) => s.updateTask);
  const deleteTask = usePlannerStore((s) => s.deleteTask);
  const restoreTask = usePlannerStore((s) => s.restoreTask);
  const showToast = useUIStore((s) => s.showToast);
  const [form, setForm] = useState<Task | null>(task);

  useEffect(() => setForm(task), [task]);
  if (!form) return null;

  const set = <K extends keyof Task>(k: K, v: Task[K]) => setForm({ ...form, [k]: v });

  return (
    <Sheet open title="Задача" onClose={onClose}>
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
        <input className={`${fieldClass} text-lg font-medium`} value={form.title} onChange={(e) => set('title', e.target.value)} />

        <div className="grid grid-cols-[1fr_auto] gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Дата</span>
            <div className="relative">
              <input type="date" className={fieldClass} value={form.date ?? ''} onChange={(e) => set('date', e.target.value || undefined)} />
              {form.date && (
                <button
                  type="button"
                  aria-label="Убрать дату"
                  onClick={() => setForm({ ...form, date: undefined, time: undefined })}
                  className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-line text-muted"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </label>
          <label className="flex w-28 flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Время</span>
            <input
              type="time"
              disabled={!form.date}
              className={`${fieldClass} disabled:opacity-40`}
              value={form.time ?? ''}
              onChange={(e) => set('time', e.target.value || undefined)}
            />
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Приоритет</span>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(PRIORITY_META) as Priority[]).reverse().map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  haptic.selection();
                  set('priority', p);
                }}
                className={`rounded-xl py-2 text-sm font-semibold transition ${
                  form.priority === p ? `${PRIORITY_META[p].className} ring-2 ring-current` : 'bg-surface-2 text-muted'
                }`}
              >
                {PRIORITY_META[p].label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Категория</span>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CATEGORY_META) as Category[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  haptic.selection();
                  set('category', c);
                }}
                className={`rounded-full px-3 py-1.5 text-sm transition ${form.category === c ? 'bg-fg text-bg' : 'bg-surface-2 text-muted'}`}
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
            className="grid size-12 shrink-0 place-items-center rounded-2xl bg-red/10 text-red active:scale-95"
          >
            <Trash2 className="size-5" />
          </button>
          <button
            type="submit"
            disabled={!form.title.trim()}
            className="h-12 flex-1 rounded-2xl bg-gemini font-semibold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-40"
          >
            Сохранить
          </button>
        </div>
      </form>
    </Sheet>
  );
}
