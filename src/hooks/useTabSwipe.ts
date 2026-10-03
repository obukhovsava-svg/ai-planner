import { useEffect, type RefObject } from 'react';

/**
 * Horizontal swipe anywhere on the screen → previous / next tab.
 * Ignored when the gesture starts inside something with its own horizontal gesture:
 * [data-swipe-lock] (swipe-to-delete rows, the day screen…), horizontally scrollable
 * areas (chip rows), text fields — or while a bottom sheet is open.
 */
export function useTabSwipe(area: RefObject<HTMLElement | null>, onSwipe: (dir: 'left' | 'right') => void) {
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    let start: { x: number; y: number; t: number } | null = null;

    const locked = (target: EventTarget | null): boolean => {
      if (document.documentElement.classList.contains('sheet-open')) return true;
      let node = target instanceof Element ? target : null;
      while (node && node !== el) {
        if (node.hasAttribute('data-swipe-lock') || node.matches('input, textarea, select')) return true;
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 2) return true;
        node = node.parentElement;
      }
      return false;
    };

    const down = (x: number, y: number, target: EventTarget | null) => {
      start = locked(target) ? null : { x, y, t: performance.now() };
    };
    const up = (x: number, y: number) => {
      const s = start;
      start = null;
      if (!s) return;
      const dx = x - s.x;
      const dy = y - s.y;
      const dt = performance.now() - s.t;
      // Clearly horizontal, long enough (or a quick flick), and not a slow drag.
      if (Math.abs(dx) > Math.abs(dy) * 2 && (Math.abs(dx) > 80 || (Math.abs(dx) > 45 && dt < 300)) && dt < 800) {
        onSwipe(dx < 0 ? 'left' : 'right');
      }
    };

    const ts = (e: TouchEvent) => down(e.touches[0].clientX, e.touches[0].clientY, e.target);
    const te = (e: TouchEvent) => up(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    const pd = (e: PointerEvent) => e.pointerType === 'mouse' && down(e.clientX, e.clientY, e.target);
    const pu = (e: PointerEvent) => e.pointerType === 'mouse' && up(e.clientX, e.clientY);
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchend', te, { passive: true });
    el.addEventListener('pointerdown', pd);
    el.addEventListener('pointerup', pu);
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchend', te);
      el.removeEventListener('pointerdown', pd);
      el.removeEventListener('pointerup', pu);
    };
  }, [area, onSwipe]);
}
