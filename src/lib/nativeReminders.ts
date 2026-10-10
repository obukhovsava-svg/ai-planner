/**
 * iOS app: reminders are local notifications scheduled on the device by the app (they arrive
 * as the app's own notifications, even offline). Whenever the planner changes we hand the app
 * the upcoming moments; it keeps the soonest 60 scheduled (iOS allows 64 pending).
 * The same push refreshes the home-screen widget with the coming week.
 */
import { useEffect } from 'react';
import { usePlannerStore } from '@/store/usePlannerStore';
import { reminderInstances } from './reminderCore';
import { addDays, todayKey } from './date';
import { occursOn } from './recurrence';
import { isNative, postNative, type WidgetSnapshot } from './native';

let timer = 0;

function push() {
  const { events, tasks } = usePlannerStore.getState();
  const items = reminderInstances(events, tasks, { today: todayKey() })
    .slice(0, 60)
    .map((r) => {
      const [title, ...rest] = r.text.split('\n');
      return { id: r.rid, at: r.at, title: title.replace(/^⏰\s*/, ''), body: rest.join('\n'), open: r.rid };
    });
  postNative({ type: 'reminders', items });
  postNative({ type: 'widget', snapshot: widgetSnapshot() });
}

/** The next 7 days for the home-screen widget: events in time order, then that day's tasks. */
function widgetSnapshot(): WidgetSnapshot {
  const { events, tasks } = usePlannerStore.getState();
  const today = todayKey();
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i);
    return {
      date,
      events: events
        .filter((e) => occursOn(e, date))
        .sort((a, b) => a.start.localeCompare(b.start))
        .map((e) => ({ title: e.title, start: e.start, end: e.end, color: e.color })),
      tasks: tasks
        .filter((t) => t.date === date)
        .sort((a, b) => Number(a.done) - Number(b.done) || (a.time ?? '99').localeCompare(b.time ?? '99'))
        .map((t) => ({ title: t.title, time: t.time, done: t.done, hi: t.priority === 'high' || undefined })),
    };
  });
  const late = tasks
    .filter((t) => !t.done && t.date && t.date < today)
    .sort((a, b) => a.date!.localeCompare(b.date!))
    .map((t) => ({ title: t.title, date: t.date!, hi: t.priority === 'high' || undefined }));
  const inbox = tasks
    .filter((t) => !t.done && !t.date)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10)
    .map((t) => ({ title: t.title }));
  return { days, overdue: late.length, late: late.slice(0, 10), inbox, at: Date.now() };
}

export function useNativeReminders() {
  useEffect(() => {
    if (!isNative()) return;
    push();
    const unsub = usePlannerStore.subscribe(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(push, 800);
    });
    // Recurring items roll forward: refresh when the app comes back to the foreground.
    // Coming back: recurring items roll forward. Leaving: send what's pending right away.
    const onVisible = () => {
      window.clearTimeout(timer);
      push();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsub();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
