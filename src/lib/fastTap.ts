/**
 * iPhone WebKit sometimes holds a tap's click back until the next touch (its "content change"
 * check after the synthetic hover) — buttons then need two taps, or react only after the next one.
 * On iOS a short, still tap is turned into a click right away; the delayed native one is cancelled.
 * Text fields, links and anything scrolling keep the native behaviour.
 */
export function installFastTap() {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (!ios) return;

  let start: { x: number; y: number; time: number; target: EventTarget | null } | null = null;
  let lastScroll = 0;
  window.addEventListener('scroll', () => (lastScroll = performance.now()), { capture: true, passive: true });

  document.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      // a touch that stops a running scroll is not a tap
      start = e.touches.length === 1 && performance.now() - lastScroll > 120 ? { x: t.clientX, y: t.clientY, time: performance.now(), target: e.target } : null;
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    'touchmove',
    (e) => {
      const t = e.touches[0];
      if (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) start = null;
    },
    { capture: true, passive: true },
  );
  document.addEventListener('touchcancel', () => (start = null), { capture: true, passive: true });
  document.addEventListener(
    'touchend',
    (e) => {
      const s = start;
      start = null;
      if (!s || e.defaultPrevented || performance.now() - s.time > 600) return;
      const el = s.target instanceof Element ? s.target : s.target instanceof Node ? s.target.parentElement : null;
      if (!el || el.closest('input, textarea, select, label, a[href], [contenteditable]')) return;

      e.preventDefault(); // no delayed native click on top of ours
      // a tap outside the field being typed in still closes the keyboard (the send button keeps it)
      const active = document.activeElement;
      if ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && !active.form?.contains(el)) active.blur();
      const t = e.changedTouches[0];
      el.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: 1, clientX: t.clientX, clientY: t.clientY, screenX: t.screenX, screenY: t.screenY }),
      );
    },
    { capture: true, passive: false },
  );
}
