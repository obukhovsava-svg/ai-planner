import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface SheetProps {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
}

/** iOS-style bottom sheet with drag-to-dismiss. */
export function Sheet({ open, title, onClose, children }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const setOffset = (dy: number, animate = false) => {
    const el = panel.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 0.25s ease' : 'none';
    el.style.transform = dy ? `translateY(${dy}px)` : '';
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal aria-label={title}>
      <div className="animate-fade-in absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        className="animate-sheet-up pb-safe relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] border-t border-line bg-surface shadow-2xl"
      >
        <div
          className="sticky top-0 z-10 cursor-grab touch-none bg-surface px-5 pb-2 pt-2"
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, dy: 0 };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            drag.current.dy = Math.max(0, e.clientY - drag.current.y);
            setOffset(drag.current.dy);
          }}
          onPointerUp={() => {
            if (drag.current && drag.current.dy > 90) onClose();
            else setOffset(0, true);
            drag.current = null;
          }}
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line" />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button
              type="button"
              aria-label="Закрыть"
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="px-5 pb-6 pt-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
