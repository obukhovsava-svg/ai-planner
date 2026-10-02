import type { PointerEvent } from 'react';
import { useRef } from 'react';

/**
 * Horizontal swipe detector (pointer events). Returns handlers to spread on an element.
 * Ignores mostly-vertical gestures so scrolling keeps working.
 */
const EDGE = 28;

export function useSwipe(onSwipe: (dir: 'left' | 'right') => void, threshold = 50) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  return {
    onPointerDown(e: PointerEvent) {
      // The left screen edge belongs to the swipe-back gesture.
      if (e.clientX < EDGE) return;
      start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    },
    onPointerUp(e: PointerEvent) {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      const fast = Date.now() - s.t < 500;
      if (Math.abs(dx) > Math.abs(dy) * 1.5 && (Math.abs(dx) > threshold || (fast && Math.abs(dx) > threshold / 2))) {
        onSwipe(dx < 0 ? 'left' : 'right');
      }
    },
    onPointerCancel() {
      start.current = null;
    },
  };
}
