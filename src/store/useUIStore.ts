import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DateKey, TabId, ThemeMode } from '@/types';
import { STORAGE_KEYS, storage } from '@/lib/storage';
import { todayKey } from '@/lib/date';
import type { AccentId } from '@/lib/accent';

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

interface UIState {
  tab: TabId;
  setTab(tab: TabId): void;

  /** null = follow Telegram / system; otherwise manual override. */
  themeOverride: ThemeMode | null;
  setThemeOverride(mode: ThemeMode | null): void;
  /** Accent colour of buttons, the active tab and the assistant's gradient. */
  accent: AccentId;
  setAccent(accent: AccentId): void;

  selectedDate: DateKey;
  setSelectedDate(date: DateKey): void;
  /** Calendar day screen (pushed over the month view). */
  dayOpen: boolean;
  setDayOpen(open: boolean): void;
  /** Bumped when the calendar should return to its home state (today, current month). */
  calendarHome: number;
  goCalendarHome(): void;
  /** Open this item's editor once (deep link from a reminder). */
  focus: { kind: 'event' | 'task'; id: string; date?: DateKey } | null;
  setFocus(focus: UIState['focus']): void;

  toast: Toast | null;
  showToast(message: string, action?: Toast['action']): void;
  hideToast(): void;

  settingsOpen: boolean;
  setSettingsOpen(open: boolean): void;
  shortcutOpen: boolean;
  setShortcutOpen(open: boolean): void;
  /** The lock-screen wallpaper sheet (from Settings or the "next step" offer). */
  wallpaperOpen: boolean;
  setWallpaperOpen(open: boolean): void;
  /** Completed tasks leave the list the next day (otherwise they stay until deleted). */
  hideDoneNextDay: boolean;
  setHideDoneNextDay(v: boolean): void;
  /** The one-time "send me a morning summary?" card was answered. */
  digestPrompted: boolean;
  setDigestPrompted(v: boolean): void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      tab: 'calendar',
      setTab: (tab) => set({ tab }),

      themeOverride: null,
      setThemeOverride: (themeOverride) => set({ themeOverride }),
      accent: 'blue',
      setAccent: (accent) => set({ accent }),

      selectedDate: todayKey(),
      setSelectedDate: (selectedDate) => set({ selectedDate }),
      dayOpen: false,
      setDayOpen: (dayOpen) => set({ dayOpen }),
      focus: null,
      setFocus: (focus) => set({ focus }),
      calendarHome: 0,
      goCalendarHome: () => set((s) => ({ dayOpen: false, selectedDate: todayKey(), calendarHome: s.calendarHome + 1 })),

      toast: null,
      showToast: (message, action) => set({ toast: { id: Date.now(), message, action } }),
      hideToast: () => set({ toast: null }),

      settingsOpen: false,
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      shortcutOpen: false,
      setShortcutOpen: (shortcutOpen) => set({ shortcutOpen }),
      wallpaperOpen: false,
      setWallpaperOpen: (wallpaperOpen) => set({ wallpaperOpen }),
      hideDoneNextDay: true,
      setHideDoneNextDay: (hideDoneNextDay) => set({ hideDoneNextDay }),
      digestPrompted: false,
      setDigestPrompted: (digestPrompted) => set({ digestPrompted }),
    }),
    {
      name: STORAGE_KEYS.ui,
      storage,
      // Only durable preferences — the app always opens on today's date.
      partialize: (s) => ({
        themeOverride: s.themeOverride,
        accent: s.accent,
        hideDoneNextDay: s.hideDoneNextDay,
        digestPrompted: s.digestPrompted,
      }),
    },
  ),
);
