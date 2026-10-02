import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Inbox } from 'lucide-react';
import type { Category, DateKey, Task } from '@/types';
import { Header } from '@/components/Header';
import { Segmented } from '@/components/Segmented';
import { usePlannerStore } from '@/store/usePlannerStore';
import { useUIStore } from '@/store/useUIStore';
import { CATEGORY_META } from '@/lib/meta';
import { WEEKDAYS_SHORT, addDays, fromKey, humanDate, todayKey, weekdayMon } from '@/lib/date';
import { haptic } from '@/lib/telegram';
import { QuickAdd } from './QuickAdd';
import { TaskItem } from './TaskItem';
import { TaskSheet } from './TaskSheet';

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

function byPriorityThenDate(a: Task, b: Task) {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    (a.date ?? '9999').localeCompare(b.date ?? '9999') ||
    (a.time ?? '').localeCompare(b.time ?? '') ||
    b.createdAt - a.createdAt
  );
}

function byDateThenTime(a: Task, b: Task) {
  return (a.date ?? '').localeCompare(b.date ?? '') || (a.time ?? '99').localeCompare(b.time ?? '99') || byPriorityThenDate(a, b);
}

export function TasksTab() {
  const tasks = usePlannerStore((s) => s.tasks);
  const mode = useUIStore((s) => s.tasksMode);
  const setMode = useUIStore((s) => s.setTasksMode);
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [day, setDay] = useState<DateKey | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const filtered = useMemo(() => (category === 'all' ? tasks : tasks.filter((t) => t.category === category)), [tasks, category]);
  const activeCount = tasks.filter((t) => !t.done).length;

  return (
    <div className="flex h-full flex-col">
      <Header title="Задачи" subtitle={activeCount ? `${activeCount} активн${activeCount === 1 ? 'ая' : 'ых'}` : 'Всё сделано 🎉'} />

      <div className="pb-tabbar min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 px-4">
          <QuickAdd defaultDate={mode === 'dated' ? (day ?? undefined) : undefined} />
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'all', label: 'Все задачи' },
              { value: 'dated', label: 'По датам' },
            ]}
          />
        </div>

        <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-1 pt-3">
          {(['all', ...Object.keys(CATEGORY_META)] as (Category | 'all')[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                haptic.selection();
                setCategory(c);
              }}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                category === c ? 'border-transparent bg-fg text-bg' : 'border-line bg-surface text-muted'
              }`}
            >
              {c === 'all' ? 'Все' : `${CATEGORY_META[c].emoji} ${CATEGORY_META[c].label}`}
            </button>
          ))}
        </div>

        <div key={mode} className="animate-fade-up px-4 pt-2">
          {mode === 'all' ? (
            <AllView tasks={filtered} showDone={showDone} setShowDone={setShowDone} onOpen={setEditing} />
          ) : (
            <DatedView tasks={filtered} day={day} setDay={setDay} onOpen={setEditing} />
          )}
        </div>
      </div>

      <TaskSheet task={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function Section({ title, count, children, tone }: { title: string; count: number; children: ReactNode; tone?: 'red' }) {
  return (
    <section className="mt-4 first:mt-2">
      <h3 className={`mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold uppercase tracking-wide ${tone === 'red' ? 'text-red' : 'text-muted'}`}>
        {title}
        <span className="rounded-full bg-surface-2 px-1.5 text-[11px] text-faint">{count}</span>
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center text-muted">
      <span className="grid size-14 place-items-center rounded-2xl bg-gemini-soft">
        <Inbox className="size-6 text-blue dark:text-sky" />
      </span>
      <p className="text-sm">{text}</p>
    </div>
  );
}

function AllView({
  tasks,
  showDone,
  setShowDone,
  onOpen,
}: {
  tasks: Task[];
  showDone: boolean;
  setShowDone(v: boolean): void;
  onOpen(t: Task): void;
}) {
  const active = tasks.filter((t) => !t.done).sort(byPriorityThenDate);
  const done = tasks.filter((t) => t.done).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  if (!tasks.length) return <Empty text="Задач пока нет. Добавьте первую выше или попросите AI." />;

  return (
    <>
      <Section title="Активные" count={active.length}>
        {active.length ? active.map((t) => <TaskItem key={t.id} task={t} onOpen={onOpen} />) : <p className="px-1 text-sm text-muted">Все задачи выполнены ✨</p>}
      </Section>
      {done.length > 0 && (
        <section className="mt-5">
          <button
            type="button"
            onClick={() => {
              haptic.selection();
              setShowDone(!showDone);
            }}
            className="mb-2 flex w-full items-center gap-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted"
          >
            Выполненные
            <span className="rounded-full bg-surface-2 px-1.5 text-[11px] text-faint">{done.length}</span>
            <ChevronDown className={`ml-auto size-4 transition-transform ${showDone ? 'rotate-180' : ''}`} />
          </button>
          {showDone && (
            <div className="animate-fade-up flex flex-col gap-2">
              {done.map((t) => (
                <TaskItem key={t.id} task={t} onOpen={onOpen} />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function DatedView({
  tasks,
  day,
  setDay,
  onOpen,
}: {
  tasks: Task[];
  day: DateKey | null;
  setDay(d: DateKey | null): void;
  onOpen(t: Task): void;
}) {
  const today = todayKey();
  const tomorrow = addDays(today, 1);
  const strip = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const counts = new Map<DateKey, number>();
  tasks.forEach((t) => t.date && !t.done && counts.set(t.date, (counts.get(t.date) ?? 0) + 1));

  const dated = tasks.filter((t) => t.date).sort(byDateThenTime);

  return (
    <>
      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        <button
          type="button"
          onClick={() => setDay(null)}
          className={`flex h-[60px] shrink-0 flex-col items-center justify-center rounded-2xl px-3 text-[13px] font-semibold transition-colors ${
            day === null ? 'bg-gemini text-white' : 'border border-line bg-surface text-muted'
          }`}
        >
          Все
        </button>
        {strip.map((d) => {
          const active = day === d;
          const n = counts.get(d) ?? 0;
          return (
            <button
              key={d}
              type="button"
              onClick={() => {
                haptic.selection();
                setDay(active ? null : d);
              }}
              className={`relative flex h-[60px] w-11 shrink-0 flex-col items-center justify-center rounded-2xl transition-colors ${
                active ? 'bg-fg text-bg' : 'border border-line bg-surface'
              }`}
            >
              <span className={`text-[10px] font-semibold uppercase ${active ? 'opacity-70' : 'text-muted'}`}>
                {WEEKDAYS_SHORT[weekdayMon(fromKey(d))]}
              </span>
              <span className={`text-[17px] font-semibold ${d === today && !active ? 'text-red' : ''}`}>{fromKey(d).getDate()}</span>
              {n > 0 && <span className={`absolute bottom-1.5 size-1 rounded-full ${active ? 'bg-bg' : 'bg-blue dark:bg-sky'}`} />}
            </button>
          );
        })}
      </div>

      {day ? (
        (() => {
          const list = dated.filter((t) => t.date === day);
          return list.length ? (
            <Section title={humanDate(day)} count={list.length}>
              {list.map((t) => (
                <TaskItem key={t.id} task={t} showDate={false} onOpen={onOpen} />
              ))}
            </Section>
          ) : (
            <Empty text={`На ${humanDate(day).toLowerCase()} задач нет`} />
          );
        })()
      ) : (
        (() => {
          const groups: { title: string; items: Task[]; tone?: 'red'; showDate?: boolean }[] = [
            { title: 'Просрочено', items: dated.filter((t) => t.date! < today && !t.done), tone: 'red', showDate: true },
            { title: 'Сегодня', items: dated.filter((t) => t.date === today) },
            { title: 'Завтра', items: dated.filter((t) => t.date === tomorrow) },
            { title: 'Предстоящие', items: dated.filter((t) => t.date! > tomorrow), showDate: true },
          ];
          const visible = groups.filter((g) => g.items.length);
          if (!visible.length) return <Empty text="Нет задач с датой. Выберите дату при создании задачи." />;
          return visible.map((g) => (
            <Section key={g.title} title={g.title} count={g.items.length} tone={g.tone}>
              {g.items.map((t) => (
                <TaskItem key={t.id} task={t} showDate={g.showDate ?? false} onOpen={onOpen} />
              ))}
            </Section>
          ));
        })()
      )}
    </>
  );
}
