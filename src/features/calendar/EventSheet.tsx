import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { CalendarEvent, EventColor } from '@/types';
import { Sheet } from '@/components/Sheet';
import { usePlannerStore } from '@/store/usePlannerStore';
import { useUIStore } from '@/store/useUIStore';
import { EVENT_COLORS } from '@/lib/meta';
import { minutesToTime, timeToMinutes } from '@/lib/date';
import { haptic } from '@/lib/telegram';

export type EventDraft = Omit<CalendarEvent, 'id' | 'createdAt'> & { id?: string };

interface EventSheetProps {
  draft: EventDraft | null;
  onClose(): void;
}

const fieldClass =
  'w-full rounded-[10px] bg-surface px-4 py-[11px] text-[17px] text-fg outline-none placeholder:text-faint';

export function EventSheet({ draft, onClose }: EventSheetProps) {
  const addEvent = usePlannerStore((s) => s.addEvent);
  const updateEvent = usePlannerStore((s) => s.updateEvent);
  const deleteEvent = usePlannerStore((s) => s.deleteEvent);
  const restoreEvent = usePlannerStore((s) => s.restoreEvent);
  const showToast = useUIStore((s) => s.showToast);
  const [form, setForm] = useState<EventDraft | null>(draft);

  useEffect(() => setForm(draft), [draft]);

  if (!form) return null;
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => setForm({ ...form, [k]: v });
  const invalid = !form.title.trim() || timeToMinutes(form.end) <= timeToMinutes(form.start);

  const save = () => {
    if (invalid) return;
    const { id, ...data } = form;
    const payload = { ...data, title: data.title.trim() };
    if (id) updateEvent(id, payload);
    else addEvent(payload);
    haptic.notify('success');
    onClose();
  };

  const remove = () => {
    if (!form.id) return;
    const removed = deleteEvent(form.id);
    haptic.notify('warning');
    onClose();
    if (removed) showToast('Событие удалено', { label: 'Отменить', run: () => restoreEvent(removed) });
  };

  return (
    <Sheet open title={form.id ? 'Событие' : 'Новое событие'} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          autoFocus={!form.id}
          className={`${fieldClass} font-medium`}
          placeholder="Название"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
        />

        <label className="flex flex-col gap-1.5">
          <span className="px-4 text-[13px] uppercase text-muted">Дата</span>
          <input type="date" className={fieldClass} value={form.date} onChange={(e) => e.target.value && set('date', e.target.value)} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="px-4 text-[13px] uppercase text-muted">Начало</span>
            <input
              type="time"
              className={fieldClass}
              value={form.start}
              onChange={(e) => {
                const start = e.target.value;
                if (!start) return;
                // Keep the duration when moving the start time.
                const dur = timeToMinutes(form.end) - timeToMinutes(form.start);
                setForm({ ...form, start, end: minutesToTime(timeToMinutes(start) + Math.max(dur, 15)) });
              }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="px-4 text-[13px] uppercase text-muted">Конец</span>
            <input type="time" className={fieldClass} value={form.end} onChange={(e) => e.target.value && set('end', e.target.value)} />
          </label>
        </div>
        {timeToMinutes(form.end) <= timeToMinutes(form.start) && (
          <p className="-mt-2 text-xs text-red">Конец должен быть позже начала</p>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="px-4 text-[13px] uppercase text-muted">Цвет</span>
          <div className="flex justify-between rounded-[10px] bg-surface px-4 py-3">
            {(Object.keys(EVENT_COLORS) as EventColor[]).map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => {
                  haptic.selection();
                  set('color', c);
                }}
                className={`size-8 rounded-full ${EVENT_COLORS[c].dot} transition-transform duration-300 ease-spring ${
                  form.color === c ? 'scale-110 ring-[2.5px] ring-fg/80 ring-offset-2 ring-offset-surface' : 'scale-90'
                }`}
              />
            ))}
          </div>
        </div>

        <textarea
          rows={2}
          className={`${fieldClass} resize-none`}
          placeholder="Заметка"
          value={form.note ?? ''}
          onChange={(e) => set('note', e.target.value || undefined)}
        />

        <div className="flex gap-3 pt-1">
          {form.id && (
            <button
              type="button"
              onClick={remove}
              aria-label="Удалить событие"
              className="grid size-[50px] shrink-0 place-items-center rounded-[14px] bg-surface text-red transition-transform duration-300 ease-spring active:scale-95"
            >
              <Trash2 className="size-5" />
            </button>
          )}
          <button
            type="submit"
            disabled={invalid}
            className="h-[50px] flex-1 rounded-[14px] bg-blue text-[17px] font-semibold text-white transition-[transform,opacity] duration-300 ease-spring active:scale-[0.97] active:opacity-80 disabled:opacity-30"
          >
            {form.id ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
