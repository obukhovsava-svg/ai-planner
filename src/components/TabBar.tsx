import { ListChecks } from 'lucide-react';
import type { TabId } from '@/types';
import { useUIStore } from '@/store/useUIStore';
import { haptic } from '@/lib/telegram';

/** Calendar glyph that shows today's day number, like the iOS Calendar icon. */
function CalendarDayIcon({ active }: { active: boolean }) {
  const day = new Date().getDate();
  const w = active ? 2 : 1.7;
  return (
    <svg viewBox="0 0 24 24" className="size-[27px]" aria-hidden>
      <rect x="3" y="4.5" width="18" height="16.5" rx="4" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.14 : 0} stroke="currentColor" strokeWidth={w} />
      <path d="M8 3v3M16 3v3" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
      <text x="12" y="17.6" textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor" fontFamily="inherit">
        {day}
      </text>
    </svg>
  );
}

/** Four-point sparkle; filled with the AI gradient when active. */
function SparkleIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[27px]" aria-hidden>
      <defs>
        <linearGradient id="ai-tab" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--ai-1)" />
          <stop offset="0.5" stopColor="var(--ai-2)" />
          <stop offset="1" stopColor="var(--ai-3)" />
        </linearGradient>
      </defs>
      <path
        d="M12 2.5c.5 4.6 2.9 7 9.5 9.5-6.6 2.5-9 4.9-9.5 9.5-.5-4.6-2.9-7-9.5-9.5 6.6-2.5 9-4.9 9.5-9.5Z"
        fill={active ? 'url(#ai-tab)' : 'none'}
        stroke={active ? 'none' : 'currentColor'}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <circle cx="19" cy="5" r="1.6" fill={active ? 'var(--ai-3)' : 'currentColor'} />
    </svg>
  );
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'calendar', label: 'План' },
  { id: 'assistant', label: 'Ассистент' },
  { id: 'tasks', label: 'Задачи' },
];

export function TabBar() {
  const tab = useUIStore((s) => s.tab);
  const setTab = useUIStore((s) => s.setTab);
  const goCalendarHome = useUIStore((s) => s.goCalendarHome);

  return (
    <nav
      aria-label="Основная навигация"
      className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t-[0.5px] border-line bg-[var(--tabbar)] backdrop-blur-xl backdrop-saturate-200"
    >
      <ul className="mx-auto grid h-[var(--tabbar-h)] max-w-md grid-cols-3 items-center">
        {TABS.map(({ id, label }) => {
          const active = tab === id;
          return (
            <li key={id} className="flex justify-center">
              <button
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  // The calendar icon always brings the calendar back to today's month,
                  // like re-tapping a tab in iOS.
                  if (id === 'calendar') goCalendarHome();
                  if (id === tab && id !== 'calendar') return;
                  haptic.impact('light');
                  setTab(id);
                }}
                className={`flex min-w-20 flex-col items-center gap-0.5 pt-1 transition-[color,transform] duration-300 ease-spring active:scale-90 ${
                  active ? 'text-blue' : 'text-[#999] dark:text-[#757575]'
                }`}
              >
                {id === 'calendar' && <CalendarDayIcon active={active} />}
                {id === 'assistant' && <SparkleIcon active={active} />}
                {id === 'tasks' && <ListChecks className="size-[27px]" strokeWidth={active ? 2.2 : 1.7} />}
                <span className="text-[10px] font-medium tracking-[0.01em]">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
