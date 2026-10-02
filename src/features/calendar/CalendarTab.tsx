import { useState } from 'react';
import { CalendarDays, CalendarRange, Plus } from 'lucide-react';
import { Header, IconButton } from '@/components/Header';
import { useUIStore } from '@/store/useUIStore';
import { monthTitle, todayKey } from '@/lib/date';
import { haptic } from '@/lib/telegram';
import { CalendarGrid } from './CalendarGrid';
import { DayTimeline } from './DayTimeline';
import { EventSheet, type EventDraft } from './EventSheet';

export function CalendarTab() {
  const selected = useUIStore((s) => s.selectedDate);
  const setSelected = useUIStore((s) => s.setSelectedDate);
  const view = useUIStore((s) => s.calendarView);
  const setView = useUIStore((s) => s.setCalendarView);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const isToday = selected === todayKey();

  const newDraft = (start = '09:00', end = '10:00'): EventDraft => ({ title: '', date: selected, start, end, color: 'blue' });

  return (
    <div className="flex h-full flex-col">
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
            className={isToday ? 'text-muted' : 'font-semibold text-blue dark:text-sky'}
          >
            {isToday ? 'План' : '← Сегодня'}
          </button>
        }
        actions={
          <>
            <IconButton
              label={view === 'month' ? 'Показать неделю' : 'Показать месяц'}
              onClick={() => {
                haptic.selection();
                setView(view === 'month' ? 'week' : 'month');
              }}
            >
              {view === 'month' ? <CalendarRange className="size-[18px]" /> : <CalendarDays className="size-[18px]" />}
            </IconButton>
            <IconButton label="Новое событие" onClick={() => setDraft(newDraft())}>
              <Plus className="size-5" />
            </IconButton>
          </>
        }
      />
      <div className="shrink-0 pb-3">
        <CalendarGrid selected={selected} view={view} onSelect={setSelected} />
      </div>
      <DayTimeline
        date={selected}
        onDateChange={setSelected}
        onCreate={(start, end) => setDraft(newDraft(start, end))}
        onOpen={(event) => setDraft(event)}
      />
      <EventSheet draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}
