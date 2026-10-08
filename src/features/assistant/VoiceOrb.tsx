import { useEffect, useRef } from 'react';

interface VoiceOrbProps {
  listening: boolean;
  /** Diameter in px (changes animate). */
  size?: number;
  /** Mic loudness 0…1 while listening (the iOS app sends it); without it the bars move on their own. */
  level?: { current: number | undefined };
  /** false → the button shrinks and fades away (e.g. while the keyboard is up). */
  visible?: boolean;
  onPress(): void;
}

/** Bar shape at rest, centre tallest — like the waveform in Voice Memos. */
const SHAPE = [0.42, 0.7, 1, 0.7, 0.42];

/**
 * The record button: one solid colour (the text colour of the theme), the microphone and the
 * waveform cut out of it in the background colour. Idle shows the mic; while listening the mic
 * dissolves into five bars that follow the voice, and a soft halo breathes with the loudness.
 */
export function VoiceOrb({ listening, size = 104, level, visible = true, onPress }: VoiceOrbProps) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const halo = useRef<HTMLSpanElement>(null);
  const fallback = useRef<number | undefined>(undefined);
  const levelRef = level ?? fallback;

  // Bars and halo follow the voice at display rate, written straight to the DOM (no re-renders).
  useEffect(() => {
    if (!listening) {
      bars.current.forEach((b) => b && (b.style.transform = 'scaleY(0.18)'));
      if (halo.current) halo.current.style.transform = 'scale(0.86)';
      return;
    }
    let raf = 0;
    let smooth = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      // Real loudness from the app, or a calm speech-like rhythm in the browser.
      const target = levelRef.current ?? 0.35 + 0.3 * Math.sin(t * 5.3) * Math.sin(t * 1.7 + 1) + 0.15 * Math.sin(t * 11.1);
      smooth += (Math.max(0, Math.min(1, target)) - smooth) * 0.25;
      bars.current.forEach((b, i) => {
        if (!b) return;
        const wobble = 0.82 + 0.18 * Math.sin(t * (7 + i * 1.3) + i * 1.9);
        const h = 0.18 + 0.82 * Math.min(1, SHAPE[i] * (0.25 + smooth * 1.1) * wobble);
        b.style.transform = `scaleY(${h.toFixed(3)})`;
      });
      if (halo.current) halo.current.style.transform = `scale(${(1.08 + smooth * 0.32).toFixed(3)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [listening, levelRef]);

  const icon = size * 0.36;
  const barW = Math.max(3, size * 0.058);
  const barH = size * 0.38;

  return (
    <div
      className="orb-in relative grid place-items-center"
      style={{
        width: size * 1.5,
        height: size * 1.5,
        transform: visible ? 'scale(1)' : 'scale(0.6)',
        opacity: visible ? 1 : 0,
        filter: visible ? 'none' : 'blur(6px)',
        transition: visible
          ? 'transform 0.55s cubic-bezier(.34,1.56,.64,1) 0.1s, opacity 0.3s ease 0.1s, filter 0.3s ease 0.1s'
          : 'transform 0.25s cubic-bezier(.4,0,1,1), opacity 0.2s ease, filter 0.2s ease',
      }}
    >
      {/* halo: the same colour, faint, breathing with the voice */}
      <span
        ref={halo}
        aria-hidden
        className="pointer-events-none absolute rounded-full bg-fg"
        style={{
          width: size,
          height: size,
          opacity: listening ? 0.1 : 0,
          transform: 'scale(0.86)',
          transition: listening ? 'opacity 0.4s ease' : 'opacity 0.3s ease, transform 0.5s var(--spring)',
        }}
      />
      <button
        type="button"
        onClick={onPress}
        aria-label={listening ? 'Остановить запись' : 'Начать голосовой ввод'}
        aria-pressed={listening}
        className="relative grid place-items-center rounded-full bg-fg text-bg shadow-[0_8px_24px_-8px_rgb(0_0_0/0.35)] outline-none transition-[width,height,transform] duration-500 ease-[cubic-bezier(.34,1.56,.64,1)] active:scale-[0.9] active:duration-150 [-webkit-tap-highlight-color:transparent]"
        style={{ width: size, height: size }}
      >
        {/* microphone (SF "mic.fill"-like) */}
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          width={icon}
          height={icon}
          className="absolute"
          style={{
            opacity: listening ? 0 : 1,
            transform: listening ? 'scale(0.4)' : 'scale(1)',
            filter: listening ? 'blur(3px)' : 'none',
            transition: 'opacity 0.25s ease, transform 0.45s cubic-bezier(.34,1.56,.64,1), filter 0.25s ease',
          }}
        >
          <rect x="8.6" y="2" width="6.8" height="12.4" rx="3.4" fill="currentColor" />
          <path d="M5.4 11.1a6.6 6.6 0 0 0 13.2 0M12 17.8v3.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {/* waveform */}
        <span aria-hidden className="absolute flex items-center" style={{ gap: barW * 0.75, height: barH }}>
          {SHAPE.map((_, i) => (
            <span
              key={i}
              ref={(el) => {
                bars.current[i] = el;
              }}
              className="rounded-full bg-current"
              style={{
                width: barW,
                height: '100%',
                transform: 'scaleY(0.18)',
                opacity: listening ? 1 : 0,
                transition: `transform 90ms linear, opacity 0.25s ease ${listening ? 0.08 + Math.abs(i - 2) * 0.04 : 0}s`,
              }}
            />
          ))}
        </span>
      </button>
    </div>
  );
}
