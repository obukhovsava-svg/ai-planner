import { useEffect, useRef, type RefObject } from 'react';
import { haptic } from '@/lib/telegram';

interface Options {
  /** Element whose --p variable is driven (0 = collapsed, 1 = expanded). */
  root: RefObject<HTMLElement | null>;
  /** Element the gesture listens on. */
  panel: RefObject<HTMLElement | null>;
  /** Scroll container inside the panel; the gesture only takes over when it makes sense. */
  scroller: RefObject<HTMLElement | null>;
  /** Pixels of travel between collapsed and expanded. */
  range: number;
  expanded: boolean;
  onSnap(expanded: boolean): void;
}

const RUBBER = 0.18;

/**
 * Pull-to-expand like iOS Calendar:
 *  • pull the panel down (when its list is scrolled to the top) → expand,
 *  • push it up → collapse before the list starts scrolling,
 *  • elements marked [data-drag-handle] always drag.
 * Tracks the finger 1:1 with rubber-banding at the edges and snaps using velocity.
 */
export function useExpandGesture({ root, panel, scroller, range, expanded, onSnap }: Options) {
  const p = useRef(expanded ? 1 : 0);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const onSnapRef = useRef(onSnap);
  onSnapRef.current = onSnap;

  // Keep --p in sync when the state changes from outside (e.g. persisted preference on load).
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    p.current = expanded ? 1 : 0;
    el.style.setProperty('--p', String(p.current));
  }, [expanded, root]);

  useEffect(() => {
    const rootEl = root.current;
    const panelEl = panel.current;
    const scrollEl = scroller.current;
    if (!rootEl || !panelEl || !scrollEl) return;
    rootEl.classList.add('cal-anim');

    let mode: 'idle' | 'pending' | 'drag' | 'native' = 'idle';
    let startY = 0;
    let p0 = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let fromHandle = false;
    let suppressClick = false;
    let pastHalf = false;

    const setP = (v: number) => {
      p.current = v;
      rootEl.style.setProperty('--p', String(v));
    };

    const begin = (y: number, target: EventTarget | null) => {
      mode = 'pending';
      startY = lastY = y;
      lastT = performance.now();
      velocity = 0;
      p0 = p.current;
      pastHalf = p0 > 0.5;
      fromHandle = target instanceof Element && Boolean(target.closest('[data-drag-handle]'));
    };

    /** Returns true when the gesture is ours (caller should preventDefault). */
    const move = (y: number): boolean => {
      if (mode === 'idle' || mode === 'native') return false;
      const dy = y - startY;
      if (mode === 'pending') {
        if (Math.abs(dy) < 6) return false;
        const atTop = scrollEl.scrollTop <= 0;
        const wantsExpand = dy > 0 && p0 < 1 && (atTop || fromHandle);
        const wantsCollapse = dy < 0 && p0 > 0;
        if (fromHandle || wantsExpand || wantsCollapse) {
          mode = 'drag';
          rootEl.classList.remove('cal-anim');
        } else {
          mode = 'native';
          return false;
        }
      }
      const now = performance.now();
      velocity = 0.8 * ((y - lastY) / Math.max(1, now - lastT)) + 0.2 * velocity;
      lastY = y;
      lastT = now;
      let next = p0 + dy / rangeRef.current;
      if (next > 1) next = 1 + (next - 1) * RUBBER;
      if (next < 0) next = next * RUBBER;
      setP(next);
      // A soft tick when the drag crosses the point where it would snap the other way.
      if (next > 0.5 !== pastHalf) {
        pastHalf = next > 0.5;
        haptic.selection();
      }
      return true;
    };

    const end = () => {
      if (mode === 'drag') {
        const current = p.current;
        const target = Math.abs(velocity) > 0.35 ? velocity > 0 : current > 0.5;
        rootEl.classList.add('cal-anim');
        setP(target ? 1 : 0);
        haptic.impact(target !== p0 > 0.5 ? 'medium' : 'light');
        suppressClick = true;
        window.setTimeout(() => (suppressClick = false), 50);
        onSnapRef.current(target);
      }
      mode = 'idle';
    };

    // Touch (phones): non-passive move so we can stop the list from scrolling while dragging.
    const onTouchStart = (e: TouchEvent) => begin(e.touches[0].clientY, e.target);
    const onTouchMove = (e: TouchEvent) => {
      if (move(e.touches[0].clientY) && e.cancelable) e.preventDefault();
    };
    // Mouse (desktop / dev tools).
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      begin(e.clientY, e.target);
      const onMove = (ev: PointerEvent) => move(ev.clientY);
      const onUp = () => {
        end();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
    const onClickCapture = (e: MouseEvent) => {
      if (suppressClick) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    panelEl.addEventListener('touchstart', onTouchStart, { passive: true });
    panelEl.addEventListener('touchmove', onTouchMove, { passive: false });
    panelEl.addEventListener('touchend', end);
    panelEl.addEventListener('touchcancel', end);
    panelEl.addEventListener('pointerdown', onPointerDown);
    panelEl.addEventListener('click', onClickCapture, true);
    return () => {
      panelEl.removeEventListener('touchstart', onTouchStart);
      panelEl.removeEventListener('touchmove', onTouchMove);
      panelEl.removeEventListener('touchend', end);
      panelEl.removeEventListener('touchcancel', end);
      panelEl.removeEventListener('pointerdown', onPointerDown);
      panelEl.removeEventListener('click', onClickCapture, true);
    };
  }, [root, panel, scroller]);
}
