import { useState, type ReactNode } from 'react';
import { CalendarClock, CalendarDays, CheckSquare, Clock, Repeat, Undo2 } from 'lucide-react';
import type { CalendarEvent, DateKey, Task } from '@/types';
import { useChatStore, type ChatAttachment, type ChatMessage, type Draft } from '@/store/useChatStore';
import { usePlannerStore } from '@/store/usePlannerStore';
import { useUIStore } from '@/store/useUIStore';
import { CATEGORY_META, EVENT_COLORS, PRIORITY_META } from '@/lib/meta';
import { addDays, fromKey, humanDate, minutesToTime, timeToMinutes, todayKey, weekdayMon } from '@/lib/date';
import { repeatLabel } from '@/lib/recurrence';
import { haptic } from '@/lib/telegram';
import { DatePickerSheet } from '@/components/DatePickerSheet';
import { answerChoose, answerClarify, answerConfirm, answerMove, answerRemind, cancelCard, cancelClarify, candLabel, durationLabel, undoLast } from './brain';
import { REMIND_PRESETS, offsetLabel } from '@/lib/reminders';

export function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="animate-fade-up flex justify-end pl-12">
        <p className="whitespace-pre-line rounded-[20px] bg-blue px-3.5 py-2 text-[17px] leading-[22px] text-white">{message.text}</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-up flex flex-col gap-2 pr-4">
      {message.text && <p className="whitespace-pre-line px-1 text-[17px] leading-[24px]">{message.text}</p>}
      {message.attachment && <Attachment message={message} />}
    </div>
  );
}

function Attachment({ message }: { message: ChatMessage }) {
  const a = message.attachment!;
  switch (a.type) {
    case 'agenda':
      return <Agenda a={a} />;
    case 'clarify':
      return a.state ? null : <ClarifyCard id={message.id} draft={a.draft} ask={a.ask} />;
    case 'choose':
      return a.state ? null : <ChooseCard message={message} />;
    case 'undo':
      return <UndoChip message={message} />;
    case 'confirm':
      return a.state ? null : <ConfirmCard id={message.id} />;
    case 'move-ask':
      return a.state ? null : <MoveAskCard id={message.id} a={a} />;
    case 'remind-ask':
      return a.state ? null : <RemindAskCard id={message.id} a={a} />;
    default:
      return <ItemCard message={message} a={a} />;
  }
}

/* ---------------------------------------------------------------- clarify */

const TIME_CHIPS = ['08:00', '09:00', '10:00', '12:00', '14:00', '15:00', '17:00', '18:00', '19:00', '20:00'];
const DURATIONS = [30, 60, 90, 120, 180];
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function Chip({ children, onClick, tone = 'plain' }: { children: ReactNode; onClick(): void; tone?: 'plain' | 'accent' | 'quiet' }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.selection();
        onClick();
      }}
      className={`shrink-0 rounded-full px-3.5 py-2 text-[15px] transition-transform duration-300 ease-spring active:scale-95 ${
        tone === 'accent' ? 'bg-blue font-semibold text-white' : tone === 'quiet' ? 'text-muted' : 'bg-surface-2 text-fg'
      }`}
    >
      {children}
    </button>
  );
}

