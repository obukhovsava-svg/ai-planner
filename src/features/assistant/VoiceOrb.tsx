import { Mic } from 'lucide-react';

interface VoiceOrbProps {
  listening: boolean;
  /** Diameter in px. */
  size?: number;
  onPress(): void;
}

/**
 * Siri-style orb: soft colour blobs drifting inside a glass sphere.
 * Calm and slow when idle; brighter, faster and slightly larger while listening.
 */
export function VoiceOrb({ listening, size = 120, onPress }: VoiceOrbProps) {
  const icon = Math.round(size * 0.3);
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      {/* ambient glow */}
      <span
        className="pointer-events-none absolute rounded-full bg-[conic-gradient(from_90deg,var(--ai-1),var(--ai-2),var(--ai-3),var(--ai-1))] blur-2xl transition-[opacity,transform] duration-700 ease-spring"
        style={{
          width: size,
          height: size,
          opacity: listening ? 0.55 : 0.18,
          transform: `scale(${listening ? 1.35 : 1.05})`,
        }}
      />
      <button
        type="button"
        onClick={onPress}
        aria-label={listening ? 'Остановить запись' : 'Начать голосовой ввод'}
        aria-pressed={listening}
        className={`relative isolate overflow-hidden rounded-full [clip-path:circle(50%)] [-webkit-mask-image:-webkit-radial-gradient(white,black)] [transform:translateZ(0)] bg-white shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.6),0_10px_30px_-10px_rgb(91_140_255/0.5)] transition-transform duration-700 ease-spring active:scale-95 dark:bg-[#101018] ${
          listening ? 'scale-[1.08]' : 'animate-breathe'
        }`}
        style={{ width: size, height: size }}
      >
        {/* drifting colour blobs */}
        <span className={`absolute inset-0 ${listening ? 'animate-spin-slow' : ''}`}>
          <span
            className="absolute left-[15%] top-[10%] size-[70%] rounded-full bg-[var(--ai-1)] opacity-80 blur-[18px]"
            style={{ animation: `blob-a ${listening ? 3.2 : 9}s ease-in-out infinite` }}
          />
          <span
            className="absolute bottom-[8%] right-[10%] size-[65%] rounded-full bg-[var(--ai-3)] opacity-75 blur-[18px]"
            style={{ animation: `blob-b ${listening ? 3.8 : 11}s ease-in-out infinite` }}
          />
          <span
            className="absolute left-[25%] top-[30%] size-[55%] rounded-full bg-[var(--ai-2)] opacity-70 blur-[16px]"
            style={{ animation: `blob-c ${listening ? 2.8 : 8}s ease-in-out infinite` }}
          />
        </span>
        {/* glass highlight */}
        <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_35%_22%,rgb(255_255_255/0.55),transparent_45%)]" />
        <span className="absolute inset-0 rounded-full shadow-[inset_0_-8px_20px_rgb(0_0_0/0.08),inset_0_0_0_1px_rgb(255_255_255/0.25)]" />
        {/* glyph */}
        <span className="absolute inset-0 grid place-items-center text-white drop-shadow-[0_1px_4px_rgb(0_0_0/0.25)]">
          {listening ? (
            <Bars size={icon} />
          ) : (
            <Mic style={{ width: icon, height: icon }} strokeWidth={2.2} />
          )}
        </span>
      </button>
    </div>
  );
}

/** Five rounded bars that pulse while listening. */
function Bars({ size }: { size: number }) {
  return (
    <span className="flex items-center gap-[3px]" style={{ height: size }} aria-hidden>
      {[0.5, 0.85, 1, 0.75, 0.45].map((h, i) => (
        <span
          key={i}
          className="w-[3.5px] rounded-full bg-white"
          style={{
            height: `${h * 100}%`,
            animation: `voice-bar 0.9s ease-in-out ${i * 0.11}s infinite alternate`,
          }}
        />
      ))}
      <style>{'@keyframes voice-bar{from{transform:scaleY(.35)}to{transform:scaleY(1)}}'}</style>
    </span>
  );
}
