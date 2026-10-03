/**
 * iPhone Shortcut ("Команды"): a home-screen button dictates a request and posts it to the
 * worker with a personal key; the bot confirms right away and the request is queued. The app
 * picks the queue up whenever it is open (and on start) and applies it here.
 */
import { useEffect } from 'react';
import { AI_URL } from '@/config';
import { getInitData } from './telegram';
import { toAnalyses } from './ai';
import { useChatStore } from '@/store/useChatStore';
import { useUIStore } from '@/store/useUIStore';
import { applyQueued } from '@/features/assistant/brain';

const base = () => AI_URL.replace(/\/$/, '');

export async function getShortcutLink(reset = false): Promise<{ token: string; url: string } | null> {
  const initData = getInitData();
  if (!AI_URL || !initData) return null;
  try {
    const res = await fetch(`${base()}/shortcut/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
      body: JSON.stringify({ tz: new Date().getTimezoneOffset(), reset }),
    });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

let busy = false;

async function pull() {
  const initData = getInitData();
  if (busy || !AI_URL || !initData || document.visibilityState !== 'visible') return;
  busy = true;
  try {
    const res = await fetch(`${base()}/shortcut/pull`, { method: 'POST', headers: { 'X-Telegram-Init-Data': initData } });
    if (!res.ok) return;
    const { items } = (await res.json()) as { items: { text: string; actions: unknown }[] };
    const chat = useChatStore.getState();
    for (const item of items) {
      chat.push({ role: 'user', text: `🎙 ${item.text}` });
      const actions = item.actions ? toAnalyses(item.actions) : null;
      for (const reply of await applyQueued(item.text, actions)) chat.push({ role: 'assistant', ...reply });
    }
    if (items.length) useUIStore.getState().showToast(items.length === 1 ? 'Добавлено из команды iPhone' : `Добавлено из команды iPhone: ${items.length}`);
  } catch {
    /* offline — next tick retries */
  } finally {
    busy = false;
  }
}

/** Applies Shortcut requests on start, when the app comes back to the foreground and every 20 s. */
export function useShortcutInbox() {
  useEffect(() => {
    pull();
    const onVisible = () => document.visibilityState === 'visible' && pull();
    document.addEventListener('visibilitychange', onVisible);
    const t = window.setInterval(pull, 20_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(t);
    };
  }, []);
}
