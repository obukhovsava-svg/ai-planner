import { useMemo, useState } from 'react';
import type { DateKey } from '@/types';
import { WEEKDAYS_SHORT, addDays, addMonths, fromKey, monthGrid, monthRows, sameMonth, todayKey } from '@/lib/date';
import { useBusyDates } from '@/store/usePlannerStore';
import { useSwipe } from '@/hooks/useSwipe';
import { haptic } from '@/lib/telegram';

export const ROW_H = 46;

interface CalendarGridProps {
  selected: DateKey;
  /** Whether the grid is currently expanded to a month (affects horizontal paging only). */
  expanded: boolean;
  onSelect(date: DateKey): void;
}

/**
 * iOS-Calendar-style grid. Always renders the whole month; the visible part is
 * controlled by the CSS variable --p on an ancestor (0 = the selected week, 1 = full month),
 * so a drag gesture can animate it frame-by-frame without React re-renders.
 */
export function CalendarGrid({ selected, expanded, onSelect }: CalendarGridProps) {
  const today = todayKey();
  const busy = useBusyDates();
  const [direction, setDirection] = useState<'left' | 'right' | null>(null);

  const rows = monthRows(selected);
  const days = useMemo(() => monthGrid(selected).slice(0, rows * 7), [selected, rows]);
  const selectedRow = Math.floor(days.indexOf(selected) / 7);
  const pageKey = expanded ? selected.slice(0, 7) : addDays(selected, -((days.indexOf(selected) % 7)));

  const swipe = useSwipe((dir) => {
    haptic.selection();
    setDirection(dir);
    const step = dir === 'left' ? 1 : -1;
    onSelect(expanded ? addMonths(selected, step) : addDays(selected, step * 7));
  });

  return (
    <div className="touch-pan-y select-none px-2" {...swipe}>
      <div className="grid grid-cols-7 pb-1.5">
        {WEEKDAYS_SHORT.map((d, i) => (
          <div key={d} className={`text-center text-[11px] font-medium ${i >= 5 ? 'text-faint' : 'text-muted'}`}>
            {d}
          </div>
        ))}
      </div>
      <div
        className="cal-h relative overflow-hidden"
        style={{ height: `calc(${ROW_H}px + ${(rows - 1) * ROW_H}px * var(--p))` }}
      >
        <div
          key={pageKey}
          className={direction === 'left' ? 'animate-slide-right' : direction === 'right' ? 'animate-slide-left' : ''}
        >
          <div
            className="cal-t grid grid-cols-7"
            style={{ transform: `translateY(calc(${-selectedRow * ROW_H}px * (1 - var(--p))))` }}
          >
            {days.map((key) => {
              const isSelected = key === selected;
              const isToday = key === today;
              const outside = !sameMonth(key, selected);
              const busyDay = busy.events.has(key) || busy.tasks.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    if (key === selected) return;
                    haptic.selection();
                    setDirection(null);
                    onSelect(key);
                  }}
                  className={`flex flex-col items-center justify-center gap-[3px] ${outside ? 'cal-o' : ''}`}
                  style={{ height: ROW_H, opacity: outside ? 'calc(1 - 0.75 * var(--p))' : undefined }}
                  aria-label={key}
                  aria-pressed={isSelected}
                >
                  <span
                    className={`grid size-[34px] place-items-center rounded-full text-[19px] tabular-nums transition-[background-color,color,transform] duration-300 ease-spring active:scale-90 ${
                      isSelected
                        ? isToday
                          ? 'bg-red font-semibold text-white'
                          : 'bg-fg font-semibold text-bg'
                        : isToday
                          ? 'font-semibold text-red'
                          : 'text-fg'
                    }`}
                  >
                    {fromKey(key).getDate()}
                  </span>
                  <span className={`size-[5px] rounded-full transition-opacity ${busyDay ? 'bg-faint' : 'opacity-0'}`} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
