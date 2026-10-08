import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { haptic } from '@/lib/telegram';

interface SheetProps {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  /** Editing sheets that save on close: a «Готово» button instead of the ✕. */
  done?: boolean;
}

const EXIT_MS = 380;
const SPRING = 'var(--spring)';

/**
 * iOS-style bottom sheet.
 *  • Swipe down anywhere (once the content is scrolled to the top) — the sheet follows
 *    the finger and the dimmed backdrop fades with it; release fast or far to dismiss.
 *  • Closing always animates out, whether triggered by a gesture, a button or the parent.
 */
export function Sheet({ open, title, onClose, children, done }: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Mount immediately on open; on close, play the exit animation first.
  useEffect(() => {
    if (open) {
      setMounted(true);
      // Re-opened while the exit animation was still running: slide back in.
      const p = panel.current;
      const b = backdrop.current;
      if (p) {
        p.style.transition = `transform 0.5s ${SPRING}`;
        p.style.transform = '';
      }
      if (b) {
        b.style.transition = 'opacity 0.35s ease';
        b.style.opacity = '';
      }
      return;
    }
    if (!mounted) return;
    const p = panel.current;
    const b = backdrop.current;
    if (p) {
      p.style.transition = `transform ${EXIT_MS}ms ${SPRING}`;
      p.style.transform = 'translateY(100%)';
    }
    if (b) {
      b.style.transition = `opacity ${EXIT_MS}ms ease`;
      b.style.opacity = '0';
    }
    const t = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Freeze every scroll area behind the sheet while it is open.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add('sheet-open');
    return () => {
      if (!document.querySelectorAll('[role=dialog][data-open=true]').length) root.classList.remove('sheet-open');
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Drag-to-dismiss.
  useEffect(() => {
    const p = panel.current;
    const b = backdrop.current;
    if (!mounted || !p || !b) return;

    let mode: 'idle' | 'pending' | 'drag' | 'native' = 'idle';
    let startY = 0;
    let startX = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let dy = 0;
    let forced = false;

    const setOffset = (y: number, animate: boolean) => {
      const h = p.offsetHeight || 600;
      p.style.transition = animate ? `transform 0.5s ${SPRING}` : 'none';
      p.style.transform = y ? `translateY(${y}px)` : '';
      b.style.transition = animate ? 'opacity 0.5s ease' : 'none';
      b.style.opacity = String(Math.max(0, 1 - y / h));
    };

    const begin = (y: number, target: EventTarget | null) => {
      const el = target instanceof Element ? target : null;
      lastY = y;
      if (el?.closest('input, textarea, select')) return;
      forced = Boolean(el?.closest('[data-drag-handle]'));
      mode = 'pending';
      startY = lastY = y;
      lastT = performance.now();
      velocity = 0;
      dy = 0;
    };

    const move = (y: number): boolean => {
      if (mode === 'idle' || mode === 'native') return false;
      const d = y - startY;
      if (mode === 'pending') {
        if (Math.abs(d) < 6) return false;
        if (forced || (d > 0 && p.scrollTop <= 0)) mode = 'drag';
        else {
          mode = 'native';
          return false;
        }
      }
      const now = performance.now();
      velocity = 0.8 * ((y - lastY) / Math.max(1, now - lastT)) + 0.2 * velocity;
      lastY = y;
      lastT = now;
      // Slight resistance when pulled above the resting position.
      dy = d > 0 ? d : d * 0.15;
      setOffset(dy, false);
      return true;
    };

    const end = () => {
      if (mode === 'drag') {
        const h = p.offsetHeight || 600;
        if (dy > h * 0.25 || (velocity > 0.5 && dy > 20)) {
          haptic.impact('light');
          onCloseRef.current();
        } else setOffset(0, true);
      }
      mode = 'idle';
    };

    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      begin(e.touches[0].clientY, e.target);
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      if (move(y) && e.cancelable) {
        e.preventDefault();
        return;
      }
      // Horizontal swipes (chip rows, calendar paging) stay native.
      if (Math.abs(e.touches[0].clientX - startX) > Math.abs(y - startY)) return;
      // Native scrolling inside the sheet: never let it chain to the page behind (iOS rubber-band).
      const canScroll = p.scrollHeight > p.clientHeight + 1;
      const atTop = p.scrollTop <= 0 && y > lastY;
      const atBottom = p.scrollTop + p.clientHeight >= p.scrollHeight - 1 && y < lastY;
      if ((!canScroll || atTop || atBottom) && e.cancelable && !(e.target as Element).closest?.('input, textarea, select')) e.preventDefault();
      lastY = y;
    };
    // The dimmed backdrop never scrolls anything.
    const stop = (e: TouchEvent) => e.cancelable && e.preventDefault();
    b.addEventListener('touchmove', stop, { passive: false });
    // Mouse: only from the grabber/title area, so clicks inside the form stay clicks.
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (!(e.target instanceof Element) || !e.target.closest('[data-drag-handle]')) return;
      if (e.target.closest('button')) return;
      begin(e.clientY, e.target);
      const onMove = (ev: PointerEvent) => move(ev.clientY);
      const onUp = () => {
        end();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };

    p.addEventListener('touchstart', onTouchStart, { passive: true });
    p.addEventListener('touchmove', onTouchMove, { passive: false });
    p.addEventListener('touchend', end);
    p.addEventListener('touchcancel', end);
    p.addEventListener('pointerdown', onPointerDown);
    return () => {
      p.removeEventListener('touchstart', onTouchStart);
      p.removeEventListener('touchmove', onTouchMove);
      b.removeEventListener('touchmove', stop);
      p.removeEventListener('touchend', end);
      p.removeEventListener('touchcancel', end);
      p.removeEventListener('pointerdown', onPointerDown);
    };
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center overscroll-none ${open ? '' : 'pointer-events-none'}`}
      role="dialog"
      aria-modal
      aria-label={title}
      data-open={open}
    >
      <div
        ref={backdrop}
        className="absolute inset-0 touch-none bg-black/35"
        style={{ animation: 'fade-in 0.35s ease backwards' }}
        onClick={() => onCloseRef.current()}
      />
      <div
        ref={panel}
        className="animate-sheet-up pb-safe relative max-h-[92dvh] w-full max-w-md overflow-y-auto overflow-x-hidden overscroll-contain rounded-t-[28px] bg-bg shadow-[0_-10px_40px_rgb(0_0_0/0.18)]"
      >
        <div data-drag-handle className="sticky top-0 z-10 cursor-grab touch-none bg-bg/90 px-4 pb-2 pt-2 backdrop-blur-xl">
          <div className="mx-auto mb-2 h-[5px] w-9 rounded-full bg-faint/60" />
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-semibold">{title}</h2>
            {done ? (
              <button
                type="button"
                onClick={() => onCloseRef.current()}
                className="-mr-1 px-1 text-[17px] font-semibold text-blue transition-opacity active:opacity-50"
              >
                Готово
              </button>
            ) : (
              <button
                type="button"
                aria-label="Закрыть"
                onClick={() => onCloseRef.current()}
                className="grid size-[30px] place-items-center rounded-full bg-surface-2 text-muted transition-transform active:scale-90"
              >
                <X className="size-4" strokeWidth={2.6} />
              </button>
            )}
          </div>
        </div>
        <div className="px-4 pb-6 pt-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
