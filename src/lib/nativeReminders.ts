/**
 * iOS app: reminders are local notifications scheduled on the device by the app (they arrive
 * as the app's own notifications, even offline). Whenever the planner changes we hand the app
 * the upcoming moments; it keeps the soonest 60 scheduled (iOS allows 64 pending).
 */
import { useEffect } from 'react';
import { usePlannerStore } from '@/store/usePlannerStore';
import { reminderInstances } from './reminderCore';
import { todayKey } from './date';
import { isNative, postNative } from './native';

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
    const onVisible = () => document.visibilityState === 'visible' && push();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsub();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
