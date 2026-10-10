/**
 * Two-way sync of the planner with the server (D1 via the worker).
 * The app sends its whole document; the server merges it with its copy (and with what the
 * iPhone Shortcut or other devices added), stores the result, recomputes reminders and
 * returns the merged document, which replaces the local one.
 */
import { useEffect } from 'react';
import { AI_URL } from '@/config';
import { usePlannerStore } from '@/store/usePlannerStore';
import { authHeaders, hasServerAuth } from './auth';
import type { PlannerDoc } from './merge';

let timer = 0;
let inFlight = false;
let again = false;
let applying = false;
let lastSynced = '';

const localDoc = (): PlannerDoc => {
  const { tasks, events, deleted } = usePlannerStore.getState();
  return { tasks, events, deleted };
};

export async function syncNow(leaving = false) {
  if (!hasServerAuth()) return;
  if (inFlight) {
    again = true;
    return;
  }
  inFlight = true;
  try {
    const doc = localDoc();
    const res = await fetch(`${AI_URL.replace(/\/$/, '')}/state/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ doc, tz: new Date().getTimezoneOffset() }),
      // leaving the app: let the request finish even if the page gets suspended
      keepalive: leaving,
    });
    if (!res.ok) return;
    const merged = (await res.json()).doc as PlannerDoc;
    const next = JSON.stringify(merged);
    // Only touch the store when something actually changed (and only if nothing changed meanwhile).
    if (next !== JSON.stringify(doc) && JSON.stringify(localDoc()) === JSON.stringify(doc)) {
      applying = true;
      usePlannerStore.getState().replaceAll(merged);
      applying = false;
    }
    lastSynced = next;
  } catch {
    /* offline — retried on the next change / tick */
  } finally {
    inFlight = false;
    if (again) {
      again = false;
      schedule(300);
    }
  }
}

function schedule(delay = 800) {
  window.clearTimeout(timer);
  timer = window.setTimeout(syncNow, delay);
}

/** Sync on start, after every local change, when the app returns to the foreground, and every 30 s. */
export function useServerSync() {
  useEffect(() => {
    syncNow();
    const unsub = usePlannerStore.subscribe(() => {
      if (applying) return;
      if (JSON.stringify(localDoc()) === lastSynced) return;
      schedule();
    });
    // Back in the app → pull; leaving it → push unsent changes right now (the wallpaper Shortcut
    // or Telegram may read the server copy a second later).
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncNow();
      else if (JSON.stringify(localDoc()) !== lastSynced) {
        window.clearTimeout(timer);
        syncNow(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    const tick = window.setInterval(() => document.visibilityState === 'visible' && syncNow(), 30_000);
    return () => {
      unsub();
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(tick);
    };
  }, []);
}
