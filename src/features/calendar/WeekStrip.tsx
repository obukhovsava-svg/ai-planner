import { useState } from 'react';
import type { DateKey } from '@/types';
import { addDays, fromKey, todayKey, weekDays } from '@/lib/date';
import { useBusyDates } from '@/store/usePlannerStore';
import { useSwipe } from '@/hooks/useSwipe';
import { haptic } from '@/lib/telegram';

const LETTERS = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'];

/** Week row of the iOS Calendar day screen; swipe to page weeks. */
export function WeekStrip({ selected, onSelect }: { selected: DateKey; onSelect(d: DateKey): void }) {
  const today = todayKey();
  const days = weekDays(selected);
  const busy = useBusyDates(days[0], days[6]);
  const [direction, setDirection] = useState<'left' | 'right' | null>(null);

  const swipe = useSwipe((dir) => {
    haptic.selection();
    setDirection(dir);
    onSelect(addDays(selected, dir === 'left' ? 7 : -7));
  });

  return (
    <div className="touch-pan-y select-none overflow-hidden px-2 pb-2" {...swipe}>
      <div key={days[0]} className={`grid grid-cols-7 ${direction === 'left' ? 'animate-slide-right' : direction === 'right' ? 'animate-slide-left' : ''}`}>
        {days.map((d, i) => {
          const isSel = d === selected;
          const isToday = d === today;
          return (
            <button
              key={d}
              type="button"
              aria-label={d}
              aria-pressed={isSel}
              onClick={() => {
                if (isSel) return;
                setDirection(null);
                onSelect(d);
              }}
              className="flex flex-col items-center gap-1 py-0.5"
            >
              <span className={`text-[11px] font-semibold ${i >= 5 ? 'text-faint' : 'text-muted'}`}>{LETTERS[i]}</span>
              <span
                className={`grid size-[34px] place-items-center rounded-full text-[19px] tabular-nums transition-[background-color,color] duration-300 ${
                  isSel ? (isToday ? 'bg-red font-semibold text-white' : 'bg-fg font-semibold text-bg') : isToday ? 'font-semibold text-red' : ''
                }`}
              >
                {fromKey(d).getDate()}
              </span>
              <span className={`size-[5px] rounded-full ${busy.events.has(d) || busy.tasks.has(d) ? 'bg-faint' : ''}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
