import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isMacApp } from '@/lib/native';

/** The Mac app (its native time field crashes it), or mouse and trackpad with no touch at all. */
const desktop = () =>
  isMacApp() || (typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches && !('ontouchstart' in window) && navigator.maxTouchPoints === 0);

const pad = (n: number) => String(n).padStart(2, '0');
const STEPS = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);

/** "9" → 09:00, "930" / "9.30" / "9 30" → 09:30, "21:5" → 21:05; anything else → null. */
function parse(text: string): string | null {
  const t = text.trim().replace(/[.\s,-]/g, ':');
  const m = t.match(/^(\d{1,2})(?::?(\d{1,2}))?$/) ?? t.match(/^(\d{1,2})(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2] ?? 0);
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : null;
}

interface TimeFieldProps {
  value: string;
  /** Called only with a valid "HH:MM". */
  onChange(v: string): void;
  className?: string;
  disabled?: boolean;
}

/**
 * Time input. Phones keep the native wheel. On a Mac WebKit's native time field is a sluggish
 * segmented control that fires a change (and a re-render) on every keystroke — there it's a
 * plain field: type "930" or pick from a list every 15 minutes; ↑/↓ move by 15 minutes.
 */
export function TimeField({ value, onChange, className = '', disabled }: TimeFieldProps) {
  const [isDesktop] = useState(desktop);
  if (!isDesktop) {
    return <input type="time" value={value} disabled={disabled} onChange={(e) => e.target.value && onChange(e.target.value)} className={className} />;
  }
  return <DesktopTime value={value} onChange={onChange} className={className} disabled={disabled} />;
}

function DesktopTime({ value, onChange, className, disabled }: TimeFieldProps) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<DOMRect | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => setText(value), [value]);

  const commit = (raw: string) => {
    const v = parse(raw);
    if (v && v !== value) onChange(v);
    setText(v ?? value);
  };

  const shift = (minutes: number) => {
    const [h, m] = (parse(text) ?? value ?? '09:00').split(':').map(Number);
    const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
    const v = `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
    setText(v);
    onChange(v);
  };

  // The list floats above everything (a sheet scrolls and would clip it), under the field.
  useLayoutEffect(() => {
    if (!open || !field.current) return;
    setBox(field.current.getBoundingClientRect());
  }, [open]);
  // Open on the current time (a couple of rows above it), not at midnight.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const near = STEPS.findIndex((s) => s >= (value || '09:00'));
    const row = el.children[Math.max(0, near - 2)] as HTMLElement | undefined;
    if (row) el.scrollTop = row.offsetTop - 4;
  }, [box, value]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!field.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const below = box ? box.bottom + 236 < window.innerHeight : true;

  return (
    <>
      <input
        ref={field}
        type="text"
        inputMode="numeric"
        disabled={disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => {
          e.target.select();
          setOpen(true);
        }}
        onBlur={() => commit(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(text);
            setOpen(false);
          } else if (e.key === 'Escape' && open) {
            // closes the list only, not the sheet around it
            e.preventDefault();
            e.stopPropagation();
            setText(value);
            setOpen(false);
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            shift(e.key === 'ArrowUp' ? 15 : -15);
          }
        }}
        className={`${className} tabular-nums`}
        // the width counts the digits only, padding comes on top (content-box) — "09:00" always fits
        style={/(^|\s)w-/.test(className ?? '') ? { cursor: 'text' } : { cursor: 'text', boxSizing: 'content-box', width: '5.4ch' }}
      />
      {open &&
        box &&
        createPortal(
          <div
            ref={list}
            role="listbox"
            className="fixed z-[70] max-h-[228px] w-[112px] overflow-y-auto rounded-[12px] border-[0.5px] border-line bg-surface py-1 shadow-[0_12px_40px_rgb(0_0_0/0.22)]"
            style={{ left: box.left, top: below ? box.bottom + 6 : box.top - 234 }}
          >
            {STEPS.map((s) => (
              <button
                key={s}
                type="button"
                role="option"
                aria-selected={s === value}
                // mousedown: pick before the field's blur commits the typed text
                onMouseDown={(e) => {
                  e.preventDefault();
                  setText(s);
                  onChange(s);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-[5px] text-left text-[15px] tabular-nums hover:bg-surface-2 ${s === value ? 'font-semibold text-blue' : 'text-fg'}`}
              >
                {s}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
