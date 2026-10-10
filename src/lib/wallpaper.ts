/**
 * Lock-screen wallpaper for Telegram users. The photo stays on the phone (IndexedDB); the drawn
 * wallpapers for today and tomorrow go to the server, where the «Обои ПЛАН» Shortcut fetches
 * today's one by the personal link. Uploads happen only once the user has turned it on.
 */
import { useEffect } from 'react';
import { usePlannerStore } from '@/store/usePlannerStore';
import { addDays, todayKey } from './date';
import { authHeaders, hasServerAuth } from './auth';
import { isNative } from './native';
import { drawWallpaper } from './wallpaperRender';
import { AI_URL } from '@/config';

const API = AI_URL.replace(/\/$/, '');
const ON_KEY = 'planner:wallpaper-on';
const SENT_KEY = 'planner:wallpaper-sent';

// ---------------------------------------------------------------- the photo (IndexedDB)

const db = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('planner', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const d = await db();
    return await new Promise<T>((resolve, reject) => {
      const req = fn(d.transaction('files', mode).objectStore('files'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export const loadPhotoBlob = () => idb<Blob>('readonly', (s) => s.get('wallpaper-photo') as IDBRequest<Blob>);

/** Saves the picked photo, shrunk to screen size (keeps IndexedDB small). */
export async function savePhoto(file: File) {
  const img = await blobToImage(file);
  const max = 2800;
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.88));
  if (blob) await idb('readwrite', (st) => st.put(blob, 'wallpaper-photo'));
  localStorage.removeItem(SENT_KEY); // the picture changed → upload again
}

export async function clearPhoto() {
  await idb('readwrite', (s) => s.delete('wallpaper-photo'));
  localStorage.removeItem(SENT_KEY);
}

function blobToImage(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

export async function loadPhoto() {
  const b = await loadPhotoBlob();
  return b ? blobToImage(b).catch(() => null) : null;
}

// ---------------------------------------------------------------- render + upload

export const wallpaperOn = () => localStorage.getItem(ON_KEY) === '1';
export const setWallpaperOn = () => localStorage.setItem(ON_KEY, '1');

export async function renderWallpaper(date = todayKey()) {
  const { events, tasks } = usePlannerStore.getState();
  return drawWallpaper({ date, events, tasks }, await loadPhoto());
}

const jpeg = (c: HTMLCanvasElement) => c.toDataURL('image/jpeg', 0.8);

/** Draws today + tomorrow and uploads them, unless nothing changed since the last upload. */
export async function uploadWallpapers(force = false) {
  if (!hasServerAuth() || isNative()) return false;
  const { events, tasks } = usePlannerStore.getState();
  const today = todayKey();
  const photo = await loadPhotoBlob();
  const sig = `${today}|${photo?.size ?? 0}|${JSON.stringify(events)}|${JSON.stringify(tasks.map((t) => [t.id, t.title, t.date, t.time, t.done, t.priority]))}`;
  const hash = String(Array.from(sig).reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7));
  if (!force && localStorage.getItem(SENT_KEY) === hash) return true;
  const img = photo ? await blobToImage(photo).catch(() => null) : null;
  try {
    for (const day of [today, addDays(today, 1)]) {
      const body = jpeg(drawWallpaper({ date: day, events, tasks }, img));
      const r = await fetch(`${API}/wallpaper?day=${day}`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'text/plain' }, body });
      if (!r.ok) return false;
    }
    localStorage.setItem(SENT_KEY, hash);
    return true;
  } catch {
    return false;
  }
}

/** Telegram: keep the server's wallpaper fresh after changes and on every open. */
export function useWallpaperSync() {
  useEffect(() => {
    if (isNative() || !hasServerAuth()) return;
    let t = 0;
    const kick = () => {
      if (!wallpaperOn()) return;
      window.clearTimeout(t);
      // short pause: the picture must be on the server by the time you leave Telegram
      t = window.setTimeout(() => void uploadWallpapers(), 1200);
    };
    kick();
    const unsub = usePlannerStore.subscribe(kick);
    const onVisible = () => document.visibilityState === 'visible' && kick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsub();
      window.clearTimeout(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
