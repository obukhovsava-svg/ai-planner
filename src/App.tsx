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
import { useWallpaperSync } from '@/lib/wallpaper';
import { CalendarTab } from '@/features/calendar/CalendarTab';
import { AssistantTab } from '@/features/assistant/AssistantTab';
import { TasksTab } from '@/features/tasks/TasksTab';
import { DigestPrompt, SettingsSheet } from '@/features/settings/SettingsSheet';
import { NextStepSheet } from '@/features/onboarding/NextStepSheet';
import { AiConsentSheet } from '@/features/settings/Privacy';
import { ShortcutSheet } from '@/features/assistant/ShortcutSheet';
import { usePlannerStore } from '@/store/usePlannerStore';
import { SidePane, useWide } from '@/hooks/useWide';

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
  const wide = useWide();
  // Wide layout: the tasks column's width (dragged by the divider, remembered on this device)
  const [sideW, setSideWState] = useState(readSideWidth);
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
  useWallpaperSync();
  // Nothing planned yet → start in the assistant with examples, not on an empty calendar
  // (most people who leave never add a single item). A deep link wins.
  useEffect(() => {
    const p = usePlannerStore.getState(), ui = useUIStore.getState();
    if (!p.tasks.length && !p.events.length && ui.tab === 'calendar' && !ui.dayOpen) setTab('assistant');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
    // `wide`: the phone layout's shell only exists when narrow — re-attach after a resize
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setTab, wide],
  );
  useTabSwipe(shell, onSwipe);

  const overlays = (
    <>
      <Toast />
      <SettingsSheet />
      <DigestPrompt />
      <ShortcutSheet open={shortcutOpen} onClose={() => setShortcutOpen(false)} />
      <NextStepSheet />
      <AiConsentSheet />
    </>
  );

  // Mac / desktop: the calendar (two thirds) and tasks side by side; the assistant is its own tab,
  // switched at the top. Both stay mounted, so a chat or a scrolled month survives the switch.
  if (wide) {
    const chat = tab === 'assistant';
    const setSideW = (w: number) => {
      setSideWState(w);
      try {
        localStorage.setItem(SIDE_KEY, String(Math.round(w)));
      } catch {
        /* private mode: just not remembered */
      }
    };
    return (
      <div className="app-height flex flex-col overflow-hidden bg-bg">
        <DeskTabs chat={chat} onChange={(c) => setTab(c ? 'assistant' : 'calendar')} />
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0 flex" style={{ visibility: chat ? 'hidden' : 'visible' }} inert={chat} aria-hidden={chat}>
            <main className="relative min-w-0 flex-1">
              <CalendarTab />
            </main>
            <Splitter width={sideW} onChange={setSideW} />
            <SidePane.Provider value>
              <main className="relative shrink-0" style={{ width: sideW }}>
                <TasksTab />
              </main>
            </SidePane.Provider>
          </div>
          <SidePane.Provider value>
            <main
              className="absolute inset-0 mx-auto max-w-[760px]"
              style={{ visibility: chat ? 'visible' : 'hidden' }}
              inert={!chat}
              aria-hidden={!chat}
            >
              <AssistantTab />
            </main>
          </SidePane.Provider>
        </div>
        {overlays}
      </div>
    );
  }

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
      <TabBar />
      {overlays}
    </div>
  );
}

/** The wide layout's switch between the planner and the assistant (a segmented control). */
function DeskTabs({ chat, onChange }: { chat: boolean; onChange(chat: boolean): void }) {
  // ⌘1 / ⌘2, like switching tabs in any Mac app
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key !== '1' && e.key !== '2')) return;
      e.preventDefault();
      onChange(e.key === '2');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChange]);
  const items = [
    { on: !chat, label: 'Планер', go: false },
    { on: chat, label: 'Ассистент', go: true },
  ];
  return (
    <nav aria-label="Разделы" className="flex shrink-0 justify-center border-b-[0.5px] border-line py-2">
      <div className="relative grid grid-cols-2 rounded-full bg-surface-2 p-[3px]">
        <span
          aria-hidden
          className="absolute inset-y-[3px] left-[3px] w-[calc(50%-3px)] rounded-full bg-surface shadow-[0_1px_4px_rgb(0_0_0/0.18)] transition-transform duration-300 ease-spring"
          style={{ transform: chat ? 'translateX(100%)' : 'none' }}
        />
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            aria-current={it.on ? 'page' : undefined}
            onClick={() => onChange(it.go)}
            className={`relative z-[1] w-[130px] rounded-full py-[5px] text-[13px] font-semibold transition-colors ${it.on ? 'text-fg' : 'text-muted hover:text-fg'}`}
          >
            {it.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

const SIDE_KEY = 'planner:sideWidth';
const SIDE_MIN = 300;
/** Default: a third of the window, as the calendar takes the other two. */
function readSideWidth(): number {
  try {
    const v = Number(localStorage.getItem(SIDE_KEY));
    if (v >= SIDE_MIN) return v;
  } catch {
    /* no storage */
  }
  return Math.max(SIDE_MIN, Math.round(window.innerWidth / 3));
}

/** Draggable border between the calendar and the tasks; double-click goes back to a third. */
function Splitter({ width, onChange }: { width: number; onChange(w: number): void }) {
  const clamp = (w: number) => Math.min(Math.max(w, SIDE_MIN), Math.max(SIDE_MIN, window.innerWidth - 480));
  // the window got narrower: keep the calendar usable
  useEffect(() => {
    const fit = () => {
      const w = clamp(width);
      if (w !== width) onChange(w);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Ширина колонки задач"
      title="Потяните, чтобы изменить ширину"
      className="group relative z-10 w-px shrink-0 cursor-col-resize bg-line"
      onDoubleClick={() => onChange(clamp(Math.round(window.innerWidth / 3)))}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const startX = e.clientX, startW = width;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        document.documentElement.style.cursor = 'col-resize';
        const move = (ev: PointerEvent) => onChange(clamp(startW - (ev.clientX - startX)));
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          document.documentElement.style.cursor = '';
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
    >
      {/* wider invisible grip, highlighted on hover */}
      <span className="absolute inset-y-0 -left-[4px] w-[9px] transition-colors group-hover:bg-blue/30" />
    </div>
  );
}
