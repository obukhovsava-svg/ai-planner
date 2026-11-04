import { Check } from 'lucide-react';
import { Sheet } from '@/components/Sheet';
import { disableDeviceCalendar, enableDeviceCalendar, toggleDeviceCalendar, useDeviceCalendar } from '@/store/useDeviceCalendar';
import { postNative } from '@/lib/native';
import { usePlannerStore } from '@/store/usePlannerStore';
import { haptic } from '@/lib/telegram';

function CheckRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => {
        haptic.selection();
        onChange(!checked);
      }}
      className="flex w-full items-center justify-between gap-3 border-b-[0.5px] border-line px-4 py-3 text-left transition-colors last:border-b-0 active:bg-surface-2"
    >
      <span className="min-w-0">
        <span className="block truncate text-[17px]">{label}</span>
        {hint && <span className="block truncate text-[12px] text-muted">{hint}</span>}
      </span>
      {checked && <Check className="size-5 shrink-0 text-blue" strokeWidth={2.6} />}
    </button>
  );
}

export function DeviceCalendarSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { on, denied, calendars, hidden, owner } = useDeviceCalendar();
  // Meetings another device brought in reach this one through the account, tick or no tick.
  const elsewhere = usePlannerStore((s) => !on && s.events.some((e) => e.device && e.device.owner !== owner));
  return (
    <Sheet open={open} title="Интеграция" onClose={onClose}>
      <div className="flex flex-col gap-4 pb-2">
        <div className="overflow-hidden rounded-[14px] bg-surface">
          <CheckRow label="Календарь" hint={elsewhere ? 'Подключён на другом устройстве, встречи уже здесь' : undefined} checked={on && !denied} onChange={(v) => (v ? enableDeviceCalendar() : disableDeviceCalendar())} />
        </div>
        <p className="px-1 text-[13px] leading-snug text-muted">
          События календаря появятся в планере, а изменения будут идти в обе стороны. Как и всё в планере, они хранятся на сервере ПЛАН, а ассистент может передавать их нейросетям для ответа.
        </p>
        {on && denied && (
          <div className="flex flex-col gap-2 px-1">
            <p className="text-[15px] leading-snug">Нет доступа к календарю. Разрешите полный доступ в настройках.</p>
            <button type="button" onClick={() => postNative({ type: 'open', url: 'app-settings:' })} className="self-start text-[15px] text-blue">
              Открыть настройки
            </button>
          </div>
        )}
        {on && !denied && calendars.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="px-4 text-[13px] uppercase text-muted">Какие календари</span>
            <div className="overflow-hidden rounded-[14px] bg-surface">
              {calendars.map((c) => (
                <CheckRow key={c.id} label={c.title} hint={c.source} checked={!hidden.includes(c.id)} onChange={(v) => toggleDeviceCalendar(c.id, v)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
