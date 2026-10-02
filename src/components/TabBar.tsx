import { ListChecks, Sparkles } from 'lucide-react';
import type { TabId } from '@/types';
import { useUIStore } from '@/store/useUIStore';
import { haptic } from '@/lib/telegram';

/** Calendar glyph that shows today's day number, like the iOS Calendar icon. */
function CalendarDayIcon({ active }: { active: boolean }) {
  const day = new Date().getDate();
  return (
    <svg viewBox="0 0 24 24" className="size-[26px]" aria-hidden>
      <rect x="3" y="4.5" width="18" height="16.5" rx="4" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} />
      <path d="M3 9.5h18" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} />
      <path d="M8 3v3M16 3v3" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" />
      <text x="12" y="18.2" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor" fontFamily="inherit">
        {day}
      </text>
    </svg>
  );
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'calendar', label: 'План' },
  { id: 'assistant', label: 'AI' },
  { id: 'tasks', label: 'Задачи' },
];

export function TabBar() {
  const tab = useUIStore((s) => s.tab);
  const setTab = useUIStore((s) => s.setTab);

  const select = (id: TabId) => {
    if (id !== tab) {
      haptic.impact('light');
      setTab(id);
    }
  };

  return (
    <nav
      aria-label="Основная навигация"
      className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[var(--tabbar)] backdrop-blur-md backdrop-saturate-150"
    >
      <ul className="mx-auto grid h-[var(--tabbar-h)] max-w-md grid-cols-3 items-center">
        {TABS.map(({ id, label }) => {
          const active = tab === id;
          if (id === 'assistant') {
            return (
              <li key={id} className="flex justify-center">
                <button
                  type="button"
                  aria-label="AI ассистент"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => select(id)}
                  className="group relative -mt-7 flex flex-col items-center gap-1"
                >
                  <span
                    className={`absolute top-0 size-14 rounded-full bg-gemini blur-lg transition-opacity duration-300 ${
                      active ? 'opacity-70' : 'opacity-30'
                    }`}
                  />
                  <span
                    className={`relative grid size-14 place-items-center rounded-full bg-gemini text-white shadow-lg ring-4 ring-bg transition-transform duration-200 group-active:scale-90 ${
                      active ? 'scale-105' : ''
                    }`}
                  >
                    <Sparkles className={`size-6 ${active ? 'animate-spin-slow' : ''}`} strokeWidth={2.2} />
                  </span>
                  <span className={`text-[10px] font-semibold ${active ? 'text-gemini' : 'text-muted'}`}>{label}</span>
                </button>
              </li>
            );
          }
          return (
            <li key={id} className="flex justify-center">
              <button
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => select(id)}
                className={`flex min-w-16 flex-col items-center gap-0.5 rounded-xl px-3 py-1 transition-colors active:scale-95 ${
                  active ? 'text-blue dark:text-sky' : 'text-faint'
                }`}
              >
                {id === 'calendar' ? (
                  <CalendarDayIcon active={active} />
                ) : (
                  <ListChecks className="size-[26px]" strokeWidth={active ? 2.2 : 1.8} />
                )}
                <span className="text-[10px] font-semibold">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
