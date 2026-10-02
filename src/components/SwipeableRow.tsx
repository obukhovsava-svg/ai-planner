import { useRef, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { haptic } from '@/lib/telegram';

interface SwipeableRowProps {
  children: ReactNode;
  onDelete(): void;
}

const REVEAL = 84; // width of the red action area
const COMMIT = 0.45; // swipe past this fraction of the row width deletes immediately

/**
 * iOS-style swipe-to-delete. Swipe left to reveal "Удалить",
 * swipe far to delete instantly. Vertical scrolling is left untouched.
 */
export function SwipeableRow({ children, onDelete }: SwipeableRowProps) {
  const row = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; base: number; axis?: 'x' | 'y' } | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState(false);
  const passedCommit = useRef(false);

  const remove = () => {
    haptic.notify('warning');
    setRemoving(true);
    setOffset(-(row.current?.offsetWidth ?? 400));
    window.setTimeout(onDelete, 220);
  };

  return (
    <div
      ref={row}
      className={`relative overflow-hidden rounded-2xl transition-[max-height,opacity,margin] duration-200 ${
        removing ? 'max-h-0 opacity-0' : 'max-h-40'
      }`}
    >
      <button
        type="button"
        onClick={remove}
        aria-label="Удалить"
        tabIndex={offset < 0 ? 0 : -1}
        className="absolute inset-y-0 right-0 flex items-center justify-end gap-1.5 bg-red pr-5 text-sm font-semibold text-white"
        style={{ width: Math.max(REVEAL, -offset) }}
      >
        <Trash2 className="size-4" />
        Удалить
      </button>
      <div
        className="relative touch-pan-y"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          start.current = { x: e.clientX, y: e.clientY, base: offset };
          passedCommit.current = false;
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
          const next = Math.min(0, s.base + dx);
          setOffset(next);
          const width = row.current?.offsetWidth ?? 400;
          const past = -next > width * COMMIT;
          if (past !== passedCommit.current) {
            passedCommit.current = past;
            haptic.impact('medium');
          }
        }}
        onPointerUp={() => {
          const s = start.current;
          start.current = null;
          setDragging(false);
          if (s?.axis !== 'x') return;
          const width = row.current?.offsetWidth ?? 400;
          if (-offset > width * COMMIT) remove();
          else setOffset(-offset > REVEAL / 2 ? -REVEAL : 0);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDragging(false);
          setOffset(0);
        }}
        onClickCapture={(e) => {
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
