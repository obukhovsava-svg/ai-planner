import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Header, IconButton } from '@/components/Header';
import { useUIStore } from '@/store/useUIStore';
import { monthRows, monthTitle, todayKey } from '@/lib/date';
import { haptic } from '@/lib/telegram';
import { useExpandGesture } from '@/hooks/useExpandGesture';
import { CalendarGrid, ROW_H } from './CalendarGrid';
import { DayTimeline } from './DayTimeline';
import { EventSheet, type EventDraft } from './EventSheet';

export function CalendarTab() {
  const selected = useUIStore((s) => s.selectedDate);
  const setSelected = useUIStore((s) => s.setSelectedDate);
  const view = useUIStore((s) => s.calendarView);
  const setView = useUIStore((s) => s.setCalendarView);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const isToday = selected === todayKey();

  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const expanded = view === 'month';

  useExpandGesture({
    root,
    panel,
    scroller,
    range: (monthRows(selected) - 1) * ROW_H,
    expanded,
    onSnap: (next) => {
      if (next !== expanded) setView(next ? 'month' : 'week');
    },
  });

  const newDraft = (start = '09:00', end = '10:00'): EventDraft => ({ title: '', date: selected, start, end, color: 'blue' });

  return (
    <div ref={root} className="flex h-full flex-col">
      <Header
        title={monthTitle(selected)}
        subtitle={
          <button
            type="button"
            disabled={isToday}
            onClick={() => {
              haptic.selection();
              setSelected(todayKey());
            }}
            className={`transition-colors ${isToday ? 'text-muted' : 'text-blue active:opacity-50'}`}
          >
            {isToday ? 'Календарь' : 'Сегодня'}
          </button>
        }
        actions={
          <IconButton label="Новое событие" onClick={() => setDraft(newDraft())}>
            <Plus className="size-5" strokeWidth={2.4} />
          </IconButton>
        }
      />
      <div className="shrink-0 pb-2">
        <CalendarGrid selected={selected} expanded={expanded} onSelect={setSelected} />
      </div>
      <DayTimeline
        panelRef={panel}
        scrollerRef={scroller}
        date={selected}
        onDateChange={setSelected}
        onCreate={(start, end) => setDraft(newDraft(start, end))}
        onOpen={(event) => setDraft(event)}
      />
      <EventSheet draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}
