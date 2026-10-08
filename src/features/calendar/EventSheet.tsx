import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronRight, Repeat as RepeatIcon, Trash2 } from 'lucide-react';
import type { CalendarEvent, DateKey, EventColor, Repeat } from '@/types';
import { Sheet } from '@/components/Sheet';
import { DatePickerSheet } from '@/components/DatePickerSheet';
import { RemindRow } from '@/components/RemindRow';
import { REPEAT_OPTIONS, repeatLabel, sameRule } from '@/lib/recurrence';
import { usePlannerStore } from '@/store/usePlannerStore';
import { useUIStore } from '@/store/useUIStore';
import { EVENT_COLORS } from '@/lib/meta';
import { addDays, diffDays, humanDate, minutesToTime, timeToMinutes } from '@/lib/date';
import { haptic } from '@/lib/telegram';

export type EventDraft = Omit<CalendarEvent, 'id' | 'createdAt'> & {
  id?: string;
  /** For a repeating event opened from a specific day: that occurrence's date. */
  occurrence?: DateKey;
  /** …and the series' first date, so edits to the date shift the whole series. */
  seriesDate?: DateKey;
};

interface EventSheetProps {
  draft: EventDraft | null;
  onClose(): void;
}

const fieldClass =
  'block w-full min-w-0 max-w-full appearance-none rounded-[14px] bg-surface px-4 py-[11px] text-[17px] text-fg outline-none placeholder:text-faint';

