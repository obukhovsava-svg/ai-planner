import { Mic, Square } from 'lucide-react';

interface VoiceButtonProps {
  listening: boolean;
  compact?: boolean;
  onPress(): void;
}

/** Large circular mic button with a Gemini blue/red neon aura while listening. */
export function VoiceButton({ listening, compact, onPress }: VoiceButtonProps) {
  const size = compact ? 'size-16' : 'size-24';
  return (
    <div className={`relative grid place-items-center ${compact ? 'size-20' : 'size-36'}`}>
      {/* rotating blurred aura */}
      <span
        className={`absolute ${size} rounded-full bg-[conic-gradient(from_0deg,#2563EB,#38BDF8,#F87171,#EF4444,#2563EB)] blur-xl transition-opacity duration-500 ${
          listening ? 'animate-aura opacity-90' : 'opacity-25'
        }`}
      />
      {/* expanding rings */}
      {listening && (
        <>
          <span className={`animate-ring absolute ${size} rounded-full border-2 border-sky/70`} />
          <span className={`animate-ring absolute ${size} rounded-full border-2 border-coral/70 [animation-delay:0.8s]`} />
        </>
      )}
      <button
        type="button"
        onClick={onPress}
        aria-label={listening ? 'Остановить запись' : 'Начать голосовой ввод'}
        aria-pressed={listening}
        className={`relative grid ${size} place-items-center rounded-full bg-gemini text-white shadow-2xl ring-4 ring-white/20 transition-transform duration-200 active:scale-90 ${
          listening ? 'scale-105' : ''
        }`}
      >
        {listening ? (
          <Square className={compact ? 'size-5' : 'size-7'} fill="currentColor" />
        ) : (
          <Mic className={compact ? 'size-7' : 'size-10'} strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

/** Animated bars shown while recording. */
export function Waveform() {
  return (
    <div className="flex h-6 items-center gap-[3px]" aria-hidden>
      {Array.from({ length: 18 }, (_, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-gemini"
          style={{
            height: '100%',
            animation: `wave 0.9s ease-in-out ${(i % 6) * 0.12}s infinite alternate`,
            transformOrigin: 'center',
          }}
        />
      ))}
      <style>{'@keyframes wave{from{transform:scaleY(.2)}to{transform:scaleY(1)}}'}</style>
    </div>
  );
}
