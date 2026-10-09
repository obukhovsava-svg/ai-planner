import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TabId } from '@/types';
import { TabBar } from '@/components/TabBar';
import { Toast } from '@/components/Toast';
import { useUIStore } from '@/store/useUIStore';
import { haptic } from '@/lib/telegram';
import { useTabSwipe } from '@/hooks/useTabSwipe';
import { useServerSync } from '@/lib/sync';
import { useShortcutInbox } from '@/lib/shortcut';
import { useNativeReminders } from '@/lib/nativeReminders';
import { useOverdueCleanup } from '@/lib/overdueCleanup';
import { CalendarTab } from '@/features/calendar/CalendarTab';
import { AssistantTab } from '@/features/assistant/AssistantTab';
import { TasksTab } from '@/features/tasks/TasksTab';
import { DigestPrompt, SettingsSheet } from '@/features/settings/SettingsSheet';
import { ShortcutSheet } from '@/features/assistant/ShortcutSheet';
import { usePlannerStore } from '@/store/usePlannerStore';

/** Completed tasks older than this are removed for good (they've long left the list). */
const KEEP_DONE_DAYS = 30;

export const TAB_ORDER: TabId[] = ['calendar', 'assistant', 'tasks'];

const SCREENS: Record<TabId, () => React.JSX.Element> = {
  calendar: CalendarTab,
  assistant: AssistantTab,
  tasks: TasksTab,
};

export default function App() {
  const tab = useUIStore((s) => s.tab);
  const setTab = useUIStore((s) => s.setTab);
  // Listeners live on the stable outer box.
  const shell = useRef<HTMLDivElement>(null);
  const prev = useRef<TabId>(tab);
  // Screens are built once and then only shown / hidden — switching never rebuilds a whole tab
  // (that was a 250–400 ms freeze on a phone). The others are built in the background after start.
  const [built, setBuilt] = useState<TabId[]>([tab]);
  const panes = useRef<Partial<Record<TabId, HTMLElement | null>>>({});
  useEffect(() => {
    if (!built.includes(tab)) setBuilt((b) => [...b, tab]);
  }, [tab, built]);
  useEffect(() => {
    const t = window.setTimeout(() => setBuilt([...TAB_ORDER]), 1200);
    return () => window.clearTimeout(t);
  }, []);
  // Data lives on the server too: two-way sync (reminders are computed there).
  useServerSync();
  useShortcutInbox();
  // iOS app: reminders become the app's own local notifications.
  useNativeReminders();
  useOverdueCleanup();
  const shortcutOpen = useUIStore((s) => s.shortcutOpen);
  const setShortcutOpen = useUIStore((s) => s.setShortcutOpen);

  // Housekeeping: completed tasks from a month ago go away for good.
  useEffect(() => {
    const p = usePlannerStore.getState();
    const cutoff = Date.now() - KEEP_DONE_DAYS * 86_400_000;
    for (const t of p.tasks) if (t.done && (t.completedAt ?? t.createdAt) < cutoff) p.deleteTask(t.id);
  }, []);

  // Slide the new screen in from the side it is on (compositor-only: transform + opacity).
  useLayoutEffect(() => {
    const dir = TAB_ORDER.indexOf(tab) - TAB_ORDER.indexOf(prev.current);
    prev.current = tab;
    if (!dir) return;
    panes.current[tab]?.animate(
      [
        { transform: `translateX(${dir > 0 ? 40 : -40}px)`, opacity: 0.4 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 450, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
    );
  }, [tab]);

  const onSwipe = useCallback(
    (d: 'left' | 'right') => {
      const { tab: current, dayOpen } = useUIStore.getState();
      if (current === 'calendar' && dayOpen) return;
      const next = TAB_ORDER[TAB_ORDER.indexOf(current) + (d === 'left' ? 1 : -1)];
      if (!next) return;
      haptic.impact('light');
      setTab(next);
    },
    [setTab],
  );
  useTabSwipe(shell, onSwipe);

  return (
    <div ref={shell} className="app-height relative mx-auto flex max-w-md flex-col overflow-hidden bg-bg">
      <div className="relative min-h-0 flex-1">
        {TAB_ORDER.filter((t) => built.includes(t) || t === tab).map((t) => {
          const Screen = SCREENS[t];
          const on = t === tab;
          return (
            <main
              key={t}
              ref={(el) => {
                panes.current[t] = el;
              }}
              aria-hidden={!on}
              inert={!on}
              className="absolute inset-0"
              style={{ visibility: on ? 'visible' : 'hidden', contentVisibility: on ? 'visible' : 'hidden', zIndex: on ? 1 : 0 }}
            >
              <Screen />
            </main>
          );
        })}
      </div>
      <Toast />
      <TabBar />
      <SettingsSheet />
      <DigestPrompt />
      <ShortcutSheet open={shortcutOpen} onClose={() => setShortcutOpen(false)} />
    </div>
  );
}