/** Mini picker shown when the assistant needs one more detail. */
function ClarifyCard({ id, draft, ask }: { id: string; draft: Draft; ask: 'kind' | 'date' | 'time' | 'end' | 'start-day' }) {
  const [picker, setPicker] = useState(false);
  const [custom, setCustom] = useState('');
  const answer = (patch: Partial<Draft>) => answerClarify(id, patch);
  const today = todayKey();

  const dayChips = (onPick: (d: DateKey) => void) => {
    const days: [string, DateKey][] = [
      ['Сегодня', today],
      ['Завтра', addDays(today, 1)],
      ...Array.from({ length: 5 }, (_, i) => {
        const d = addDays(today, i + 2);
        return [`${WD[weekdayMon(fromKey(d))]} ${fromKey(d).getDate()}`, d] as [string, DateKey];
      }),
    ];
    return (
      <>
        {days.map(([label, d]) => (
          <Chip key={d} onClick={() => onPick(d)}>
            {label}
          </Chip>
        ))}
        <Chip onClick={() => setPicker(true)}>
          <span className="flex items-center gap-1.5">
            <CalendarDays className="size-4 text-blue" /> Другая дата
          </span>
        </Chip>
      </>
    );
  };

  const summary = [
    draft.date && humanDate(draft.date),
    draft.start && `${draft.start}${draft.end ? `–${draft.end}` : ''}`,
    draft.repeat && repeatLabel(draft.repeat),
  ].filter(Boolean);

  return (
    <div className="animate-fade-up overflow-hidden rounded-[18px] bg-surface">
      <div className="flex items-center gap-3 px-3.5 pt-3.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-gemini-soft">
          {draft.kind === 'task' ? <CheckSquare className="size-[18px] text-blue" /> : <CalendarClock className="size-[18px] text-blue" />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[17px] font-semibold">{draft.title}</p>
          {summary.length > 0 && <p className="truncate text-[13px] text-muted">{summary.join(' · ')}</p>}
        </div>
      </div>

      <div className="no-scrollbar flex flex-wrap gap-2 p-3.5">
        {ask === 'kind' && (
          <>
            <Chip tone="accent" onClick={() => answer({ kind: 'event' })}>
              📅 Событие
            </Chip>
            <Chip onClick={() => answer({ kind: 'task' })}>☑️ Задача</Chip>
          </>
        )}

        {(ask === 'date' || ask === 'start-day') && dayChips((d) => answer({ date: d, needsStart: false }))}

        {ask === 'time' &&
          TIME_CHIPS.map((t) => (
            <Chip key={t} onClick={() => answer({ start: t })}>
              {t}
            </Chip>
          ))}

        {ask === 'end' &&
          DURATIONS.map((m) => (
            <Chip key={m} tone={m === 60 ? 'accent' : 'plain'} onClick={() => answer({ duration: m })}>
              {durationLabel(m)}
              <span className="ml-1 opacity-60">до {minutesToTime(timeToMinutes(draft.start!) + m)}</span>
            </Chip>
          ))}

        {(ask === 'time' || ask === 'end') && (
          <form
            className="flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-3.5 pr-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!custom) return;
              haptic.selection();
              answer(ask === 'time' ? { start: custom } : { end: custom });
            }}
          >
            <span className="text-[15px] text-muted">{ask === 'time' ? 'Своё' : 'До'}</span>
            <input
              type="time"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="bg-transparent text-[15px] text-fg outline-none"
            />
            <button type="submit" disabled={!custom} className="rounded-full bg-blue px-3 py-1 text-[13px] font-semibold text-white disabled:opacity-30">
              OK
            </button>
          </form>
        )}
      </div>

      <div className="flex border-t-[0.5px] border-line">
        {ask !== 'kind' && draft.kind === 'event' && !draft.repeat && (
          <button
            type="button"
            onClick={() => answer({ kind: 'task' })}
            className="flex-1 py-3 text-[15px] text-blue transition-colors active:bg-surface-2"
          >
            Сделать задачей
          </button>
        )}
        <button
          type="button"
          onClick={() => cancelClarify(id)}
          className="flex-1 border-l-[0.5px] border-line py-3 text-[15px] text-red transition-colors first:border-l-0 active:bg-surface-2"
        >
          Отмена
        </button>
      </div>

      <DatePickerSheet
        open={picker}
        title={ask === 'start-day' ? 'Первый день графика' : 'Дата'}
        withTime={false}
        clearLabel="Отмена"
        value={{ date: draft.date }}
        onChange={({ date }) => date && answer({ date, needsStart: false })}
        onClose={() => setPicker(false)}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- confirm / move */

function ConfirmCard({ id }: { id: string }) {
  return (
    <div className="animate-fade-up grid grid-cols-2 overflow-hidden rounded-[18px] bg-surface">
      <button
        type="button"
        onClick={() => {
          haptic.notify('warning');
          answerConfirm(id);
        }}
        className="py-3.5 text-[17px] font-semibold text-red transition-colors active:bg-surface-2"
      >
        Удалить
      </button>
      <button type="button" onClick={() => cancelCard(id)} className="border-l-[0.5px] border-line py-3.5 text-[17px] text-blue transition-colors active:bg-surface-2">
        Отмена
      </button>
    </div>
  );
}

/** "Перенеси X" without a new time: pick the day, then the time. */
function MoveAskCard({ id, a }: { id: string; a: Extract<ChatAttachment, { type: 'move-ask' }> }) {
  const [picker, setPicker] = useState(false);
  const [custom, setCustom] = useState('');
  const today = todayKey();
  const days: [string, DateKey][] = [
    ['Сегодня', today],
    ['Завтра', addDays(today, 1)],
    ...Array.from({ length: 5 }, (_, i) => {
      const d = addDays(today, i + 2);
      return [`${WD[weekdayMon(fromKey(d))]} ${fromKey(d).getDate()}`, d] as [string, DateKey];
    }),
  ];
  return (
    <div className="animate-fade-up overflow-hidden rounded-[18px] bg-surface">
      <div className="flex flex-wrap gap-2 p-3.5">
        {a.step === 'date' ? (
          <>
            {days
              .filter(([, d]) => d !== a.candidate.date)
              .map(([label, d]) => (
                <Chip key={d} onClick={() => answerMove(id, { date: d })}>
                  {label}
                </Chip>
              ))}
            <Chip onClick={() => setPicker(true)}>
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-4 text-blue" /> Другая дата
              </span>
            </Chip>
          </>
        ) : (
          <>
            {a.candidate.time && (
              <Chip tone="accent" onClick={() => answerMove(id, { keepTime: true })}>
                Оставить {a.candidate.time}
              </Chip>
            )}
            {TIME_CHIPS.filter((t) => t !== a.candidate.time).map((t) => (
              <Chip key={t} onClick={() => answerMove(id, { start: t })}>
                {t}
              </Chip>
            ))}
            <form
              className="flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-3.5 pr-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (custom) answerMove(id, { start: custom });
              }}
            >
              <span className="text-[15px] text-muted">Своё</span>
              <input type="time" value={custom} onChange={(e) => setCustom(e.target.value)} className="bg-transparent text-[15px] text-fg outline-none" />
              <button type="submit" disabled={!custom} className="rounded-full bg-blue px-3 py-1 text-[13px] font-semibold text-white disabled:opacity-30">
                OK
              </button>
            </form>
          </>
        )}
      </div>
      <button type="button" onClick={() => cancelCard(id)} className="w-full border-t-[0.5px] border-line py-3 text-[15px] text-red transition-colors active:bg-surface-2">
        Отмена
      </button>
      <DatePickerSheet
        open={picker}
        title="Новая дата"
        withTime={false}
        clearLabel="Отмена"
        value={{ date: a.candidate.date }}
        onChange={({ date }) => date && answerMove(id, { date })}
        onClose={() => setPicker(false)}
      />
    </div>
  );
}

