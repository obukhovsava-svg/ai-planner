import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { ThemeMode } from '@/types';
import { useUIStore } from '@/store/useUIStore';
import { getTelegramColorScheme, haptic, onTelegramThemeChange, syncTelegramChrome } from '@/lib/telegram';
import { postNative } from '@/lib/native';

interface ThemeContextValue {
  theme: ThemeMode;
  /** true when the user has overridden Telegram / system theme. */
  isManual: boolean;
  /** Toggle light ↔ dark. Pass the click origin for a circular reveal animation. */
  toggle(origin?: { x: number; y: number }): void;
  /** Drop the manual override and follow Telegram / system again. */
  resetToAuto(): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const BG: Record<ThemeMode, string> = { light: '#F2F2F7', dark: '#000000' };

function detectAutoTheme(): ThemeMode {
  return getTelegramColorScheme() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const override = useUIStore((s) => s.themeOverride);
  const setOverride = useUIStore((s) => s.setThemeOverride);
  const [autoTheme, setAutoTheme] = useState<ThemeMode>(detectAutoTheme);

  // Follow Telegram's theme and the OS setting while there is no manual override.
  useEffect(() => {
    const update = () => setAutoTheme(detectAutoTheme());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    const offTg = onTelegramThemeChange(update);
    return () => {
      mq.removeEventListener('change', update);
      offTg();
    };
  }, []);

  const theme = override ?? autoTheme;

  // iOS app: remember the choice natively, so the next launch starts in this theme.
  useEffect(() => postNative({ type: 'theme', mode: override }), [override]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BG[theme]);
    syncTelegramChrome(BG[theme]);
  }, [theme]);

  const applyWithTransition = useCallback((next: ThemeMode | null, origin?: { x: number; y: number }) => {
    const root = document.documentElement;
    const commit = () => flushSync(() => setOverride(next));

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (origin && document.startViewTransition && !reduceMotion) {
      const { x, y } = origin;
      const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      const vt = document.startViewTransition(commit);
      vt.ready
        .then(() =>
          root.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
            { duration: 480, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
          ),
        )
        .catch(() => {});
      return;
    }

    root.classList.add('theme-transition');
    commit();
    window.setTimeout(() => root.classList.remove('theme-transition'), 400);
  }, [setOverride]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      isManual: override !== null,
      toggle(origin) {
        haptic.impact('light');
        const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
        // Toggling back to what Telegram/system wants returns to auto mode.
        applyWithTransition(next === autoTheme ? null : next, origin);
      },
      resetToAuto() {
        applyWithTransition(null);
      },
    }),
    [theme, override, autoTheme, applyWithTransition],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
