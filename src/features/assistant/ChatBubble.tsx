import { CalendarClock, CheckSquare, Clock } from 'lucide-react';
import type { ChatMessage } from '@/store/useChatStore';
import { useChatStore } from '@/store/useChatStore';
import { usePlannerStore } from '@/store/usePlannerStore';
import { useUIStore } from '@/store/useUIStore';
import { CATEGORY_META, EVENT_COLORS, PRIORITY_META } from '@/lib/meta';
import { humanDate } from '@/lib/date';
import { haptic } from '@/lib/telegram';

export function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="animate-fade-up flex justify-end pl-12">
        <p className="rounded-[20px] bg-blue px-3.5 py-2 text-[17px] leading-[22px] text-white">{message.text}</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-up flex flex-col gap-2 pr-6">
      <p className="px-1 text-[17px] leading-[24px]">{message.text}</p>
      {message.attachment && <Attachment message={message} />}
    </div>
  );
}

function Attachment({ message }: { message: ChatMessage }) {
  const a = message.attachment!;
  const setTab = useUIStore((s) => s.setTab);
  const setSelectedDate = useUIStore((s) => s.setSelectedDate);
  const setDayOpen = useUIStore((s) => s.setDayOpen);
  const deleteEvent = usePlannerStore((s) => s.deleteEvent);
  const deleteTask = usePlannerStore((s) => s.deleteTask);
  const markUndone = useChatStore((s) => s.markUndone);

  if (a.type === 'agenda') {
    return (
      <div className="overflow-hidden rounded-[14px] bg-surface">
        {a.events.map((e) => (
          <div key={e.id} className="flex items-center gap-3 border-t-[0.5px] border-line py-2.5 pl-4 pr-4 first:border-t-0">
            <span className={`h-9 w-[3px] rounded-full ${EVENT_COLORS[e.color].bar}`} />
            <div className="min-w-0">
              <p className="truncate text-[17px]">{e.title}</p>
              <p className="text-[15px] text-muted">
                {e.start} – {e.end}
              </p>
            </div>
          </div>
        ))}
        {a.tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-3 border-t-[0.5px] border-line py-3 pl-4 pr-4 first:border-t-0">
            <span className="size-[18px] shrink-0 rounded-full border-[1.5px] border-faint" />
            <p className="truncate text-[17px]">{t.title}</p>
          </div>
        ))}
      </div>
    );
  }

  const isEvent = a.type === 'event';
  const title = isEvent ? a.event.title : a.task.title;
  const date = isEvent ? a.event.date : a.task.date;
  const time = isEvent ? `${a.event.start} – ${a.event.end}` : a.task.time;

  const open = () => {
    haptic.impact('light');
    if (isEvent) {
      setSelectedDate(a.event.date);
      setDayOpen(true);
      setTab('calendar');
    } else {
      setTab('tasks');
    }
  };

  const undo = () => {
    haptic.notify('warning');
    if (isEvent) deleteEvent(a.event.id);
    else deleteTask(a.task.id);
    markUndone(message.id);
  };

  return (
    <div className={`overflow-hidden rounded-[14px] bg-surface transition-opacity duration-500 ${a.undone ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3 p-3.5">
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-[10px] ${isEvent ? EVENT_COLORS[a.event.color].bg : 'bg-blue/15'}`}
        >
          {isEvent ? (
            <CalendarClock className={`size-5 ${EVENT_COLORS[a.event.color].text}`} />
          ) : (
            <CheckSquare className="size-5 text-blue" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-[17px] font-semibold ${a.undone ? 'line-through' : ''}`}>{title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[15px] text-muted">
            {date ? humanDate(date) : 'Без даты'}
            {time && (
              <>
                <Clock className="size-3.5 shrink-0" />
                {time}
              </>
            )}
          </p>
          {!isEvent && (
            <p className="mt-0.5 text-[13px] text-muted">
              {CATEGORY_META[a.task.category].emoji} {CATEGORY_META[a.task.category].label}
              {a.task.priority !== 'medium' && ` · ${PRIORITY_META[a.task.priority].label} приоритет`}
            </p>
          )}
        </div>
      </div>
      {a.undone ? (
        <p className="border-t-[0.5px] border-line py-3 text-center text-[15px] text-muted">Отменено</p>
      ) : (
        <div className="grid grid-cols-2 border-t-[0.5px] border-line">
          <button type="button" onClick={undo} className="py-3 text-[17px] text-red transition-colors active:bg-surface-2">
            Отменить
          </button>
          <button
            type="button"
            onClick={open}
            className="border-l-[0.5px] border-line py-3 text-[17px] font-semibold text-blue transition-colors active:bg-surface-2"
          >
            Открыть
          </button>
        </div>
      )}
    </div>
  );
}
