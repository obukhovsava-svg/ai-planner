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
    const moves: { child: HTMLElement; delta: number }[] = [];
    el.querySelectorAll<HTMLElement>('[data-flip-id]').forEach((child) => {
      const from = first.get(child.dataset.flipId!);
      if (from === undefined) return;
      child.getAnimations().forEach((a) => a.id === FLIP_ID && a.cancel());
      const delta = from - child.getBoundingClientRect().top;
      if (Math.abs(delta) >= 1) moves.push({ child, delta });
    });
    // The row that travels furthest (e.g. a ticked task sinking to the bottom) lifts slightly
    // and glides over the others, which simply slide up to fill its place.
    const far = moves.reduce<(typeof moves)[number] | null>((m, x) => (!m || Math.abs(x.delta) > Math.abs(m.delta) ? x : m), null);
    for (const { child, delta } of moves) {
      const lead = child === far?.child && moves.length > 1 && Math.abs(delta) > child.offsetHeight * 1.5;
      const anim = lead
        ? child.animate(
            [
              { transform: `translateY(${delta}px) scale(1)`, boxShadow: '0 0 0 rgb(0 0 0 / 0)' },
              { transform: `translateY(${delta * 0.6}px) scale(1.025)`, boxShadow: '0 12px 30px rgb(0 0 0 / 0.18)', offset: 0.35 },
              { transform: 'translateY(0) scale(1)', boxShadow: '0 0 0 rgb(0 0 0 / 0)' },
            ],
            { duration: 650, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
          )
        : child.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], {
            duration: 550,
            easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
          });
      anim.id = FLIP_ID;
      if (lead) {
        child.style.zIndex = '2';
        anim.finished.then(() => (child.style.zIndex = ''), () => (child.style.zIndex = ''));
      }
    }
  });
}
