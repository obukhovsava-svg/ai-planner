import type { TabId } from '@/types';
import { TabBar } from '@/components/TabBar';
import { Toast } from '@/components/Toast';
import { useUIStore } from '@/store/useUIStore';
import { CalendarTab } from '@/features/calendar/CalendarTab';
import { AssistantTab } from '@/features/assistant/AssistantTab';
import { TasksTab } from '@/features/tasks/TasksTab';

const SCREENS: Record<TabId, () => React.JSX.Element> = {
  calendar: CalendarTab,
  assistant: AssistantTab,
  tasks: TasksTab,
};

export default function App() {
  const tab = useUIStore((s) => s.tab);
  const Screen = SCREENS[tab];

  return (
    <div className="app-height relative mx-auto flex max-w-md flex-col overflow-hidden bg-bg">
      <main key={tab} className="animate-fade-in min-h-0 flex-1">
        <Screen />
      </main>
      <Toast />
      <TabBar />
    </div>
  );
}
