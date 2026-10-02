import { useMemo, useState } from 'react';
import type { DateKey } from '@/types';
import { WEEKDAYS_SHORT, addDays, addMonths, fromKey, monthGrid, sameMonth, todayKey, weekDays } from '@/lib/date';
import { useBusyDates } from '@/store/usePlannerStore';
import { useSwipe } from '@/hooks/useSwipe';
import { haptic } from '@/lib/telegram';

interface CalendarGridProps {
  selected: DateKey;
  view: 'month' | 'week';
  onSelect(date: DateKey): void;
}

/** Apple-Calendar-style month / week grid with event dots and swipe paging. */
export function CalendarGrid({ selected, view, onSelect }: CalendarGridProps) {
  const today = todayKey();
  const busy = useBusyDates();
  const [direction, setDirection] = useState<'left' | 'right' | null>(null);

  const days = useMemo(() => (view === 'month' ? monthGrid(selected) : weekDays(selected)), [selected, view]);
  // Re-mount the grid only when the visible page changes, so the slide animation plays once per page.
  const pageKey = view === 'month' ? selected.slice(0, 7) : days[0];

  const swipe = useSwipe((dir) => {
    haptic.selection();
    setDirection(dir);
    const step = dir === 'left' ? 1 : -1;
    onSelect(view === 'month' ? addMonths(selected, step) : addDays(selected, step * 7));
  });

  return (
    <div className="touch-pan-y select-none px-2" {...swipe}>
      <div className="grid grid-cols-7 pb-1">
        {WEEKDAYS_SHORT.map((d, i) => (
          <div key={d} className={`text-center text-[11px] font-semibold uppercase ${i >= 5 ? 'text-faint' : 'text-muted'}`}>
            {d}
          </div>
        ))}
      </div>
      <div
        key={pageKey}
        className={`grid grid-cols-7 gap-y-0.5 ${direction === 'left' ? 'animate-slide-right' : direction === 'right' ? 'animate-slide-left' : ''}`}
      >
        {days.map((key) => {
          const isSelected = key === selected;
          const isToday = key === today;
          const outside = view === 'month' && !sameMonth(key, selected);
          const hasEvent = busy.events.has(key);
          const hasTask = busy.tasks.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                haptic.selection();
                setDirection(null);
                onSelect(key);
              }}
              className="flex h-11 flex-col items-center justify-center gap-0.5"
              aria-label={key}
              aria-pressed={isSelected}
            >
              <span
                className={`grid size-8 place-items-center rounded-full text-[15px] transition-all duration-200 ${
                  isSelected
                    ? isToday
                      ? 'bg-gemini font-bold text-white shadow-md'
                      : 'bg-fg font-semibold text-bg'
                    : isToday
                      ? 'font-bold text-red dark:text-coral'
                      : outside
                        ? 'text-faint/60'
                        : 'text-fg'
                }`}
              >
                {fromKey(key).getDate()}
              </span>
              <span className="flex h-1 gap-0.5">
                {hasEvent && <span className={`size-1 rounded-full ${outside ? 'bg-faint/50' : 'bg-blue dark:bg-sky'}`} />}
                {hasTask && <span className={`size-1 rounded-full ${outside ? 'bg-faint/50' : 'bg-red dark:bg-coral'}`} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
