/**
 * Persistence layer.
 *
 * All stores persist through `storage` below (the Zustand `StateStorage` shape:
 * get/set/remove by key, sync or async). Today it is LocalStorage.
 *
 * Backend integration: replace `localAdapter` with an adapter that calls your API,
 * e.g. GET/PUT `/api/state/:key` authorised with `Telegram.WebApp.initData`
 * (validate the signature server-side). Nothing else in the app needs to change.
 */
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

const localAdapter: StateStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* quota exceeded / private mode — keep working in memory */
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export const storage = createJSONStorage(() => localAdapter);

export const STORAGE_KEYS = {
  planner: 'planner:data',
  ui: 'planner:ui',
  chat: 'planner:chat',
} as const;

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
