/**
 * Meetings from the device's own calendars (Outlook, iCloud, Google added to the iPhone or Mac), kept
 * in step both ways: the app reads them with EventKit and they become ordinary planner events (on the
 * server, in the widget, known to the assistant, the description as the note); a move, edit or delete
 * in the planner, from any device, is written back by the device that has the calendar.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isNative, postNative } from '@/lib/native';
import { storage, uid } from '@/lib/storage';
import { cleanMeetingNote } from '@/lib/meetingNote';
import { usePlannerStore, type DeviceItem } from './usePlannerStore';
import { useUIStore } from './useUIStore';

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

/** The description comes down to the point of the meeting and the link to join. */
function prepare({ url, ...item }: DeviceItem & { url?: string }): DeviceItem {
  const note = cleanMeetingNote(item.note, [url, item.device?.location]);
  return { ...item, note, device: { ...item.device!, noteCut: item.device?.noteCut || (item.note ?? '').trim() !== (note ?? '') } };
}

/** After switching a calendar on, meetings removed by switching it off come back. */
let revive = false;

const ask = (prompt: boolean, ops?: unknown[]) => postNative({ type: 'calendar', prompt, hidden: useDeviceCalendar.getState().hidden, ops });

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
    const { ops, reverted, waiting } = usePlannerStore.getState().reconcileDevice((e.events as DeviceItem[]).map(prepare), owner, revive);
    revive = false;
    if (reverted) useUIStore.getState().showToast('Эту встречу изменить нельзя: её может менять только организатор');
    if (ops.length) ask(false, ops);
    if (waiting) window.setTimeout(refresh, 9000);
  };
  const refresh = () => {
    if (useDeviceCalendar.getState().on && document.visibilityState === 'visible') ask(false);
  };
  window.__plannerCalendarChanged = refresh;
  // Something changed in the planner (here or on another device) → carry it to the calendar.
  let timer = 0;
  usePlannerStore.subscribe((now, before) => {
    if (now.events === before.events && now.deleted === before.deleted) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(refresh, 1500);
  });
  document.addEventListener('visibilitychange', refresh);
  refresh();
}
