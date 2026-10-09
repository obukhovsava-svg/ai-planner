import { forwardRef, useEffect, useRef } from 'react';

interface VoiceOrbProps {
  listening: boolean;
  /** Diameter in px (changes animate). */
  size?: number;
  /** Mic loudness 0…1 while listening (the iOS app sends it); without it the bars move on their own. */
  level?: { current: number | undefined };
  onPress(): void;
}

/** Bar shape at rest, centre tallest — like the waveform in Voice Memos. */
const SHAPE = [0.42, 0.7, 1, 0.7, 0.42];
const SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const BOUNCE = 'cubic-bezier(0.34, 1.4, 0.64, 1)';

/** SF "mic.fill"-like glyph. */
export function MicGlyph({ size }: { size: number }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width={size} height={size}>
      <rect x="8.6" y="2" width="6.8" height="12.4" rx="3.4" fill="currentColor" />
      <path d="M5.4 11.1a6.6 6.6 0 0 0 13.2 0M12 17.8v3.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The record button: one solid colour (the theme's text colour), the microphone and the
 * waveform cut out of it in the background colour. Idle shows the mic; while listening the mic
 * gives way to five bars that follow the voice, and a soft halo breathes with the loudness.
 * Everything moves with transform / opacity only, eased every frame — no layout, no blur.
 */
export const VoiceOrb = forwardRef<HTMLButtonElement, VoiceOrbProps>(function VoiceOrb({ listening, size = 92, level, onPress }, ref) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const halo = useRef<HTMLSpanElement>(null);
  const fallback = useRef<number | undefined>(undefined);
  const levelRef = level ?? fallback;

  // Bars and halo follow the voice at display rate, eased towards their target every frame,
  // and ease back to rest after listening stops (no jumps either way).
  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    let haloScale = Number(halo.current?.dataset.s ?? 0.86);
    const heights = SHAPE.map(() => 0.18);
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const target = listening
        ? (levelRef.current ?? 0.35 + 0.3 * Math.sin(t * 5.3) * Math.sin(t * 1.7 + 1) + 0.15 * Math.sin(t * 11.1))
        : 0;
      smooth += (Math.max(0, Math.min(1, target)) - smooth) * 0.18;
      let settled = !listening;
      bars.current.forEach((b, i) => {
        if (!b) return;
        const wobble = 0.85 + 0.15 * Math.sin(t * (6 + i * 1.1) + i * 1.9);
        const goal = listening ? 0.2 + 0.8 * Math.min(1, SHAPE[i] * (0.3 + smooth * 1.05) * wobble) : 0.18;
        heights[i] += (goal - heights[i]) * 0.22;
        if (Math.abs(goal - heights[i]) > 0.002) settled = false;
        b.style.transform = `scaleY(${heights[i].toFixed(4)})`;
      });
      const hGoal = listening ? 1.1 + smooth * 0.3 : 0.86;
      haloScale += (hGoal - haloScale) * 0.12;
      if (Math.abs(hGoal - haloScale) > 0.002) settled = false;
      if (halo.current) {
        halo.current.style.transform = `scale(${haloScale.toFixed(4)})`;
        halo.current.dataset.s = String(haloScale);
      }
      if (!settled) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [listening, levelRef]);

  const icon = size * 0.36;
  const barW = Math.max(3, size * 0.058);
  const barH = size * 0.38;

  return (
    <div className="orb-in relative grid place-items-center" style={{ width: size * 1.5, height: size * 1.5 }}>
      {/* halo: the same colour, faint, breathing with the voice */}
      <span
        ref={halo}
        aria-hidden
        className="pointer-events-none absolute rounded-full bg-fg will-change-transform"
        style={{ width: size, height: size, opacity: listening ? 0.1 : 0, transform: 'scale(0.86)', transition: 'opacity 0.5s ease' }}
      />
      <button
        ref={ref}
        type="button"
        onClick={onPress}
        aria-label={listening ? 'Остановить запись' : 'Начать голосовой ввод'}
        aria-pressed={listening}
        className="relative grid place-items-center rounded-full bg-fg text-bg shadow-[0_8px_24px_-8px_rgb(0_0_0/0.35)] outline-none [-webkit-tap-highlight-color:transparent] active:scale-[0.92]"
        style={{ width: size, height: size, transition: `transform 0.45s ${BOUNCE}, width 0.6s ${SPRING}, height 0.6s ${SPRING}` }}
      >
        <span
          className="absolute grid place-items-center will-change-transform"
          style={{
            opacity: listening ? 0 : 1,
            transform: listening ? 'scale(0.5)' : 'scale(1)',
            transition: listening ? `opacity 0.18s ease, transform 0.3s ${SPRING}` : `opacity 0.3s ease 0.12s, transform 0.5s ${BOUNCE} 0.08s`,
          }}
        >
          <MicGlyph size={icon} />
        </span>
        <span aria-hidden className="absolute flex items-center" style={{ gap: barW * 0.75, height: barH }}>
          {SHAPE.map((_, i) => (
            <span
              key={i}
              ref={(el) => {
                bars.current[i] = el;
              }}
              className="rounded-full bg-current will-change-transform"
              style={{
                width: barW,
                height: '100%',
                transform: 'scaleY(0.18)',
                opacity: listening ? 1 : 0,
                transition: `opacity ${listening ? 0.3 : 0.2}s ease ${listening ? 0.06 + Math.abs(i - 2) * 0.035 : 0}s`,
              }}
            />
          ))}
        </span>
      </button>
    </div>
  );
});
