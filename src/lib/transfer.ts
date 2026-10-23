/**
 * Moving a Telegram planner into the iPhone/Mac app: Telegram gets a one-time code, the app
 * sends it (with its device key) and the server merges the Telegram planner into the app's account.
 */
import { AI_URL } from '@/config';
import { authHeaders } from './auth';
import { syncNow } from './sync';

const base = () => AI_URL.replace(/\/$/, '');

/** Telegram: a fresh 6-digit code (valid 10 minutes). */
export async function transferCode(): Promise<string | null> {
  try {
    const res = await fetch(`${base()}/transfer/code`, { method: 'POST', headers: authHeaders() });
    return res.ok ? ((await res.json()).code as string) : null;
  } catch {
    return null;
  }
}

/** App: import by code. Returns what came over, or why not. */
export async function importFromTelegram(code: string): Promise<{ ok: true; events: number; tasks: number } | { ok: false; reason: 'bad_code' | 'rate' | 'network' }> {
  try {
    const res = await fetch(`${base()}/transfer/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ code, tz: new Date().getTimezoneOffset() }),
    });
    if (res.status === 404) return { ok: false, reason: 'bad_code' };
    if (res.status === 429) return { ok: false, reason: 'rate' };
    if (!res.ok) return { ok: false, reason: 'network' };
    const r = await res.json();
    await syncNow(); // the merged planner comes back to this device
    return { ok: true, events: r.events, tasks: r.tasks };
  } catch {
    return { ok: false, reason: 'network' };
  }
}
