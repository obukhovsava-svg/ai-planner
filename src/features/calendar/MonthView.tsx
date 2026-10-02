import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { CalendarEvent, DateKey, Task } from '@/types';
import { usePlannerStore } from '@/store/usePlannerStore';
import { addDays, addMonths, fromKey, monthGrid, monthRows, todayKey, weekdayMon } from '@/lib/date';
import { occurrencesBetween } from '@/lib/recurrence';
import { EVENT_COLORS } from '@/lib/meta';

const ROW_H = 92;
const MAX_LINES = 3;
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
/** Months rendered before / after the current one. Native scrolling keeps it smooth. */
const RANGE_BACK = 12;
const RANGE_FWD = 24;

interface DayItems {
  events: CalendarEvent[];
  tasks: Task[];
}

interface MonthViewProps {
  /** Month (any date inside it) to bring into view on mount. */
  initial: DateKey;
  /** Increment to smoothly scroll to today's month. */
  todaySignal: number;
  onVisibleMonth(monthKey: DateKey): void;
  onOpenDay(date: DateKey): void;
}

/**
 * iOS Calendar month view in "Details" mode: a vertically scrolling list of months,
 * each day a square cell with a mini schedule (coloured event chips, then tasks).
 */
export function MonthView({ initial, todaySignal, onVisibleMonth, onOpenDay }: MonthViewProps) {
  const events = usePlannerStore((s) => s.events);
  const tasks = usePlannerStore((s) => s.tasks);
  const scroller = useRef<HTMLDivElement>(null);
  const today = todayKey();

  const months = useMemo(() => {
    const base = `${today.slice(0, 7)}-01`;
    return Array.from({ length: RANGE_BACK + RANGE_FWD + 1 }, (_, i) => addMonths(base, i - RANGE_BACK));
  }, [today]);

  const byDay = useMemo(() => {
    const from = months[0];
    const to = addDays(addMonths(months[months.length - 1], 1), -1);
    const map = new Map<DateKey, DayItems>();
    const slot = (d: DateKey) => {
      let v = map.get(d);
      if (!v) map.set(d, (v = { events: [], tasks: [] }));
      return v;
    };
    for (const e of events) for (const d of occurrencesBetween(e, from, to)) slot(d).events.push(e);
    for (const t of tasks) if (t.date && !t.done) slot(t.date).tasks.push(t);
    for (const v of map.values()) {
      v.events.sort((a, b) => a.start.localeCompare(b.start));
      v.tasks.sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));
    }
    return map;
  }, [events, tasks, months]);

  // Jump (without animation) to the initial month before the first paint.
  useLayoutEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-month="${initial.slice(0, 7)}"]`);
    if (el && scroller.current) scroller.current.scrollTop = el.offsetTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only react to changes after mount — the initial position is handled above.
  const firstSignal = useRef(todaySignal);
  useEffect(() => {
    if (todaySignal === firstSignal.current) return;
    scroller.current
      ?.querySelector<HTMLElement>(`[data-month="${today.slice(0, 7)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [todaySignal, today]);

  // Report which month occupies the top of the viewport (drives the header title).
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) onVisibleMonth(`${(e.target as HTMLElement).dataset.month}-01`);
      },
      { root, rootMargin: '0px 0px -88% 0px' },
    );
    root.querySelectorAll('[data-month]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [months, onVisibleMonth]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b-[0.5px] border-line pb-1.5">
        {['П', 'В', 'С', 'Ч', 'П', 'С', 'В'].map((d, i) => (
          <span key={i} className={`text-center text-[11px] font-semibold ${i >= 5 ? 'text-faint' : 'text-muted'}`}>
            {d}
          </span>
        ))}
      </div>
      <div ref={scroller} className="pb-tabbar relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {months.map((m) => (
          <Month key={m} month={m} today={today} byDay={byDay} onOpenDay={onOpenDay} />
        ))}
      </div>
    </div>
  );
}

const Month = memo(function Month({
  month,
  today,
  byDay,
  onOpenDay,
}: {
  month: DateKey;
  today: DateKey;
  byDay: Map<DateKey, DayItems>;
  onOpenDay(d: DateKey): void;
}) {
  const rows = monthRows(month);
  const first = fromKey(month);
  const offset = weekdayMon(first);
  const days = monthGrid(month).slice(offset, offset + new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate());
  const isCurrent = month.slice(0, 7) === today.slice(0, 7);

  return (
    <section
      data-month={month.slice(0, 7)}
      // Off-screen months skip layout/paint entirely — keeps a long list cheap.
      style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${rows * ROW_H + 44}px` }}
    >
      <div className="grid grid-cols-7 pt-3">
        <h2
          className={`truncate pb-1 pl-1.5 text-[20px] font-bold ${isCurrent ? 'text-red' : ''}`}
          style={{ gridColumnStart: Math.min(offset + 1, 5), gridColumnEnd: 'span 3' }}
        >
          {MONTHS[first.getMonth()]}
          {first.getMonth() === 0 && <span className="ml-1.5 font-semibold text-muted">{first.getFullYear()}</span>}
        </h2>
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => (
          <DayCell
            key={d}
            date={d}
            col={i === 0 ? offset + 1 : undefined}
            isToday={d === today}
            items={byDay.get(d)}
            onOpen={onOpenDay}
          />
        ))}
      </div>
    </section>
  );
});

function DayCell({
  date,
  col,
  isToday,
  items,
  onOpen,
}: {
  date: DateKey;
  col?: number;
  isToday: boolean;
  items?: DayItems;
  onOpen(d: DateKey): void;
}) {
  const d = fromKey(date);
  const weekend = weekdayMon(d) >= 5;
  const lines = [
    ...(items?.events ?? []).map((e) => ({ id: e.id, title: e.title, kind: 'event' as const, color: e.color })),
    ...(items?.tasks ?? []).map((t) => ({ id: t.id, title: t.title, kind: 'task' as const, color: undefined })),
  ];
  const shown = lines.length > MAX_LINES ? lines.slice(0, MAX_LINES - 1) : lines;
  const more = lines.length - shown.length;

  return (
    <button
      type="button"
      onClick={() => onOpen(date)}
      aria-label={date}
      className="flex min-w-0 flex-col items-stretch gap-[3px] border-t-[0.5px] border-line px-[2px] pt-1 text-left transition-colors duration-200 active:bg-surface-2"
      style={{ height: ROW_H, gridColumnStart: col }}
    >
      <span
        className={`mx-auto grid size-[26px] shrink-0 place-items-center rounded-full text-[16px] tabular-nums ${
          isToday ? 'bg-red font-semibold text-white' : weekend ? 'text-muted' : ''
        }`}
      >
        {d.getDate()}
      </span>
      {shown.map((l) =>
        l.kind === 'event' ? (
          <span
            key={l.id}
            className={`truncate rounded-[4px] px-[3px] text-[10px] font-medium leading-[15px] ${EVENT_COLORS[l.color!].bg} ${EVENT_COLORS[l.color!].text}`}
          >
            {l.title}
          </span>
        ) : (
          <span key={l.id} className="flex min-w-0 items-center gap-[3px] px-[2px] text-[10px] leading-[15px] text-muted">
            <span className="size-[6px] shrink-0 rounded-full border border-current" />
            <span className="truncate">{l.title}</span>
          </span>
        ),
      )}
      {more > 0 && <span className="px-[3px] text-[10px] leading-[13px] text-muted">+{more}</span>}
    </button>
  );
}
