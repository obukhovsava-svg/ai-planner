import { useRef, useState, type ReactNode } from 'react';
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
 * the row is deleted on release. Deleting slides the row out, then collapses its height,
 * so the rows below glide up in one continuous motion.
 */
export function SwipeableRow({ children, onDelete }: SwipeableRowProps) {
  const root = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; base: number; axis?: 'x' | 'y' } | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState(false);
  const pastCommit = useRef(false);
  // The click a browser fires right after a drag must not count as a tap.
  const justDragged = useRef(false);

  const width = () => root.current?.offsetWidth ?? 360;
  const committed = -offset > width() * COMMIT;

  const remove = () => {
    if (removing) return;
    haptic.notify('warning');
    setRemoving(true);
    setOffset(-width());
    const el = root.current;
    if (!el) return onDelete();
    // After the slide-out, collapse the height smoothly, then drop the item.
    window.setTimeout(() => {
      const h = el.offsetHeight;
      el.animate([{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 280, easing: SPRING, fill: 'forwards' }).finished.then(
        onDelete,
        onDelete,
      );
    }, 180);
  };

  const progress = Math.min(1, -offset / REVEAL);

  return (
    <div ref={root} data-swipe-lock className="relative overflow-hidden">
      {/* action area behind the row */}
      <div
        className="absolute inset-y-0 right-0 flex items-center"
        style={{
          width: Math.max(0, -offset),
          justifyContent: committed ? 'flex-start' : 'center',
          paddingLeft: committed ? 16 : 0,
        }}
      >
        <button
          type="button"
          onClick={remove}
          aria-label="Удалить"
          tabIndex={offset < 0 ? 0 : -1}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-red text-white shadow-[0_4px_14px_rgb(255_59_48/0.35)] active:scale-90"
          style={{
            transform: `scale(${committed ? 1.08 : 0.4 + 0.6 * progress})`,
            opacity: Math.min(1, progress * 1.4),
            transition: dragging ? 'transform 0.2s ease' : `transform 0.4s ${SPRING}, opacity 0.3s`,
          }}
        >
          <Trash2 className="size-[19px]" strokeWidth={2.2} />
        </button>
      </div>

      <div
        className="relative touch-pan-y"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : `transform ${removing ? 0.22 : 0.45}s ${SPRING}`,
        }}
        onPointerDown={(e) => {
          if (removing || (e.pointerType === 'mouse' && e.button !== 0)) return;
          start.current = { x: e.clientX, y: e.clientY, base: offset };
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
            if (s.axis === 'x') {
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragging(true);
            }
          }
          if (s.axis !== 'x') return;
          // Resist a little when pulled right past the resting position.
          const raw = s.base + dx;
          const next = raw > 0 ? raw * 0.15 : raw;
          setOffset(next);
          const past = -next > width() * COMMIT;
          if (past !== pastCommit.current) {
            pastCommit.current = past;
            haptic.impact('medium');
          }
        }}
        onPointerUp={() => {
          const s = start.current;
          start.current = null;
          setDragging(false);
          if (s?.axis !== 'x') return;
          justDragged.current = true;
          window.setTimeout(() => (justDragged.current = false), 0);
          if (-offset > width() * COMMIT) remove();
          else setOffset(-offset > REVEAL / 2 ? -REVEAL : 0);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDragging(false);
          setOffset(0);
        }}
        onClickCapture={(e) => {
          if (justDragged.current) {
            e.stopPropagation();
            e.preventDefault();
            return;
          }
          // A tap on an open row closes it instead of triggering the row's own action.
          if (offset !== 0 && !removing) {
            e.stopPropagation();
            e.preventDefault();
            setOffset(0);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
