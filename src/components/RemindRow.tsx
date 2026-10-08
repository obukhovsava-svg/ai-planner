import { useState } from 'react';
import { Bell, ChevronRight } from 'lucide-react';
import type { Reminder } from '@/types';
import { REMIND_PRESETS, atLabel, offsetLabel } from '@/lib/reminders';
import { addDays, todayKey } from '@/lib/date';
import { haptic } from '@/lib/telegram';
import { DatePickerSheet } from './DatePickerSheet';
import { Switch } from './Switch';
import { isNative } from '@/lib/native';

/** Who reminds you: the iOS app itself, or the Telegram bot. */
const WHO = isNative() ? 'Придёт уведомление' : 'Бот напишет';

interface RemindRowProps {
  value?: Reminder;
  onChange(value: Reminder | undefined): void;
  /** The item has a date — remind "N minutes before"; otherwise pick an exact moment. */
  hasDate: boolean;
  /** A task with a date but no time: the user picks the day (that day / the day before…) and the time. */
  timeMissing?: boolean;
  /** The task's date (with `timeMissing`). */
  date?: string;
}

const DAY_CHOICES: [number, string][] = [
  [0, 'В этот день'],
  [1, 'Накануне'],
  [2, 'За 2 дня'],
];

const short = (m: number) => (m === 0 ? 'Вовремя' : offsetLabel(m).replace('за ', ''));

/** "Напомнить" switch (off by default) with offset chips or an exact date/time for undated tasks. */
export function RemindRow({ value, onChange, hasDate, timeMissing, date }: RemindRowProps) {
  const [picker, setPicker] = useState(false);
  const [custom, setCustom] = useState(false);
  const [d, setD] = useState('0');
  const [h, setH] = useState('1');
  const [m, setM] = useState('0');
  const on = Boolean(value);

  const toggle = (next: boolean) => {
    haptic.selection();
    if (!next) {
      onChange(undefined);
      setCustom(false);
      return;
    }
    // A date without a time: remind at a chosen moment (default: that day, 09:00 — adjustable right here).
    if (hasDate && timeMissing && date) onChange({ at: `${date}T09:00` });
    else if (hasDate) onChange({ offset: 30 });
    else {
      // Undated task: default to tomorrow 09:00 and let the user adjust it.
      onChange({ at: `${addDays(todayKey(), 1)}T09:00` });
      setPicker(true);
    }
  };

  const offset = value?.offset ?? 0;
  const isPreset = REMIND_PRESETS.includes(offset);

  return (
    <div className="overflow-hidden rounded-[16px] bg-surface">
      <div className="flex items-center gap-3 px-4 py-[9px]">
        <span className="grid size-[30px] place-items-center rounded-[7px] bg-[#ff9500] text-white">
          <Bell className="size-[17px]" />
        </span>
        <span className="flex-1 text-[17px]">Напомнить</span>
        <Switch checked={on} onChange={toggle} />
      </div>

      {on && hasDate && timeMissing && date && value?.at && (() => {
        const [atDate, atTime] = value.at.split('T');
        const before = Math.round((new Date(`${date}T00:00`).getTime() - new Date(`${atDate}T00:00`).getTime()) / 86_400_000);
        return (
          <div className="animate-fade-in border-t-[0.5px] border-line px-4 pb-3 pt-2.5">
            <div className="flex flex-wrap gap-1.5">
              {DAY_CHOICES.map(([n, label]) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    haptic.selection();
                    onChange({ at: `${addDays(date, -n)}T${atTime}` });
                  }}
                  className={`rounded-full px-3 py-1.5 text-[14px] transition-all duration-300 ease-spring active:scale-95 ${
                    before === n ? 'bg-blue text-white' : 'bg-surface-2 text-fg'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="mt-2.5 flex items-center gap-3">
              <span className="flex-1 text-[17px]">Во сколько</span>
              <input
                type="time"
                value={atTime}
                onChange={(e) => e.target.value && onChange({ at: `${atDate}T${e.target.value}` })}
                className="rounded-[8px] bg-surface-2 px-2.5 py-1 text-[17px] text-blue outline-none"
              />
            </label>
            <p className="mt-2 text-[13px] text-muted">{WHO} {atLabel(value.at).toLowerCase()}.</p>
          </div>
        );
      })()}

      {on && hasDate && !(timeMissing && date) && value?.offset !== undefined && (
        <div className="animate-fade-in border-t-[0.5px] border-line px-4 pb-3 pt-2.5">
          <div className="flex flex-wrap gap-1.5">
            {REMIND_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  haptic.selection();
                  setCustom(false);
                  onChange({ offset: p });
                }}
                className={`rounded-full px-3 py-1.5 text-[14px] transition-all duration-300 ease-spring active:scale-95 ${
                  !custom && offset === p ? 'bg-blue text-white' : 'bg-surface-2 text-fg'
                }`}
              >
                {short(p)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                haptic.selection();
                setCustom(true);
              }}
              className={`rounded-full px-3 py-1.5 text-[14px] transition-all duration-300 ease-spring active:scale-95 ${
                custom || !isPreset ? 'bg-blue text-white' : 'bg-surface-2 text-fg'
              }`}
            >
              {!custom && !isPreset ? short(offset) : 'Своё'}
            </button>
          </div>
          {custom && (
            <div className="animate-fade-in mt-2.5 flex items-center gap-2">
              {(
                [
                  ['дн', d, setD, 30],
                  ['ч', h, setH, 23],
                  ['мин', m, setM, 59],
                ] as const
              ).map(([label, v, set, max]) => (
                <label key={label} className="flex items-center gap-1 rounded-[10px] bg-surface-2 px-2.5 py-1.5">
                  <input
                    inputMode="numeric"
                    value={v}
                    onChange={(e) => set(String(Math.min(max, Number(e.target.value.replace(/\D/g, '') || 0))))}
                    className="w-8 bg-transparent text-right text-[17px] tabular-nums text-fg outline-none"
                  />
                  <span className="text-[14px] text-muted">{label}</span>
                </label>
              ))}
              <button
                type="button"
                onClick={() => {
                  haptic.selection();
                  onChange({ offset: Number(d) * 1440 + Number(h) * 60 + Number(m) });
                  setCustom(false);
                }}
                className="ml-auto rounded-full bg-blue px-3.5 py-1.5 text-[14px] font-semibold text-white active:scale-95"
              >
                OK
              </button>
            </div>
          )}
          <p className="mt-2 text-[13px] text-muted">{WHO} {offsetLabel(offset)}.</p>
        </div>
      )}

      {on && !hasDate && value?.at && (
        <button
          type="button"
          onClick={() => setPicker(true)}
          className="animate-fade-in flex w-full items-center gap-3 border-t-[0.5px] border-line px-4 py-[11px] text-left active:bg-surface-2"
        >
          <span className="flex-1 text-[17px]">Когда</span>
          <span className="text-[17px] text-blue">{atLabel(value.at)}</span>
          <ChevronRight className="size-5 text-faint" />
        </button>
      )}

      <DatePickerSheet
        open={picker}
        title="Когда напомнить"
        clearLabel="Не напоминать"
        value={value?.at ? { date: value.at.split('T')[0], time: value.at.split('T')[1] } : {}}
        onChange={({ date, time }) => onChange(date ? { at: `${date}T${time ?? '09:00'}` } : undefined)}
        onClose={() => setPicker(false)}
      />
    </div>
  );
}
