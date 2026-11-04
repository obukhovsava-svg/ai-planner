import { MapPin } from 'lucide-react';
import type { CalendarEvent } from '@/types';
import { Sheet } from '@/components/Sheet';
import { longDate } from '@/lib/date';

/** A meeting from the device's calendar: read-only here, it's changed where it came from. */
export function DeviceEventSheet({ event, onClose }: { event: CalendarEvent | null; onClose(): void }) {
  const d = event?.device;
  return (
    <Sheet open={Boolean(event)} title="Встреча" onClose={onClose}>
      {event && d && (
        <div className="flex flex-col gap-3 px-1 pb-2">
          <h3 className="text-[20px] font-semibold leading-snug">{event.title}</h3>
          <p className="text-[15px] text-muted">
            {longDate(event.date)}, {d.allDay ? 'весь день' : `${event.start} – ${event.end}`}
          </p>
          {d.location && (
            <p className="flex items-start gap-1.5 text-[15px]">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted" />
              <span className="min-w-0 break-words">{d.location}</span>
            </p>
          )}
          {event.note && <p className="whitespace-pre-wrap break-words text-[15px]">{event.note}</p>}
          <p className="text-[13px] text-muted">Из календаря «{d.calendar}». Изменить встречу можно там, где она создана.</p>
        </div>
      )}
    </Sheet>
  );
}
