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
  BackButton: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
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

/** Signed launch data; the AI worker uses it to verify requests come from this Mini App. */
export function getInitData(): string {
  return getWebApp()?.initData ?? '';
}

/** True only when actually launched inside a Telegram client. */
export function isInTelegram(): boolean {
  return Boolean(getWebApp()?.initData);
}

function supports(version: string): boolean {
  const wa = getWebApp();
  return Boolean(wa && isInTelegram() && wa.isVersionAtLeast(version));
}

/** Time of the last haptic, so the global tap feedback never doubles a specific one. */
let lastHapticAt = 0;
const mark = () => {
  lastHapticAt = performance.now();
};

export const haptic = {
  impact(style: ImpactStyle = 'light') {
    mark();
    if (supports('6.1')) getWebApp()!.HapticFeedback.impactOccurred(style);
    else if (!isInTelegram()) navigator.vibrate?.(style === 'heavy' ? 20 : style === 'medium' ? 12 : 6);
  },
  notify(type: NotificationType) {
    mark();
    if (supports('6.1')) getWebApp()!.HapticFeedback.notificationOccurred(type);
    else if (!isInTelegram()) navigator.vibrate?.(type === 'success' ? [8, 40, 8] : 15);
  },
  selection() {
    mark();
    if (supports('6.1')) getWebApp()!.HapticFeedback.selectionChanged();
    else if (!isInTelegram()) navigator.vibrate?.(4);
  },
};

/**
 * Gives every button a subtle tap. Runs after React's handlers (document, bubble phase),
 * so if a handler already played a richer haptic (success, warning, medium…) we stay silent.
 * Opt out with [data-no-haptic].
 */
function installTapHaptics() {
  document.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target.closest('button, [role="button"], [role="switch"], [role="checkbox"], a') : null;
    if (!target || target.closest('[data-no-haptic]')) return;
    if ((target as HTMLButtonElement).disabled) return;
    if (performance.now() - lastHapticAt < 80) return;
    haptic.impact('light');
  });
}

/** Shows Telegram's native "Back" button in the header; returns a cleanup that hides it. */
export function showTelegramBackButton(onBack: () => void): () => void {
  if (!supports('6.1')) return () => {};
  const bb = getWebApp()!.BackButton;
  bb.onClick(onBack);
  bb.show();
  return () => {
    bb.offClick(onBack);
    bb.hide();
  };
}

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
  installTapHaptics();
  if (!wa || !isInTelegram()) return;

  wa.ready();
  wa.expand();
  // Prevents the "swipe down closes the app" gesture from fighting our scroll areas.
  if (wa.isVersionAtLeast('7.7')) wa.disableVerticalSwipes?.();

  wa.onEvent('safeAreaChanged', applySafeArea);
  wa.onEvent('contentSafeAreaChanged', applySafeArea);
}
