import { useLayoutEffect, type RefObject } from 'react';

const FLIP_ID = 'flip';

/**
 * FLIP list animation: children marked with [data-flip-id] glide from where they were
 * to where they are after a re-order.
 *
 * "First" positions are measured during render — i.e. right before React commits the
 * change — so they are never stale; "last" positions are measured after the commit with
 * any in-flight FLIP animation cancelled, so an interrupted glide continues smoothly.
 */
export function useFlip(container: RefObject<HTMLElement | null>) {
  const first = new Map<string, number>();
  container.current?.querySelectorAll<HTMLElement>('[data-flip-id]').forEach((el) => {
    first.set(el.dataset.flipId!, el.getBoundingClientRect().top);
  });

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    el.querySelectorAll<HTMLElement>('[data-flip-id]').forEach((child) => {
      const from = first.get(child.dataset.flipId!);
      if (from === undefined) return;
      child.getAnimations().forEach((a) => a.id === FLIP_ID && a.cancel());
      const delta = from - child.getBoundingClientRect().top;
      if (Math.abs(delta) < 1) return;
      const anim = child.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], {
        duration: 550,
        easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
      });
      anim.id = FLIP_ID;
    });
  });
}
