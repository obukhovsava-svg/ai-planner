import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { DateKey } from '@/types';
import { Header, IconButton } from '@/components/Header';
import { useUIStore } from '@/store/useUIStore';
import { monthTitle, todayKey } from '@/lib/date';
import { MonthView } from './MonthView';
import { DayView } from './DayView';
import { EventSheet, type EventDraft } from './EventSheet';

const POP_MS = 450;

export function CalendarTab() {
  const selected = useUIStore((s) => s.selectedDate);
  const setSelected = useUIStore((s) => s.setSelectedDate);
  const dayOpen = useUIStore((s) => s.dayOpen);
  const setDayOpen = useUIStore((s) => s.setDayOpen);
  const calendarHome = useUIStore((s) => s.calendarHome);
  const [dayMounted, setDayMounted] = useState(dayOpen);
  const [visibleMonth, setVisibleMonth] = useState<DateKey>(selected);
  const [todaySignal, setTodaySignal] = useState(0);
  const [draft, setDraft] = useState<EventDraft | null>(null);

  // Keep the day screen mounted until its pop animation has finished.
  useEffect(() => {
    if (dayOpen) {
      setDayMounted(true);
      return;
    }
    const t = window.setTimeout(() => setDayMounted(false), POP_MS);
    return () => window.clearTimeout(t);
  }, [dayOpen]);

  const openDay = useCallback(
    (d: DateKey) => {
      setSelected(d);
      setDayOpen(true);
    },
    [setSelected, setDayOpen],
  );
  const closeDay = useCallback(() => setDayOpen(false), [setDayOpen]);

  const create = (date: DateKey, start = '09:00', end = '10:00') => setDraft({ title: '', date, start, end, color: 'blue' });

  const showingCurrent = visibleMonth.slice(0, 7) === todayKey().slice(0, 7);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[var(--cal-bg)]">
      {/* Month screen; slides slightly left (parallax) while the day screen is pushed */}
      <div
        className={`flex h-full flex-col transition-[transform,opacity] duration-500 ease-spring ${
          dayOpen ? 'pointer-events-none -translate-x-[28%] opacity-70' : ''
        }`}
      >
        <Header
          plain
          title={<span key={visibleMonth.slice(0, 4)} className="animate-fade-in">{visibleMonth.slice(0, 4)}</span>}
          subtitle={
            <button
              type="button"
              onClick={() => setTodaySignal((n) => n + 1)}
              className={`transition-opacity active:opacity-50 ${showingCurrent ? 'text-muted' : 'text-red'}`}
            >
              {showingCurrent ? monthTitle(todayKey()) : 'Сегодня'}
            </button>
          }
          actions={
            <IconButton label="Новое событие" onClick={() => create(todayKey())}>
              <Plus className="size-5" strokeWidth={2.4} />
            </IconButton>
          }
        />
        <MonthView initial={selected} todaySignal={todaySignal + calendarHome} onVisibleMonth={setVisibleMonth} onOpenDay={openDay} />
      </div>

      {dayMounted && <DayView open={dayOpen} onBack={closeDay} onCreate={create} onOpenEvent={(e) => setDraft(e)} />}

      <EventSheet draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}
