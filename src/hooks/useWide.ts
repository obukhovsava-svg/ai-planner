import { createContext, useContext, useSyncExternalStore } from 'react';

/** A window wide enough for the three screens side by side (the Mac app, a desktop browser). */
const QUERY = '(min-width: 960px)';

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const snapshot = () => window.matchMedia(QUERY).matches;

/** True in the wide layout; also keeps `html.wide` in sync for the CSS (`wide:` variant). */
export function useWide(): boolean {
  const wide = useSyncExternalStore(subscribe, snapshot, () => false);
  document.documentElement.classList.toggle('wide', wide);
  return wide;
}

/** Side columns of the wide layout: their headers leave out the settings button (one is enough). */
export const SidePane = createContext(false);
export const useSidePane = () => useContext(SidePane);
