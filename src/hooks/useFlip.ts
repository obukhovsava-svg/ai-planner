import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * FLIP list animation: children marked with [data-flip-id] glide from their
 * previous position to the new one whenever the list re-orders.
 */
export function useFlip(container: RefObject<HTMLElement | null>) {
  const positions = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const next = new Map<string, number>();
    el.querySelectorAll<HTMLElement>('[data-flip-id]').forEach((child) => {
      const id = child.dataset.flipId!;
      const top = child.getBoundingClientRect().top;
      next.set(id, top);
      const prev = positions.current.get(id);
      if (prev !== undefined && Math.abs(prev - top) > 1) {
        child.animate([{ transform: `translateY(${prev - top}px)` }, { transform: 'translateY(0)' }], {
          duration: 550,
          easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
        });
      }
    });
    positions.current = next;
  });
}
