import { useRef, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { haptic } from '@/lib/telegram';

interface SwipeableRowProps {
  children: ReactNode;
  onDelete(): void;
}

const REVEAL = 76; // open position: room for the round button
const COMMIT = 0.5; // swiping past half the row deletes on release
const SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)';

/**
 * Telegram-style swipe-to-delete: a round red trash button grows out of the right edge.
 * Short swipe → the row stays open; long swipe → the button follows the row's edge and
 * the row is deleted on release.
 *
 * Smoothness: the drag writes transforms straight to the DOM (no React re-render per frame),
 * and deleting is one continuous motion — the row slides out while its height is already
 * collapsing, so the rows below glide up without a pause.
 */
export function SwipeableRow({ children, onDelete }: SwipeableRowProps) {
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const start = useRef<{ x: number; y: number; base: number; axis?: 'x' | 'y' } | null>(null);
  const offset = useRef(0);
  const removing = useRef(false);
  const pastCommit = useRef(false);
  // The click a browser fires right after a drag must not count as a tap.
  const justDragged = useRef(false);

  const width = () => root.current?.offsetWidth ?? 360;

  /** Puts the row at `x` (≤ 0); `animate` = spring there instead of following the finger. */
  const place = (x: number, animate: boolean) => {
    offset.current = x;
    const c = content.current;
    const a = action.current;
    const b = button.current;
    if (!c || !a || !b) return;
    const committed = -x > width() * COMMIT;
    const progress = Math.min(1, -x / REVEAL);
    const t = animate ? `transform 0.45s ${SPRING}` : 'none';
    c.style.transition = t;
    c.style.transform = `translate3d(${x}px,0,0)`;
    a.style.transition = animate ? `width 0.45s ${SPRING}, padding 0.3s` : 'padding 0.2s';
    a.style.width = `${Math.max(0, -x)}px`;
    a.style.justifyContent = committed ? 'flex-start' : 'center';
    a.style.paddingLeft = committed ? '16px' : '0px';
    b.style.transition = animate ? `transform 0.4s ${SPRING}, opacity 0.3s` : 'transform 0.2s ease';
    b.style.transform = `scale(${committed ? 1.08 : 0.4 + 0.6 * progress})`;
    b.style.opacity = String(Math.min(1, progress * 1.4));
    b.tabIndex = x < 0 ? 0 : -1;
  };

  const remove = () => {
    if (removing.current) return;
    removing.current = true;
    haptic.notify('warning');
    const el = root.current;
    const c = content.current;
    if (!el || !c) return onDelete();
    const w = width();
    const h = el.offsetHeight;
    // Slide out and collapse together — one motion, no gap between the two.
    c.style.transition = 'none';
    c.animate([{ transform: `translate3d(${offset.current}px,0,0)` }, { transform: `translate3d(${-w}px,0,0)` }], {
      duration: 220,
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'forwards',
    });
    button.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
    el.style.willChange = 'height';
    el.animate([{ height: `${h}px` }, { height: '0px' }], { duration: 300, delay: 120, easing: SPRING, fill: 'forwards' }).finished.then(onDelete, onDelete);
  };

  return (
    <div ref={root} data-swipe-lock className="relative overflow-hidden">
      {/* action area behind the row */}
      <div ref={action} className="absolute inset-y-0 right-0 flex items-center justify-center" style={{ width: 0 }}>
        <button
          ref={button}
          type="button"
          onClick={remove}
          aria-label="Удалить"
          tabIndex={-1}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-red text-white shadow-[0_4px_14px_rgb(255_59_48/0.35)] active:scale-90"
          style={{ opacity: 0, transform: 'scale(0.4)' }}
        >
          <Trash2 className="size-[19px]" strokeWidth={2.2} />
        </button>
      </div>

      <div
        ref={content}
        className="relative touch-pan-y will-change-transform"
        onPointerDown={(e) => {
          if (removing.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
          start.current = { x: e.clientX, y: e.clientY, base: offset.current };
          pastCommit.current = false;
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (!s.axis) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            if (s.axis === 'x') e.currentTarget.setPointerCapture(e.pointerId);
          }
          if (s.axis !== 'x') return;
          // Resist a little when pulled right past the resting position.
          const raw = s.base + dx;
          const next = raw > 0 ? raw * 0.15 : raw;
          place(next, false);
          const past = -next > width() * COMMIT;
          if (past !== pastCommit.current) {
            pastCommit.current = past;
            haptic.impact('medium');
          }
        }}
        onPointerUp={() => {
          const s = start.current;
          start.current = null;
          if (s?.axis !== 'x') return;
          justDragged.current = true;
          window.setTimeout(() => (justDragged.current = false), 0);
          if (-offset.current > width() * COMMIT) remove();
          else place(-offset.current > REVEAL / 2 ? -REVEAL : 0, true);
        }}
        onPointerCancel={() => {
          start.current = null;
          if (!removing.current) place(0, true);
        }}
        onClickCapture={(e) => {
          if (justDragged.current) {
            e.stopPropagation();
            e.preventDefault();
            return;
          }
          // A tap on an open row closes it instead of triggering the row's own action.
          if (offset.current !== 0 && !removing.current) {
            e.stopPropagation();
            e.preventDefault();
            place(0, true);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
