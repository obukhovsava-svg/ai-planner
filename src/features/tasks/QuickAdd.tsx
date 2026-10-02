import { useRef, useState, type ReactNode } from 'react';
import { ArrowUp, CalendarPlus, Flag, X } from 'lucide-react';
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
    <div className="rounded-2xl border border-line bg-surface p-1.5 shadow-card transition-colors focus-within:border-blue">
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Новая задача…"
          enterKeyHint="done"
          className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-fg outline-none placeholder:text-faint"
        />
        <button
          type="button"
          onClick={openPicker}
          aria-label="Выбрать дату"
          className={`relative grid size-9 shrink-0 place-items-center rounded-xl transition-colors ${
            date ? 'bg-blue/10 text-blue dark:text-sky' : 'text-muted'
          }`}
        >
          <CalendarPlus className="size-5" />
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
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-gemini text-white transition active:scale-90 disabled:opacity-30"
        >
          <ArrowUp className="size-5" strokeWidth={2.5} />
        </button>
      </form>

      {(expanded || date) && (
        <div className="no-scrollbar animate-fade-in flex gap-1.5 overflow-x-auto px-1 pb-0.5 pt-2">
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
              <Flag className={`size-3 ${p === 'high' ? 'text-red' : p === 'medium' ? 'text-amber-500' : 'text-faint'}`} />
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
      className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? 'bg-fg text-bg' : 'bg-surface-2 text-muted'
      }`}
    >
      {children}
    </button>
  );
}