export function EventSheet({ draft, onClose }: EventSheetProps) {
  const addEvent = usePlannerStore((s) => s.addEvent);
  const updateEvent = usePlannerStore((s) => s.updateEvent);
  const deleteEvent = usePlannerStore((s) => s.deleteEvent);
  const restoreEvent = usePlannerStore((s) => s.restoreEvent);
  const showToast = useUIStore((s) => s.showToast);
  const [form, setForm] = useState<EventDraft | null>(draft);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [untilOpen, setUntilOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Keep the last draft while the sheet animates out.
  useEffect(() => {
    if (draft) {
      setForm(draft);
      setConfirmDelete(false);
    }
  }, [draft]);

  if (!form) return null;
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => setForm({ ...form, [k]: v });
  /**
   * Closing saves: a new event is added once it has a name (no name → nothing is created),
   * an existing one is updated if anything changed. An end before the start becomes +1 h.
   */
  const save = () => {
    const title = form.title.trim() || (form.id ? (draft?.title ?? '') : '');
    if (!title) return onClose();
    if (form.id && draft && JSON.stringify({ ...form, title }) === JSON.stringify(draft)) return onClose();
    const { id, occurrence, seriesDate, ...data } = form;
    const end = timeToMinutes(data.end) > timeToMinutes(data.start) ? data.end : minutesToTime(Math.min(timeToMinutes(data.start) + 60, 23 * 60 + 59));
    // Editing one occurrence's date moves the whole series by the same number of days.
    const date = id && occurrence && seriesDate ? addDays(seriesDate, diffDays(data.date, occurrence)) : data.date;
    const repeat = data.repeat?.until && data.repeat.until < date ? { ...data.repeat, until: undefined } : data.repeat;
    const payload = { ...data, end, date, repeat, title };
    if (id) updateEvent(id, payload);
    else {
      addEvent(payload);
      haptic.notify('success');
    }
    onClose();
  };

  const removeAll = () => {
    if (!form.id) return;
    const removed = deleteEvent(form.id);
    haptic.notify('warning');
    onClose();
    if (removed) showToast(removed.repeat ? 'Все повторы удалены' : 'Событие удалено', { label: 'Отменить', run: () => restoreEvent(removed) });
  };

  /** "Only this event": add the occurrence to the series' exceptions. */
  const removeOne = () => {
    if (!form.id || !form.occurrence || !form.repeat) return;
    const id = form.id;
    const prev = form.repeat;
    updateEvent(id, { repeat: { ...prev, exceptions: [...(prev.exceptions ?? []), form.occurrence] } });
    haptic.notify('warning');
    onClose();
    showToast('Событие удалено', { label: 'Отменить', run: () => updateEvent(id, { repeat: prev }) });
  };

  const isRecurringInstance = Boolean(form.id && form.repeat && form.occurrence);

  return (
    <Sheet open={Boolean(draft)} title={form.id ? 'Событие' : 'Новое событие'} onClose={save} done>
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

        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="px-4 text-[13px] uppercase text-muted">Дата</span>
          <input type="date" className={fieldClass} value={form.date} onChange={(e) => e.target.value && set('date', e.target.value)} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex min-w-0 flex-col gap-1.5">
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
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="px-4 text-[13px] uppercase text-muted">Конец</span>
            <input type="time" className={fieldClass} value={form.end} onChange={(e) => e.target.value && set('end', e.target.value)} />
          </label>
        </div>
        {timeToMinutes(form.end) <= timeToMinutes(form.start) && (
          <p className="-mt-2 px-4 text-[13px] text-muted">Конец раньше начала — сохраню на час позже начала</p>
        )}

        <div className="overflow-hidden rounded-[16px] bg-surface">
          <Row icon={<RepeatIcon className="size-[17px]" />} label="Повтор" value={repeatLabel(form.repeat)} onClick={() => setRepeatOpen(true)} />
          {form.repeat && (
            <div className="animate-fade-in border-t-[0.5px] border-line">
              <Row
                label="Окончание повтора"
                value={form.repeat.until ? `до ${humanDate(form.repeat.until, { relative: false })}` : 'Никогда'}
                onClick={() => setUntilOpen(true)}
              />
            </div>
          )}
        </div>

        <RemindRow value={form.remind} onChange={(r) => set('remind', r)} hasDate />

        <div className="flex flex-col gap-1.5">
          <span className="px-4 text-[13px] uppercase text-muted">Цвет</span>
          <div className="flex justify-between rounded-[16px] bg-surface px-4 py-3">
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

        {confirmDelete ? (
          <div className="animate-fade-up flex flex-col gap-2 pt-1">
            <div className="overflow-hidden rounded-[18px] bg-surface">
              <p className="px-4 pb-2 pt-3 text-center text-[13px] text-muted">Это повторяющееся событие</p>
              <button type="button" onClick={removeOne} className="w-full border-t-[0.5px] border-line py-3.5 text-[17px] text-red active:bg-surface-2">
                Удалить только это событие
              </button>
              <button type="button" onClick={removeAll} className="w-full border-t-[0.5px] border-line py-3.5 text-[17px] text-red active:bg-surface-2">
                Удалить все повторы
              </button>
            </div>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="h-[50px] rounded-full bg-surface text-[17px] font-semibold text-blue active:bg-surface-2"
            >
              Отмена
            </button>
          </div>
        ) : (
          form.id && (
            <button
              type="button"
              onClick={() => (isRecurringInstance ? setConfirmDelete(true) : removeAll())}
              className="mt-1 flex h-[50px] items-center justify-center gap-2 rounded-[14px] bg-surface text-[17px] text-red transition-colors active:bg-surface-2"
            >
              <Trash2 className="size-[18px]" />
              Удалить событие
            </button>
          )
        )}
      </form>

      <Sheet open={repeatOpen} title="Повтор" onClose={() => setRepeatOpen(false)}>
        <div className="overflow-hidden rounded-[16px] bg-surface">
          {form.repeat && !REPEAT_OPTIONS.some((o) => sameRule(o.value, form.repeat)) && (
            <div className="flex w-full items-center justify-between border-b-[0.5px] border-line px-4 py-[11px] text-[17px]">
              {repeatLabel(form.repeat)}
              <Check className="size-5 text-blue" strokeWidth={2.6} />
            </div>
          )}
          {REPEAT_OPTIONS.map((o, i) => (
            <button
              key={o.label}
              type="button"
              onClick={() => {
                setForm({ ...form, repeat: o.value ? { ...o.value, until: form.repeat?.until } : undefined });
                setRepeatOpen(false);
              }}
              className={`flex w-full items-center justify-between px-4 py-[11px] text-left text-[17px] active:bg-surface-2 ${i ? 'border-t-[0.5px] border-line' : ''}`}
            >
              {o.label}
              {sameRule(o.value, form.repeat) && <Check className="size-5 text-blue" strokeWidth={2.6} />}
            </button>
          ))}
        </div>
      </Sheet>

      <DatePickerSheet
        open={untilOpen}
        title="Окончание повтора"
        withTime={false}
        clearLabel="Никогда"
        value={{ date: form.repeat?.until }}
        onChange={({ date }) => form.repeat && setForm({ ...form, repeat: { ...form.repeat, until: date } as Repeat })}
        onClose={() => setUntilOpen(false)}
      />
    </Sheet>
  );
}

/** iOS settings-style row: label on the left, value + chevron on the right. */
function Row({ icon, label, value, onClick }: { icon?: ReactNode; label: string; value: string; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-[11px] text-left transition-colors active:bg-surface-2">
      {icon && <span className="grid size-[30px] place-items-center rounded-[7px] bg-[#8e8e93] text-white">{icon}</span>}
      <span className="flex-1 text-[17px]">{label}</span>
      <span className="text-[17px] text-muted">{value}</span>
      <ChevronRight className="size-5 text-faint" />
    </button>
  );
}
