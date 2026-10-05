/**
 * Server-side settings: the bot's morning / evening summary, a sample on demand, feedback.
 * Everything needs Telegram (the server knows the user by initData).
 */
import { AI_URL } from '@/config';
import { getInitData } from './telegram';

export interface DigestSettings {
  morning: boolean;
  morningTime: string;
  evening: boolean;
  eveningTime: string;
}

const base = () => AI_URL.replace(/\/$/, '');

async function post<T>(path: string, body: unknown): Promise<T | null> {
  const initData = getInitData();
  if (!AI_URL || !initData) return null;
  try {
    const res = await fetch(`${base()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
      body: JSON.stringify(body),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export const serverSettingsAvailable = () => Boolean(AI_URL && getInitData());

export async function loadDigest(): Promise<DigestSettings | null> {
  return (await post<{ digest: DigestSettings }>('/settings', {}))?.digest ?? null;
}

export async function saveDigest(patch: Partial<DigestSettings>): Promise<DigestSettings | null> {
  return (await post<{ digest: DigestSettings }>('/settings', { digest: patch }))?.digest ?? null;
}

export async function sendDigestSample(kind: 'morning' | 'evening'): Promise<boolean> {
  return Boolean((await post<{ ok: boolean }>('/digest/test', { kind, tz: new Date().getTimezoneOffset() }))?.ok);
}

export async function sendFeedback(text: string): Promise<boolean> {
  return Boolean((await post<{ ok: boolean }>('/feedback', { text }))?.ok);
}

export interface CalendarFeed {
  /** Subscribe page (opens in Safari, has the «Подписаться» button). */
  page: string;
  ics: string;
  webcal: string;
  tasks: boolean;
}

/** The personal calendar subscription; `tasks` changes what it includes, `reset` issues a new link. */
export async function calendarFeed(patch: { tasks?: boolean; reset?: boolean } = {}): Promise<CalendarFeed | null> {
  return post<CalendarFeed>('/calendar', patch);
}
