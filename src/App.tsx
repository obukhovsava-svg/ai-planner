import { useCallback, useEffect, useRef } from 'react';
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
  const Screen = SCREENS[tab];
  // Listeners live on the stable outer box (<main> is re-created on every tab change).
  const shell = useRef<HTMLDivElement>(null);
  const prev = useRef<TabId>(tab);
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

  // Slide the new screen in from the side it is on.
  const dir = TAB_ORDER.indexOf(tab) - TAB_ORDER.indexOf(prev.current);
  prev.current = tab;
  const enter = dir > 0 ? 'animate-slide-right' : dir < 0 ? 'animate-slide-left' : 'animate-fade-in';

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
      <main key={tab} className={`${enter} min-h-0 flex-1`}>
        <Screen />
      </main>
      <Toast />
      <TabBar />
      <SettingsSheet />
      <DigestPrompt />
      <ShortcutSheet open={shortcutOpen} onClose={() => setShortcutOpen(false)} />
    </div>
  );
}
