import { useRef, useState, type ReactNode } from 'react';
import { ArrowUp, CalendarDays, Flag, Plus, X } from 'lucide-react';
import type { DateKey, Priority } from '@/types';
import { usePlannerStore } from '@/store/usePlannerStore';
import { parseCommand } from '@/lib/parser';
import { addDays, humanDate, todayKey } from '@/lib/date';
import { PRIORITY_META } from '@/lib/meta';
import { haptic } from '@/lib/telegram';

const PRIORITIES: Priority[] = ['low', 'medium', 'high'];

/**
 * Fast entry bar. Understands natural language too:
 * "купить хлеб завтра срочно" → date = tomorrow, priority = high.
 * An explicitly picked date / priority always wins over the parsed one.
 */
export function QuickAdd({ defaultDate }: { defaultDate?: DateKey }) {
  const addTask = usePlannerStore((s) => s.addTask);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState<DateKey | undefined>(defaultDate);
  const [priority, setPriority] = useState<Priority | undefined>();
  const [focused, setFocused] = useState(false);
  const dateInput = useRef<HTMLInputElement>(null);

  const submit = () => {
    const raw = title.trim();
    if (!raw) return;
    const parsed = parseCommand(raw);
    const p = parsed && parsed.kind !== 'agenda' ? parsed : undefined;
    addTask({
      title: p?.title || raw,
      date: date ?? p?.date,
      time: p?.start,
      priority: priority ?? p?.priority ?? 'medium',
      category: p?.category ?? 'other',
    });
    haptic.notify('success');
    setTitle('');
    setPriority(undefined);
    setDate(defaultDate);
  };

  const openPicker = () => {
    haptic.selection();
    const el = dateInput.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };

  const expanded = focused || Boolean(title);

  return (
    <div className="rounded-[10px] bg-surface py-1 pl-3 pr-1.5">
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
          className={`relative grid size-9 shrink-0 place-items-center rounded-full transition-colors duration-300 ${
            date ? 'bg-blue/12 text-blue' : 'text-blue'
          }`}
        >
          <CalendarDays className="size-[20px]" />
          <input
            ref={dateInput}
            type="date"
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-0"
            value={date ?? ''}
            onChange={(e) => setDate(e.target.value || undefined)}
          />
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

      {(expanded || date) && (
        <div className="no-scrollbar animate-fade-in -ml-3 flex gap-1.5 overflow-x-auto border-t-[0.5px] border-line pb-1.5 pl-3 pt-2.5">
          {date && (
            <Chip active onClick={() => setDate(undefined)}>
              {humanDate(date)} <X className="size-3" />
            </Chip>
          )}
          {!date &&
            [
              ['Сегодня', todayKey()],
              ['Завтра', addDays(todayKey(), 1)],
              ['Через неделю', addDays(todayKey(), 7)],
            ].map(([label, key]) => (
              <Chip key={key} onClick={() => setDate(key)}>
                {label}
              </Chip>
            ))}
          <span className="mx-0.5 w-px shrink-0 bg-line" />
          {PRIORITIES.map((p) => (
            <Chip key={p} active={priority === p} onClick={() => setPriority(priority === p ? undefined : p)}>
              <Flag className={`size-3 ${priority === p ? '' : p === 'high' ? 'text-red' : p === 'medium' ? 'text-[#ff9500]' : 'text-muted'}`} />
              {PRIORITY_META[p].label}
            </Chip>
          ))}
        </div>
      )}
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
