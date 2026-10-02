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
    el.style.transition = animate ? 'transform 0.5s var(--spring)' : 'none';
    el.style.transform = dy ? `translateY(${dy}px)` : '';
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal aria-label={title}>
      <div className="animate-fade-in absolute inset-0 bg-black/35" onClick={onClose} />
      <div
        ref={panel}
        className="animate-sheet-up pb-safe relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[22px] bg-bg shadow-[0_-10px_40px_rgb(0_0_0/0.18)]"
      >
        <div
          className="sticky top-0 z-10 cursor-grab touch-none bg-bg/90 px-4 pb-2 pt-2 backdrop-blur-xl"
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
          <div className="mx-auto mb-2 h-[5px] w-9 rounded-full bg-faint/60" />
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-semibold">{title}</h2>
            <button
              type="button"
              aria-label="Закрыть"
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              className="grid size-[30px] place-items-center rounded-full bg-surface-2 text-muted transition-transform active:scale-90"
            >
              <X className="size-4" strokeWidth={2.6} />
            </button>
          </div>
        </div>
        <div className="px-4 pb-6 pt-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
