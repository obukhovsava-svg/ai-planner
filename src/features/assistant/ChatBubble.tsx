import { CalendarClock, CheckSquare, Clock, ExternalLink, Sparkles, Undo2 } from 'lucide-react';
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
      <div className="animate-fade-up flex justify-end">
        <p className="max-w-[80%] rounded-[20px] rounded-br-md bg-blue px-4 py-2.5 text-[15px] text-white">{message.text}</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-up flex gap-2.5">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-gemini text-white">
        <Sparkles className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-[15px] leading-relaxed">{message.text}</p>
        {message.attachment && <Attachment message={message} />}
      </div>
    </div>
  );
}

function Attachment({ message }: { message: ChatMessage }) {
  const a = message.attachment!;
  const setTab = useUIStore((s) => s.setTab);
  const setSelectedDate = useUIStore((s) => s.setSelectedDate);
  const setTasksMode = useUIStore((s) => s.setTasksMode);
  const deleteEvent = usePlannerStore((s) => s.deleteEvent);
  const deleteTask = usePlannerStore((s) => s.deleteTask);
  const markUndone = useChatStore((s) => s.markUndone);

  if (a.type === 'agenda') {
    return (
      <div className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {a.events.map((e) => (
          <div key={e.id} className="flex items-center gap-3 px-3.5 py-2.5">
            <span className={`h-8 w-1 rounded-full ${EVENT_COLORS[e.color].bar}`} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{e.title}</p>
              <p className="text-xs text-muted">
                {e.start} – {e.end}
              </p>
            </div>
          </div>
        ))}
        {a.tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-3.5 py-2.5">
            <CheckSquare className="size-4 text-muted" />
            <p className="truncate text-sm">{t.title}</p>
          </div>
        ))}
      </div>
    );
  }

  const isEvent = a.type === 'event';
  const title = isEvent ? a.event.title : a.task.title;
  const date = isEvent ? a.event.date : a.task.date;

  const open = () => {
    haptic.impact('light');
    if (isEvent) {
      setSelectedDate(a.event.date);
      setTab('calendar');
    } else {
      setTasksMode(a.task.date ? 'dated' : 'all');
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
    <div className={`rounded-2xl border border-line bg-surface p-3.5 shadow-card transition-opacity ${a.undone ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-3">
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-xl ${
            isEvent ? EVENT_COLORS[a.event.color].bg : 'bg-gemini-soft'
          }`}
        >
          {isEvent ? (
            <CalendarClock className={`size-5 ${EVENT_COLORS[a.event.color].text}`} />
          ) : (
            <CheckSquare className="size-5 text-blue dark:text-sky" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`truncate font-semibold ${a.undone ? 'line-through' : ''}`}>{title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">{isEvent ? 'Событие' : 'Задача'}</span>
            {date ? humanDate(date) : 'Без даты'}
            {isEvent && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                {a.event.start}–{a.event.end}
              </span>
            )}
            {!isEvent && a.task.time && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                {a.task.time}
              </span>
            )}
          </p>
          {!isEvent && (
            <div className="mt-2 flex gap-1.5">
              <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${PRIORITY_META[a.task.priority].className}`}>
                {PRIORITY_META[a.task.priority].label}
              </span>
              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                {CATEGORY_META[a.task.category].emoji} {CATEGORY_META[a.task.category].label}
              </span>
            </div>
          )}
        </div>
      </div>
      {a.undone ? (
        <p className="mt-3 text-center text-xs text-muted">Отменено</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={undo}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-surface-2 py-2 text-[13px] font-semibold text-muted active:scale-95"
          >
            <Undo2 className="size-3.5" /> Отменить
          </button>
          <button
            type="button"
            onClick={open}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-fg py-2 text-[13px] font-semibold text-bg active:scale-95"
          >
            Открыть <ExternalLink className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
