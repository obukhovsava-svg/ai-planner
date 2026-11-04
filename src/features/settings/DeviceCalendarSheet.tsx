import { Sheet } from '@/components/Sheet';
import { Switch } from '@/components/Switch';
import { disableDeviceCalendar, enableDeviceCalendar, toggleDeviceCalendar, useDeviceCalendar } from '@/store/useDeviceCalendar';
import { postNative } from '@/lib/native';

export function DeviceCalendarSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { on, denied, calendars, hidden } = useDeviceCalendar();
  return (
    <Sheet open={open} title="Встречи из календаря" onClose={onClose}>
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex items-center justify-between gap-3 rounded-[14px] bg-surface px-4 py-3">
          <span className="text-[17px]">Показывать в планере</span>
          <Switch checked={on && !denied} onChange={(v) => (v ? enableDeviceCalendar() : disableDeviceCalendar())} />
        </div>
        <p className="px-1 text-[13px] leading-snug text-muted">
          Встречи из Outlook и других календарей этого устройства сами появятся в планере как обычные события: с описанием в заметке, в виджете и у ассистента. Как и всё в планере, они хранятся на сервере ПЛАН, а ассистент может передавать их нейросетям для ответа. Изменения идут в обе стороны: перенос, правка или удаление в планере меняют встречу и в календаре. Встречи, куда вас пригласили, может менять только организатор.
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
          <div className="overflow-hidden rounded-[14px] bg-surface">
            {calendars.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 border-b-[0.5px] border-line px-4 py-2.5 last:border-b-0">
                <span className="min-w-0">
                  <span className="block truncate text-[16px]">{c.title}</span>
                  <span className="block truncate text-[12px] text-muted">{c.source}</span>
                </span>
                <Switch checked={!hidden.includes(c.id)} onChange={(v) => toggleDeviceCalendar(c.id, v)} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