/** "За сколько напомнить?" — offset chips; for undated tasks: day, then time. */
function RemindAskCard({ id, a }: { id: string; a: Extract<ChatAttachment, { type: 'remind-ask' }> }) {
  const [picker, setPicker] = useState(false);
  const [custom, setCustom] = useState('');
  const today = todayKey();
  const days: [string, DateKey][] = [
    ['Сегодня', today],
    ['Завтра', addDays(today, 1)],
    ...Array.from({ length: 5 }, (_, i) => {
      const d = addDays(today, i + 2);
      return [`${WD[weekdayMon(fromKey(d))]} ${fromKey(d).getDate()}`, d] as [string, DateKey];
    }),
  ];
  return (
    <div className="animate-fade-up overflow-hidden rounded-[18px] bg-surface">
      <div className="flex flex-wrap gap-2 p-3.5">
        {a.step === 'offset' &&
          REMIND_PRESETS.map((m) => (
            <Chip key={m} tone={m === 30 ? 'accent' : 'plain'} onClick={() => answerRemind(id, { offset: m })}>
              {m ? offsetLabel(m) : 'Вовремя'}
            </Chip>
          ))}
        {a.step === 'date' && (
          <>
            {days.map(([label, d]) => (
              <Chip key={d} onClick={() => answerRemind(id, { date: d })}>
                {label}
              </Chip>
            ))}
            <Chip onClick={() => setPicker(true)}>
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-4 text-blue" /> Другая дата
              </span>
            </Chip>
          </>
        )}
        {a.step === 'time' && (
          <>
            {TIME_CHIPS.map((t) => (
              <Chip key={t} onClick={() => answerRemind(id, { time: t })}>
                {t}
              </Chip>
            ))}
            <form
              className="flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-3.5 pr-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (custom) answerRemind(id, { time: custom });
              }}
            >
              <span className="text-[15px] text-muted">Своё</span>
              <input type="time" value={custom} onChange={(e) => setCustom(e.target.value)} className="bg-transparent text-[15px] text-fg outline-none" />
              <button type="submit" disabled={!custom} className="rounded-full bg-blue px-3 py-1 text-[13px] font-semibold text-white disabled:opacity-30">
                OK
              </button>
            </form>
          </>
        )}
      </div>
      <button type="button" onClick={() => cancelCard(id)} className="w-full border-t-[0.5px] border-line py-3 text-[15px] text-red transition-colors active:bg-surface-2">
        Отмена
      </button>
      <DatePickerSheet
        open={picker}
        title="Когда напомнить"
        withTime={false}
        clearLabel="Отмена"
        value={{}}
        onChange={({ date }) => date && answerRemind(id, { date })}
        onClose={() => setPicker(false)}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- choose / undo */

