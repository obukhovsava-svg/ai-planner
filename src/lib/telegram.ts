/**
 * Thin, typed wrapper around the official `window.Telegram.WebApp` bridge
 * (loaded via telegram-web-app.js in index.html).
 *
 * Outside Telegram (plain browser during development) `initData` is empty and
 * every call degrades to a safe no-op, so the app runs anywhere.
 */

type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type NotificationType = 'error' | 'success' | 'warning';

interface SafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface TelegramWebApp {
  initData: string;
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  isExpanded: boolean;
  safeAreaInset?: SafeAreaInset;
  contentSafeAreaInset?: SafeAreaInset;
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
  HapticFeedback: {
    impactOccurred(style: ImpactStyle): void;
    notificationOccurred(type: NotificationType): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

function getWebApp(): TelegramWebApp | undefined {
  return window.Telegram?.WebApp;
}

/** True only when actually launched inside a Telegram client. */
export function isInTelegram(): boolean {
  return Boolean(getWebApp()?.initData);
}

function supports(version: string): boolean {
  const wa = getWebApp();
  return Boolean(wa && isInTelegram() && wa.isVersionAtLeast(version));
}

export const haptic = {
  impact(style: ImpactStyle = 'light') {
    if (supports('6.1')) getWebApp()!.HapticFeedback.impactOccurred(style);
    else if (!isInTelegram()) navigator.vibrate?.(style === 'heavy' ? 20 : 8);
  },
  notify(type: NotificationType) {
    if (supports('6.1')) getWebApp()!.HapticFeedback.notificationOccurred(type);
  },
  selection() {
    if (supports('6.1')) getWebApp()!.HapticFeedback.selectionChanged();
  },
};

export function getTelegramColorScheme(): 'light' | 'dark' | null {
  return isInTelegram() ? getWebApp()!.colorScheme : null;
}

export function onTelegramThemeChange(cb: () => void): () => void {
  const wa = getWebApp();
  if (!wa || !isInTelegram()) return () => {};
  wa.onEvent('themeChanged', cb);
  return () => wa.offEvent('themeChanged', cb);
}

/** Paint Telegram's native chrome (header / background / bottom bar) to match our theme. */
export function syncTelegramChrome(bg: string) {
  const wa = getWebApp();
  if (!wa || !isInTelegram()) return;
  try {
    if (wa.isVersionAtLeast('6.1')) {
      wa.setHeaderColor(bg);
      wa.setBackgroundColor(bg);
    }
    if (wa.isVersionAtLeast('7.10')) wa.setBottomBarColor?.(bg);
  } catch {
    /* older clients reject custom colors — ignore */
  }
}

/**
 * Publish safe-area insets as CSS variables so layout can use them:
 *   --tg-safe-top / --tg-safe-bottom  (device insets: notch, home indicator)
 *   --tg-content-top                   (Telegram's own overlay in fullscreen mode)
 * CSS combines these with env(safe-area-inset-*) as a fallback.
 */
function applySafeArea() {
  const wa = getWebApp();
  const root = document.documentElement.style;
  const safe = wa?.safeAreaInset;
  const content = wa?.contentSafeAreaInset;
  root.setProperty('--tg-safe-top', `${safe?.top ?? 0}px`);
  root.setProperty('--tg-safe-bottom', `${safe?.bottom ?? 0}px`);
  root.setProperty('--tg-content-top', `${content?.top ?? 0}px`);
}

/** Call once on startup. */
export function initTelegram() {
  const wa = getWebApp();
  applySafeArea();
  if (!wa || !isInTelegram()) return;

  wa.ready();
  wa.expand();
  // Prevents the "swipe down closes the app" gesture from fighting our scroll areas.
  if (wa.isVersionAtLeast('7.7')) wa.disableVerticalSwipes?.();

  wa.onEvent('safeAreaChanged', applySafeArea);
  wa.onEvent('contentSafeAreaChanged', applySafeArea);
}
