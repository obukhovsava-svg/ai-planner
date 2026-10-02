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
  /** Calendar day screen (pushed over the month view). */
  dayOpen: boolean;
  setDayOpen(open: boolean): void;
  /** Bumped when the calendar should return to its home state (today, current month). */
  calendarHome: number;
  goCalendarHome(): void;

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
      dayOpen: false,
      setDayOpen: (dayOpen) => set({ dayOpen }),
      calendarHome: 0,
      goCalendarHome: () => set((s) => ({ dayOpen: false, selectedDate: todayKey(), calendarHome: s.calendarHome + 1 })),

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
      }),
    },
  ),
);
