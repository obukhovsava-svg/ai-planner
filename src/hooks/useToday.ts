import { useSyncExternalStore } from 'react';
import { todayKey } from '@/lib/date';
import type { DateKey } from '@/types';

/**
 * Today's date that follows midnight. The app stays open for days (iOS only suspends it), so
 * screens drawn yesterday would keep yesterday as «today»: the key is checked again every minute
 * and whenever the app comes back to the screen.
 */
let current = todayKey();
const listeners = new Set<() => void>();

const check = () => {
  const now = todayKey();
  if (now === current) return;
  current = now;
  listeners.forEach((l) => l());
};

function subscribe(listener: () => void) {
  if (!listeners.size) {
    timer = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
  }
  listeners.add(listener);
  check();
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('focus', check);
  };
}
let timer = 0;

export const useToday = (): DateKey => useSyncExternalStore(subscribe, () => current);
