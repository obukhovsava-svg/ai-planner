import { ListChecks } from 'lucide-react';
import type { TabId } from '@/types';
import { useUIStore } from '@/store/useUIStore';
import { haptic } from '@/lib/telegram';

/** Calendar glyph that shows today's day number, like the iOS Calendar icon. */
function CalendarDayIcon({ active }: { active: boolean }) {
  const day = new Date().getDate();
  const w = active ? 2 : 1.8;
  return (
    <svg viewBox="0 0 24 24" className="size-[26px]" aria-hidden>
      <rect x="3" y="4.5" width="18" height="16.5" rx="4" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.16 : 0} stroke="currentColor" strokeWidth={w} />
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
    <svg viewBox="0 0 24 24" className="size-[26px]" aria-hidden>
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
        strokeWidth={1.8}
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

/**
 * Floating "liquid glass" tab bar (iOS 26 / Telegram style): a translucent capsule with
 * a lighter pill that glides to the selected tab.
 */
export function TabBar() {
  const tab = useUIStore((s) => s.tab);
  const setTab = useUIStore((s) => s.setTab);
  const goCalendarHome = useUIStore((s) => s.goCalendarHome);
  const index = TABS.findIndex((t) => t.id === tab);

  return (
    <nav aria-label="Основная навигация" className="tabbar pb-safe pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3">
      <div className="pointer-events-auto relative mx-auto mb-2 max-w-md rounded-full border-[0.5px] border-[var(--glass-edge)] bg-[var(--tabbar)] p-[5px] shadow-[0_10px_40px_-10px_rgb(0_0_0/0.35),inset_0_1px_0_rgb(255_255_255/0.08)] backdrop-blur-2xl backdrop-saturate-200">
        {/* the gliding pill */}
        <span
          aria-hidden
          className="absolute inset-y-[5px] left-[5px] rounded-full bg-[var(--tab-pill)] shadow-[inset_0_0.5px_0_rgb(255_255_255/0.15)] transition-transform duration-500 ease-spring"
          style={{ width: 'calc((100% - 10px) / 3)', transform: `translateX(${index * 100}%)` }}
        />
        <ul className="relative grid h-[54px] grid-cols-3">
          {TABS.map(({ id, label }) => {
            const active = tab === id;
            return (
              <li key={id} className="flex">
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    // The calendar icon always brings the calendar back to today's month.
                    if (id === 'calendar') goCalendarHome();
                    if (id === tab && id !== 'calendar') return;
                    haptic.impact('light');
                    setTab(id);
                  }}
                  className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full transition-[color,transform] duration-300 ease-spring active:scale-90 ${
                    active ? 'text-blue' : 'text-fg/80'
                  }`}
                >
                  {id === 'calendar' && <CalendarDayIcon active={active} />}
                  {id === 'assistant' && <SparkleIcon active={active} />}
                  {id === 'tasks' && <ListChecks className="size-[26px]" strokeWidth={active ? 2.2 : 1.8} />}
                  <span className="text-[11px] font-semibold tracking-[0.01em]">{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