function ChooseCard({ message }: { message: ChatMessage }) {
  const a = message.attachment as Extract<ChatAttachment, { type: 'choose' }>;
  return (
    <div className="animate-fade-up overflow-hidden rounded-[18px] bg-surface">
      {a.candidates.map((c, i) => (
        <button
          key={`${c.id}-${c.date}`}
          type="button"
          onClick={() => {
            haptic.impact('light');
            answerChoose(message.id, c);
          }}
          className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-surface-2 ${i ? 'border-t-[0.5px] border-line' : ''}`}
        >
          {c.kind === 'event' ? <CalendarClock className="size-[18px] shrink-0 text-blue" /> : <CheckSquare className="size-[18px] shrink-0 text-blue" />}
          <span className="min-w-0 flex-1 truncate text-[17px]">{candLabel(c)}</span>
        </button>
      ))}
      <button type="button" onClick={() => cancelCard(message.id)} className="w-full border-t-[0.5px] border-line py-3 text-[15px] text-red transition-colors active:bg-surface-2">
        Отмена
      </button>
    </div>
  );
}

function UndoChip({ message }: { message: ChatMessage }) {
  const messages = useChatStore((s) => s.messages);
  const canUndo = useChatStore((s) => s.undo.length > 0);
  const push = useChatStore((s) => s.push);
  const update = useChatStore((s) => s.update);
  const a = message.attachment as Extract<ChatAttachment, { type: 'undo' }>;
  // Only the latest change can be undone from the chat.
  const latest = [...messages].reverse().find((m) => m.attachment?.type === 'undo' && !(m.attachment as { state?: string }).state);
  if (a.state === 'done' || latest?.id !== message.id || !canUndo) return null;
  return (
    <button
      type="button"
      onClick={() => {
        haptic.notify('warning');
        const text = undoLast();
        update(message.id, { attachment: { type: 'undo', state: 'done' } });
        push({ role: 'assistant', text });
      }}
      className="flex w-fit items-center gap-1.5 rounded-full bg-surface px-3.5 py-2 text-[15px] text-blue transition-transform duration-300 ease-spring active:scale-95"
    >
      <Undo2 className="size-4" /> Отменить
    </button>
  );
}

/* ---------------------------------------------------------------- agenda */

function Agenda({ a }: { a: Extract<ChatAttachment, { type: 'agenda' }> }) {
  const days = a.days ?? [{ date: a.date, events: a.events, tasks: a.tasks }];
  return (
    <div className="flex flex-col gap-2">
      {days.map((d) => (
        <div key={d.date} className="overflow-hidden rounded-[18px] bg-surface">
          {days.length > 1 && <p className="px-4 pb-1 pt-3 text-[13px] font-semibold uppercase text-muted">{humanDate(d.date)}</p>}
          <AgendaRows events={d.events} tasks={d.tasks} />
        </div>
      ))}
    </div>
  );
}

function AgendaRows({ events, tasks }: { events: CalendarEvent[]; tasks: Task[] }) {
  return (
    <>
      {events.map((e) => (
        <div key={e.id} className="flex items-center gap-3 border-t-[0.5px] border-line py-2.5 pl-4 pr-4 first:border-t-0">
          <span className={`h-9 w-[3px] shrink-0 rounded-full ${EVENT_COLORS[e.color].bar}`} />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-[17px]">
              {e.title}
              {e.repeat && <Repeat className="size-3.5 shrink-0 text-muted" />}
            </p>
            <p className="text-[15px] text-muted">
              {e.start} – {e.end}
            </p>
          </div>
        </div>
      ))}
      {tasks.map((t) => (
        <div key={t.id} className="flex items-center gap-3 border-t-[0.5px] border-line py-3 pl-4 pr-4 first:border-t-0">
          <span className="size-[18px] shrink-0 rounded-full border-[1.5px] border-faint" />
          <p className="truncate text-[17px]">{t.title}</p>
          {t.time && <span className="ml-auto text-[15px] text-muted">{t.time}</span>}
        </div>
      ))}
    </>
  );
}

/* ---------------------------------------------------------------- created item */

function ItemCard({ message, a }: { message: ChatMessage; a: Extract<ChatAttachment, { type: 'event' | 'task' }> }) {
  const setTab = useUIStore((s) => s.setTab);
  const setSelectedDate = useUIStore((s) => s.setSelectedDate);
  const setDayOpen = useUIStore((s) => s.setDayOpen);
  const deleteEvent = usePlannerStore((s) => s.deleteEvent);
  const deleteTask = usePlannerStore((s) => s.deleteTask);
  const markUndone = useChatStore((s) => s.markUndone);

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
    <div className={`overflow-hidden rounded-[18px] bg-surface transition-opacity duration-500 ${a.undone ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3 p-3.5">
        <span className={`grid size-10 shrink-0 place-items-center rounded-[12px] ${isEvent ? EVENT_COLORS[a.event.color].bg : 'bg-blue/15'}`}>
          {isEvent ? <CalendarClock className={`size-5 ${EVENT_COLORS[a.event.color].text}`} /> : <CheckSquare className="size-5 text-blue" />}
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
          {isEvent && a.event.repeat && (
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
              <Repeat className="size-3.5" /> {repeatLabel(a.event.repeat)}
            </p>
          )}
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
          <button type="button" onClick={open} className="border-l-[0.5px] border-line py-3 text-[17px] font-semibold text-blue transition-colors active:bg-surface-2">
            Открыть
          </button>
        </div>
      )}
    </div>
  );
}
