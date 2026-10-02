import { useState, type ReactNode } from 'react';
import { ArrowUp, CalendarDays, Flag, Plus, X } from 'lucide-react';
import type { Priority } from '@/types';
import { usePlannerStore } from '@/store/usePlannerStore';
import { parseCommand } from '@/lib/parser';
import { addDays, todayKey } from '@/lib/date';
import { PRIORITY_META } from '@/lib/meta';
import { haptic } from '@/lib/telegram';
import { DatePickerSheet, formatDateTime, type DateTimeValue } from '@/components/DatePickerSheet';

const PRIORITIES: Priority[] = ['high', 'medium', 'low'];

/**
 * Fast entry bar. Understands natural language too:
 * "купить хлеб завтра срочно" → date = tomorrow, priority = high.
 * An explicitly picked date / priority always wins over the parsed one.
 */
export function QuickAdd() {
  const addTask = usePlannerStore((s) => s.addTask);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState<DateTimeValue>({});
  const [priority, setPriority] = useState<Priority | undefined>();
  const [focused, setFocused] = useState(false);
  const [picker, setPicker] = useState(false);

  const submit = () => {
    const raw = title.trim();
    if (!raw) return;
    const parsed = parseCommand(raw);
    const p = parsed && parsed.kind !== 'agenda' ? parsed : undefined;
    addTask({
      title: p?.title || raw,
      date: when.date ?? p?.date,
      time: when.date ? when.time : p?.start,
      priority: priority ?? p?.priority ?? 'medium',
      category: p?.category ?? 'other',
    });
    haptic.notify('success');
    setTitle('');
    setPriority(undefined);
    setWhen({});
  };

  const openPicker = () => {
    haptic.selection();
    setPicker(true);
  };

  const expanded = focused || Boolean(title) || Boolean(when.date) || Boolean(priority);

  return (
    <div className="rounded-[16px] bg-surface py-1 pl-3 pr-1.5">
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-blue text-white">
          <Plus className="size-4" strokeWidth={3} />
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Новая задача…"
          enterKeyHint="done"
          className="min-w-0 flex-1 bg-transparent px-1.5 py-1.5 text-[17px] text-fg outline-none placeholder:text-muted"
        />
        <button
          type="button"
          onClick={openPicker}
          aria-label="Выбрать дату"
          className={`grid size-9 shrink-0 place-items-center rounded-full text-blue transition-colors duration-300 ${when.date ? 'bg-blue/12' : ''}`}
        >
          <CalendarDays className="size-[20px]" />
        </button>
        <button
          type="submit"
          disabled={!title.trim()}
          aria-label="Добавить задачу"
          className={`grid shrink-0 place-items-center rounded-full bg-blue text-white transition-all duration-500 ease-spring active:scale-90 ${
            title.trim() ? 'size-8 opacity-100' : 'size-0 opacity-0'
          }`}
        >
          <ArrowUp className="size-5" strokeWidth={2.5} />
        </button>
      </form>

      {expanded && (
        <div className="no-scrollbar animate-fade-in -ml-3 flex gap-1.5 overflow-x-auto border-t-[0.5px] border-line pb-1.5 pl-3 pt-2.5">
          {when.date ? (
            <Chip active onClick={openPicker}>
              <CalendarDays className="size-3.5" />
              {formatDateTime(when)}
              <span
                role="button"
                aria-label="Убрать дату"
                onClick={(e) => {
                  e.stopPropagation();
                  haptic.selection();
                  setWhen({});
                }}
                className="-mr-1 ml-0.5 grid size-4 place-items-center rounded-full bg-white/25"
              >
                <X className="size-3" strokeWidth={3} />
              </span>
            </Chip>
          ) : (
            <>
              <Chip onClick={() => setWhen({ date: todayKey() })}>Сегодня</Chip>
              <Chip onClick={() => setWhen({ date: addDays(todayKey(), 1) })}>Завтра</Chip>
              <Chip onClick={openPicker}>
                <CalendarDays className="size-3.5 text-blue" />
                Выбрать дату
              </Chip>
            </>
          )}
          <span className="mx-0.5 w-px shrink-0 bg-line" />
          {PRIORITIES.map((p) => (
            <Chip key={p} active={priority === p} onClick={() => setPriority(priority === p ? undefined : p)}>
              <Flag className={`size-3 ${priority === p ? '' : p === 'high' ? 'text-red' : p === 'medium' ? 'text-[#ff9500]' : 'text-muted'}`} />
              {PRIORITY_META[p].label}
            </Chip>
          ))}
        </div>
      )}

      <DatePickerSheet open={picker} value={when} onChange={setWhen} onClose={() => setPicker(false)} />
    </div>
  );
}

function Chip({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault() /* keep input focus */}
      onClick={() => {
        haptic.selection();
        onClick();
      }}
      className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all duration-300 ease-spring active:scale-95 ${
        active ? 'bg-blue text-white' : 'bg-surface-2 text-fg'
      }`}
    >
      {children}
    </button>
  );
}
