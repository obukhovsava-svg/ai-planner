import { useCallback, useRef } from 'react';
import type { TabId } from '@/types';
import { TabBar } from '@/components/TabBar';
import { Toast } from '@/components/Toast';
import { useUIStore } from '@/store/useUIStore';
import { haptic } from '@/lib/telegram';
import { useTabSwipe } from '@/hooks/useTabSwipe';
import { useReminderSync } from '@/lib/reminders';
import { CalendarTab } from '@/features/calendar/CalendarTab';
import { AssistantTab } from '@/features/assistant/AssistantTab';
import { TasksTab } from '@/features/tasks/TasksTab';

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
  useReminderSync();

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
    </div>
  );
}
