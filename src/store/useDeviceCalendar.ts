/**
 * Meetings from the device's own calendars (Outlook, iCloud, Google added to the iPhone or Mac).
 * The app reads them with EventKit and they become ordinary planner events: on the server, in the
 * widget, known to the assistant, with the calendar's description as the note. One way only: a change
 * in the calendar overwrites the copy here; what's edited here stays until the meeting changes there.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CalendarEvent } from '@/types';
import { isNative, postNative } from '@/lib/native';
import { storage, uid } from '@/lib/storage';
import { usePlannerStore } from './usePlannerStore';

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
  /** This installation: each device removes only the meetings it brought in itself. */
  owner: string;
}

export const useDeviceCalendar = create<DeviceCalendarState>()(
  persist((): DeviceCalendarState => ({ on: false, hidden: [], denied: false, calendars: [], owner: uid() }), {
    name: 'planner:device-calendar',
    storage,
  }),
);

/** After switching a calendar on, meetings removed by switching it off come back. */
let revive = false;

const ask = (prompt: boolean) => postNative({ type: 'calendar', prompt, hidden: useDeviceCalendar.getState().hidden });

export function enableDeviceCalendar() {
  useDeviceCalendar.setState({ on: true, denied: false });
  revive = true;
  ask(true);
}

export function disableDeviceCalendar() {
  useDeviceCalendar.setState({ on: false, denied: false, calendars: [] });
  usePlannerStore.getState().reconcileDevice([], useDeviceCalendar.getState().owner, false);
}

export function toggleDeviceCalendar(id: string, shown: boolean) {
  const { hidden } = useDeviceCalendar.getState();
  useDeviceCalendar.setState({ hidden: shown ? hidden.filter((x) => x !== id) : [...hidden, id] });
  revive = shown;
  ask(false);
}

/** Answers from the app, and re-reading whenever the calendars change or the app comes back. */
export function installDeviceCalendar() {
  if (!isNative()) return;
  window.__plannerCalendar = (e) => {
    const { on, owner } = useDeviceCalendar.getState();
    if (!on) return;
    if (!e.granted) return useDeviceCalendar.setState({ denied: true, calendars: [] });
    useDeviceCalendar.setState({ denied: false, calendars: e.calendars });
    usePlannerStore.getState().reconcileDevice(e.events as CalendarEvent[], owner, revive);
    revive = false;
  };
  const refresh = () => {
    if (useDeviceCalendar.getState().on && document.visibilityState === 'visible') ask(false);
  };
  window.__plannerCalendarChanged = refresh;
  document.addEventListener('visibilitychange', refresh);
  refresh();
}
