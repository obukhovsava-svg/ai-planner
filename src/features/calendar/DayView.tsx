import { useEffect, useRef } from 'react';
import { ChevronLeft, Plus } from 'lucide-react';
import type { CalendarEvent, DateKey } from '@/types';
import { IconButton } from '@/components/Header';
import { useUIStore } from '@/store/useUIStore';
import { fromKey, todayKey } from '@/lib/date';
import { haptic, showTelegramBackButton } from '@/lib/telegram';
import { WeekStrip } from './WeekStrip';
import { DayTimeline } from './DayTimeline';

const MONTHS_SHORT = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const EDGE = 28;
const SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)';

interface DayViewProps {
  /** false = play the pop animation; the parent unmounts afterwards. */
  open: boolean;
  onBack(): void;
  onCreate(date: DateKey, start?: string, end?: string): void;
  onOpenEvent(e: CalendarEvent, day: DateKey): void;
}

/**
 * iOS Calendar day screen, pushed over the month view.
 * Back: the "‹ Month" button, Telegram's native Back button, or a swipe from the left edge.
 */
export function DayView({ open, onBack, onCreate, onOpenEvent }: DayViewProps) {
  const selected = useUIStore((s) => s.selectedDate);
  const setSelected = useUIStore((s) => s.setSelectedDate);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; t: number; dx: number } | null>(null);
  const isToday = selected === todayKey();

  useEffect(() => (open ? showTelegramBackButton(onBack) : undefined), [open, onBack]);

  // Pop animation: slide out from wherever the view currently is (also mid-swipe).
  useEffect(() => {
    const el = root.current;
    if (!el || open) return;
    el.style.transition = `transform 0.42s ${SPRING}`;
    el.style.transform = 'translateX(100%)';
  }, [open]);

  const setX = (x: number, animate: boolean) => {
    const el = root.current;
    if (!el) return;
    el.style.transition = animate ? `transform 0.42s ${SPRING}` : 'none';
    el.style.transform = x ? `translateX(${x}px)` : '';
  };

  return (
    <div
      ref={root}
      data-swipe-lock
      className="animate-push-in absolute inset-0 z-10 flex flex-col bg-[var(--cal-bg)] shadow-[-10px_0_30px_rgb(0_0_0/0.12)]"
      onPointerDown={(e) => {
        if (e.clientX > EDGE || !open) return;
        drag.current = { x: e.clientX, t: performance.now(), dx: 0 };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        drag.current.dx = Math.max(0, e.clientX - drag.current.x);
        setX(drag.current.dx, false);
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        const width = root.current?.offsetWidth ?? 375;
        const fast = d.dx / Math.max(1, performance.now() - d.t) > 0.5;
        if (d.dx > width / 3 || (fast && d.dx > 40)) {
          haptic.impact('light');
          onBack();
        } else setX(0, true);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setX(0, true);
      }}
    >
      <header className="pt-safe shrink-0 bg-[var(--navbar-plain)] backdrop-blur-xl">
        <div className="flex h-11 items-center justify-between pl-1.5 pr-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center text-[17px] text-blue transition-opacity active:opacity-50"
          >
            <ChevronLeft className="size-7" strokeWidth={2.4} />
            <span className="-ml-0.5">{MONTHS_SHORT[fromKey(selected).getMonth()]}</span>
          </button>
          <div className="flex items-center gap-2">
            {!isToday && (
              <button
                type="button"
                onClick={() => setSelected(todayKey())}
                className="animate-fade-in rounded-full px-2 py-1 text-[17px] text-red transition-opacity active:opacity-50"
              >
                Сегодня
              </button>
            )}
            <IconButton label="Новое событие" onClick={() => onCreate(selected)}>
              <Plus className="size-5" strokeWidth={2.4} />
            </IconButton>
          </div>
        </div>
        <WeekStrip selected={selected} onSelect={setSelected} />
      </header>
      <DayTimeline
        date={selected}
        onDateChange={setSelected}
        onCreate={(start, end) => onCreate(selected, start, end)}
        onOpen={(e) => onOpenEvent(e, selected)}
      />
    </div>
  );
}
