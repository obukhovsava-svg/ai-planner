/**
 * Meetings from the device's own calendars (Outlook, iCloud, Google added to the iPhone or Mac).
 * The app reads them with EventKit; they are shown next to the planner's events, read-only, and
 * stay on the device: kept apart from the planner store, so they never reach the server.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CalendarEvent } from '@/types';
import { isNative, postNative } from '@/lib/native';
import { storage } from '@/lib/storage';

export interface DeviceCalendarInfo {
  id: string;
  title: string;
  source: string;
}

interface DeviceCalendarState {
  on: boolean;
  /** Calendars switched off by the user. */
  hidden: string[];
  denied: boolean;
  calendars: DeviceCalendarInfo[];
  events: CalendarEvent[];
}

export const useDeviceCalendar = create<DeviceCalendarState>()(
  persist((): DeviceCalendarState => ({ on: false, hidden: [], denied: false, calendars: [], events: [] }), {
    name: 'planner:device-calendar',
    storage,
  }),
);

const ask = (prompt: boolean) => postNative({ type: 'calendar', prompt, hidden: useDeviceCalendar.getState().hidden });

export function enableDeviceCalendar() {
  useDeviceCalendar.setState({ on: true, denied: false });
  ask(true);
}

export function disableDeviceCalendar() {
  useDeviceCalendar.setState({ on: false, denied: false, calendars: [], events: [] });
}

export function toggleDeviceCalendar(id: string, shown: boolean) {
  const { hidden } = useDeviceCalendar.getState();
  useDeviceCalendar.setState({ hidden: shown ? hidden.filter((x) => x !== id) : [...hidden, id] });
  ask(false);
}

/** Answers from the app, and re-reading whenever the calendars change or the app comes back. */
export function installDeviceCalendar() {
  if (!isNative()) return;
  window.__plannerCalendar = (e) => {
    if (!useDeviceCalendar.getState().on) return;
    useDeviceCalendar.setState(e.granted ? { denied: false, calendars: e.calendars, events: e.events as CalendarEvent[] } : { denied: true, calendars: [], events: [] });
  };
  const refresh = () => {
    if (useDeviceCalendar.getState().on && document.visibilityState === 'visible') ask(false);
  };
  window.__plannerCalendarChanged = refresh;
  document.addEventListener('visibilitychange', refresh);
  refresh();
}
