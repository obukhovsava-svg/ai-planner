import { useState } from 'react';
import type { DateKey } from '@/types';
import { humanDate } from '@/lib/date';
import { isMacApp } from '@/lib/native';
import { DatePickerSheet } from './DatePickerSheet';

/**
 * Date input. Everywhere but the Mac app it's the native field; there the native one opens an
 * iOS picker the Mac doesn't support (the app crashes), so it's the planner's own month picker.
 */
export function DateField({ value, onChange, className = '' }: { value: DateKey; onChange(v: DateKey): void; className?: string }) {
  const [mac] = useState(isMacApp);
  const [open, setOpen] = useState(false);
  if (!mac) return <input type="date" className={className} value={value} onChange={(e) => e.target.value && onChange(e.target.value as DateKey)} />;
  return (
    <>
      <button type="button" className={`${className} text-left`} onClick={() => setOpen(true)}>
        {humanDate(value, { relative: false })}
      </button>
      <DatePickerSheet
        open={open}
        title="Дата"
        withTime={false}
        clearLabel="Отмена"
        value={{ date: value }}
        onChange={({ date }) => date && onChange(date)}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
