import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DateKey, TabId, ThemeMode } from '@/types';
import { STORAGE_KEYS, storage } from '@/lib/storage';
import { todayKey } from '@/lib/date';

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

  selectedDate: DateKey;
  setSelectedDate(date: DateKey): void;
  calendarView: 'month' | 'week';
  setCalendarView(view: 'month' | 'week'): void;

  tasksMode: 'all' | 'dated';
  setTasksMode(mode: 'all' | 'dated'): void;

  toast: Toast | null;
  showToast(message: string, action?: Toast['action']): void;
  hideToast(): void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      tab: 'calendar',
      setTab: (tab) => set({ tab }),

      themeOverride: null,
      setThemeOverride: (themeOverride) => set({ themeOverride }),

      selectedDate: todayKey(),
      setSelectedDate: (selectedDate) => set({ selectedDate }),
      calendarView: 'month',
      setCalendarView: (calendarView) => set({ calendarView }),

      tasksMode: 'all',
      setTasksMode: (tasksMode) => set({ tasksMode }),

      toast: null,
      showToast: (message, action) => set({ toast: { id: Date.now(), message, action } }),
      hideToast: () => set({ toast: null }),
    }),
    {
      name: STORAGE_KEYS.ui,
      storage,
      // Only durable preferences — the app always opens on today's date.
      partialize: (s) => ({
        themeOverride: s.themeOverride,
        calendarView: s.calendarView,
        tasksMode: s.tasksMode,
      }),
    },
  ),
);
