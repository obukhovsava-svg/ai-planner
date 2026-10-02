import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DateKey, TimeStr } from '@/types';
import { Sheet } from './Sheet';
import { WEEKDAYS_SHORT, addDays, addMonths, fromKey, humanDate, monthGrid, monthRows, monthTitle, sameMonth, startOfWeek, todayKey, weekdayMon } from '@/lib/date';
import { useSwipe } from '@/hooks/useSwipe';
import { haptic } from '@/lib/telegram';

export interface DateTimeValue {
  date?: DateKey;
  time?: TimeStr;
}

interface DatePickerSheetProps {
  open: boolean;
  value: DateTimeValue;
  onChange(value: DateTimeValue): void;
  onClose(): void;
}

/** iOS-style inline date picker (month grid + optional time) in a bottom sheet. */
export function DatePickerSheet({ open, value, onChange, onClose }: DatePickerSheetProps) {
  const [date, setDate] = useState<DateKey | undefined>(value.date);
  const [time, setTime] = useState<TimeStr | undefined>(value.time);
  const [cursor, setCursor] = useState<DateKey>(value.date ?? todayKey());
  const [direction, setDirection] = useState<'left' | 'right' | null>(null);

  // Reset the draft every time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setDate(value.date);
    setTime(value.time);
    setCursor(value.date ?? todayKey());
    setDirection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const today = todayKey();
  const days = monthGrid(cursor).slice(0, monthRows(cursor) * 7);

  const page = (step: 1 | -1) => {
    haptic.selection();
    setDirection(step === 1 ? 'left' : 'right');
    setCursor(addMonths(cursor, step));
  };
  const swipe = useSwipe((dir) => page(dir === 'left' ? 1 : -1));

  const pick = (key: DateKey) => {
    haptic.selection();
    setDate(key);
    if (!sameMonth(key, cursor)) {
      setDirection(key > cursor ? 'left' : 'right');
      setCursor(key);
    }
  };

  const saturday = addDays(today, (5 - weekdayMon(fromKey(today)) + 7) % 7 || 7);
  const quick: [string, DateKey][] = [
    ['Сегодня', today],
    ['Завтра', addDays(today, 1)],
    ['Выходные', saturday],
    ['След. неделя', addDays(startOfWeek(today), 7)],
  ];

  const done = () => {
    haptic.impact('light');
    onChange({ date, time: date ? time : undefined });
    onClose();
  };

  return (
    <Sheet open={open} title="Дата и время" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {quick.map(([label, key]) => (
            <button
              key={label}
              type="button"
              onClick={() => pick(key)}
              className={`shrink-0 rounded-full px-3.5 py-2 text-[15px] transition-all duration-300 ease-spring active:scale-95 ${
                date === key ? 'bg-blue text-white' : 'bg-surface text-fg'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="rounded-[12px] bg-surface px-3 pb-2 pt-3">
          <div className="mb-2 flex items-center justify-between pl-2">
            <span className="text-[17px] font-semibold">{monthTitle(cursor)}</span>
            <div className="flex gap-1">
              <button type="button" aria-label="Предыдущий месяц" onClick={() => page(-1)} className="grid size-9 place-items-center rounded-full text-blue active:bg-surface-2">
                <ChevronLeft className="size-[22px]" strokeWidth={2.4} />
              </button>
              <button type="button" aria-label="Следующий месяц" onClick={() => page(1)} className="grid size-9 place-items-center rounded-full text-blue active:bg-surface-2">
                <ChevronRight className="size-[22px]" strokeWidth={2.4} />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 pb-1">
            {WEEKDAYS_SHORT.map((d) => (
              <span key={d} className="text-center text-[13px] font-semibold uppercase text-faint">
                {d}
              </span>
            ))}
          </div>
          <div className="touch-pan-y select-none overflow-hidden" {...swipe}>
            <div
              key={cursor.slice(0, 7)}
              className={`grid grid-cols-7 ${direction === 'left' ? 'animate-slide-right' : direction === 'right' ? 'animate-slide-left' : ''}`}
            >
              {days.map((key) => {
                const selected = key === date;
                const outside = !sameMonth(key, cursor);
                const past = key < today;
                return (
                  <button key={key} type="button" onClick={() => pick(key)} className="grid h-11 place-items-center" aria-label={key} aria-pressed={selected}>
                    <span
                      className={`grid size-10 place-items-center rounded-full text-[20px] tabular-nums transition-all duration-300 ease-spring ${
                        selected
                          ? 'bg-blue font-semibold text-white'
                          : key === today
                            ? 'font-semibold text-blue'
                            : outside
                              ? 'text-faint/50'
                              : past
                                ? 'text-faint'
                                : 'text-fg'
                      }`}
                    >
                      {fromKey(key).getDate()}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-[12px] bg-surface">
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-[17px]">Время</span>
            <Switch
              checked={Boolean(time)}
              disabled={!date}
              onChange={(on) => {
                haptic.selection();
                setTime(on ? '09:00' : undefined);
              }}
            />
          </div>
          {time && (
            <div className="animate-fade-in flex items-center justify-between border-t-[0.5px] border-line px-4 py-2">
              <span className="text-[15px] text-muted">{date ? humanDate(date) : ''}</span>
              <input
                type="time"
                value={time}
                onChange={(e) => e.target.value && setTime(e.target.value)}
                className="rounded-[8px] bg-surface-2 px-3 py-1.5 text-[17px] text-fg outline-none"
              />
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              setDate(undefined);
              setTime(undefined);
              haptic.selection();
            }}
            disabled={!date}
            className="h-[50px] flex-1 rounded-[14px] bg-surface text-[17px] text-red transition-[transform,opacity] duration-300 ease-spring active:scale-[0.97] disabled:opacity-40"
          >
            Без даты
          </button>
          <button
            type="button"
            onClick={done}
            className="h-[50px] flex-[2] rounded-[14px] bg-blue text-[17px] font-semibold text-white transition-transform duration-300 ease-spring active:scale-[0.97]"
          >
            Готово
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** iOS UISwitch. */
function Switch({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange(v: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-300 disabled:opacity-40 ${checked ? 'bg-green' : 'bg-surface-2'}`}
    >
      <span
        className={`absolute left-[2px] top-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.15),0_3px_1px_rgb(0_0_0/0.06)] transition-transform duration-300 ease-spring ${
          checked ? 'translate-x-[20px]' : ''
        }`}
      />
    </button>
  );
}

/** "3 октября, 15:00" / "Сегодня" — short label for a chosen date/time. */
export function formatDateTime({ date, time }: DateTimeValue): string {
  if (!date) return 'Без даты';
  return time ? `${humanDate(date)}, ${time}` : humanDate(date);
}
