import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, Repeat } from 'lucide-react';
import type { CalendarEvent, DateKey } from '@/types';
import { usePlannerStore } from '@/store/usePlannerStore';
import { addDays, longDate, minutesToTime, nowMinutes, timeToMinutes, todayKey } from '@/lib/date';
import { EVENT_COLORS } from '@/lib/meta';
import { occursOn } from '@/lib/recurrence';
import { useSwipe } from '@/hooks/useSwipe';
import { haptic } from '@/lib/telegram';

const HOUR_PX = 56;

interface DayTimelineProps {
  date: DateKey;
  onDateChange(date: DateKey): void;
  onCreate(start: string, end: string): void;
  onOpen(event: CalendarEvent): void;
}

/** Lay out overlapping events side by side (classic calendar column packing). */
function layoutEvents(events: CalendarEvent[]) {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  const placed: { event: CalendarEvent; col: number; cols: number }[] = [];
  let cluster: typeof placed = [];
  let clusterEnd = -1;

  const flush = () => {
    const cols = Math.max(0, ...cluster.map((p) => p.col)) + 1;
    cluster.forEach((p) => (p.cols = cols));
    cluster = [];
  };

  for (const event of sorted) {
    const s = timeToMinutes(event.start);
    if (s >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    const used = new Set(cluster.filter((p) => timeToMinutes(p.event.end) > s).map((p) => p.col));
    let col = 0;
    while (used.has(col)) col++;
    const item = { event, col, cols: 1 };
    cluster.push(item);
    placed.push(item);
    clusterEnd = Math.max(clusterEnd, timeToMinutes(event.end));
  }
  flush();
  return placed;
}

export function DayTimeline({ date, onDateChange, onCreate, onOpen }: DayTimelineProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const allEvents = usePlannerStore((s) => s.events);
  const allTasks = usePlannerStore((s) => s.tasks);
  const toggleTask = usePlannerStore((s) => s.toggleTask);
  const [now, setNow] = useState(nowMinutes);
  const isToday = date === todayKey();

  const events = useMemo(() => layoutEvents(allEvents.filter((e) => occursOn(e, date))), [allEvents, date]);
  const dayTasks = useMemo(() => allTasks.filter((t) => t.date === date), [allTasks, date]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(nowMinutes()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Scroll to "now" for today, otherwise to the first event (or 8:00 on an empty day).
  useEffect(() => {
    const first = events[0] ? timeToMinutes(events[0].event.start) : 8 * 60;
    const target = isToday ? nowMinutes() - 90 : first - 30;
    scroller.current?.scrollTo({ top: Math.max(0, (target / 60) * HOUR_PX), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const swipe = useSwipe((dir) => {
    haptic.selection();
    onDateChange(addDays(date, dir === 'left' ? 1 : -1));
  }, 70);

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t-[0.5px] border-line">
      <div>
        <div className="flex items-baseline justify-between px-4 pb-2 pt-3">
          <h2 key={date} className="animate-fade-in text-[17px] font-semibold">{longDate(date)}</h2>
          <span className="text-[13px] text-muted">
          {events.length ? `${events.length} событ${events.length === 1 ? 'ие' : events.length < 5 ? 'ия' : 'ий'}` : 'Свободный день'}
          </span>
        </div>
      </div>

      {dayTasks.length > 0 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3">
          {dayTasks.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                haptic.impact('light');
                toggleTask(t.id);
              }}
              className={`flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 py-1.5 pl-2 pr-3 text-[14px] transition-colors active:opacity-60 ${t.done ? 'text-muted line-through' : ''}`}
            >
              <span className={`grid size-[18px] place-items-center rounded-full border-[1.5px] transition-colors duration-300 ${t.done ? 'border-blue bg-blue text-white' : 'border-faint'}`}>
                {t.done && <Check className="size-3" strokeWidth={3} />}
              </span>
              {t.title}
            </button>
          ))}
        </div>
      )}

      <div ref={scroller} className="pb-tabbar relative min-h-0 flex-1 touch-pan-y overflow-y-auto" {...swipe}>
        <div key={date} className="animate-fade-in relative" style={{ height: 24 * HOUR_PX }}>
          {Array.from({ length: 24 }, (_, h) => (
            <button
              key={h}
              type="button"
              aria-label={`Добавить событие в ${minutesToTime(h * 60)}`}
              onClick={() => {
                haptic.impact('light');
                onCreate(minutesToTime(h * 60), minutesToTime(h * 60 + 60));
              }}
              className="group absolute inset-x-0 flex text-left"
              style={{ top: h * HOUR_PX, height: HOUR_PX }}
            >
              <span className="w-14 shrink-0 -translate-y-2 pr-2 text-right text-[11px] tabular-nums text-muted">
                {h === 0 ? '' : minutesToTime(h * 60)}
              </span>
              <span className="relative flex-1 border-t-[0.5px] border-line transition-colors duration-300 group-active:bg-blue/5">
                <span className="absolute right-3 top-1.5 hidden text-[11px] font-medium text-blue opacity-0 transition-opacity group-hover:opacity-100 sm:block">
                  + Добавить
                </span>
              </span>
            </button>
          ))}

          {events.map(({ event, col, cols }) => {
            const s = timeToMinutes(event.start);
            const e = Math.max(timeToMinutes(event.end), s + 20);
            const c = EVENT_COLORS[event.color];
            const short = e - s < 45;
            return (
              <button
                key={event.id}
                type="button"
                onClick={() => {
                  haptic.impact('light');
                  onOpen(event);
                }}
                className={`animate-fade-up absolute overflow-hidden rounded-[6px] py-1 pl-2.5 pr-1.5 text-left transition-transform duration-300 ease-spring active:scale-[0.98] ${c.bg}`}
                style={{
                  top: (s / 60) * HOUR_PX + 1,
                  height: ((e - s) / 60) * HOUR_PX - 2,
                  left: `calc(3.5rem + (100% - 4rem) * ${col / cols})`,
                  width: `calc((100% - 4rem) / ${cols} - 2px)`,
                }}
              >
                <span className={`absolute inset-y-1 left-1 w-[3px] rounded-full ${c.bar}`} />
                <span className={`flex items-center gap-1 text-[13px] font-semibold leading-tight ${c.text}`}>
                  <span className="truncate">{event.title}</span>
                  {event.repeat && <Repeat className="size-3 shrink-0 opacity-70" strokeWidth={2.5} />}
                  {event.remind && <Bell className="size-3 shrink-0 opacity-70" strokeWidth={2.5} />}
                </span>
                {!short && (
                  <span className="block truncate text-[11px] text-muted">
                    {event.start} – {event.end}
                  </span>
                )}
              </button>
            );
          })}

          {isToday && (
            <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: (now / 60) * HOUR_PX }}>
              <span className="w-14 pr-1 text-right text-[10px] font-bold tabular-nums text-red">{minutesToTime(now)}</span>
              <span className="size-2 -translate-x-1 rounded-full bg-red" />
              <span className="h-px flex-1 -translate-x-1 bg-red" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
