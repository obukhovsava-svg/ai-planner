import { useCallback, useEffect, useRef, useState } from 'react';
import { isNative, postNative } from '@/lib/native';

/* Minimal typings — the Web Speech API is not in lib.dom for all TS versions. */
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const DEMO_PHRASES = [
  'Поставить встречу на завтра в 15:00',
  'Добавь задачу купить продукты в субботу',
  'Созвон с командой во вторник с 10 до 11',
  'Напомни позвонить маме послезавтра вечером',
  'Тренировка в пятницу в 7 вечера на полтора часа',
];

export type SpeechStatus = 'idle' | 'listening' | 'error';

interface Options {
  /** Called with the final transcript when the user stops talking. */
  onFinal(text: string): void;
}

/**
 * Speech-to-text via the Web Speech API (ru-RU).
 * Where the API is missing (many in-app WebViews), falls back to a simulated
 * recording that "transcribes" a sample phrase, so the full flow stays testable.
 */
export function useSpeechRecognition({ onFinal }: Options) {
  const Ctor = getRecognitionCtor();
  const native = isNative();
  const supported = native || Boolean(Ctor);
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const finalText = useRef('');
  const demoTimer = useRef<number[]>([]);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const clearDemo = () => {
    demoTimer.current.forEach(window.clearTimeout);
    demoTimer.current = [];
  };

  const stop = useCallback(() => {
    if (native) {
      postNative({ type: 'speech', action: 'stop' });
      return;
    }
    if (rec.current) {
      rec.current.stop();
      return;
    }
    // Demo mode: finish immediately with whatever was "heard".
    clearDemo();
    const text = finalText.current.trim();
    finalText.current = '';
    setInterim('');
    setStatus('idle');
    if (text) onFinalRef.current(text);
  }, [native]);

  const startDemo = useCallback(() => {
    const phrase = DEMO_PHRASES[Math.floor(Math.random() * DEMO_PHRASES.length)];
    const words = phrase.split(' ');
    finalText.current = '';
    setStatus('listening');
    words.forEach((_, i) => {
      demoTimer.current.push(
        window.setTimeout(() => {
          finalText.current = words.slice(0, i + 1).join(' ');
          setInterim(finalText.current);
        }, 600 + i * 260),
      );
    });
    demoTimer.current.push(window.setTimeout(stop, 600 + words.length * 260 + 700));
  }, [stop]);

  const start = useCallback(() => {
    setError(null);
    setInterim('');
    finalText.current = '';
    // iOS app: Apple's on-device speech recognition through the bridge.
    if (native) {
      window.__plannerSpeech = (e) => {
        if (e.type === 'interim') setInterim(e.text);
        else if (e.type === 'final') {
          setInterim('');
          setStatus('idle');
          if (e.text.trim()) onFinalRef.current(e.text.trim());
        } else if (e.type === 'error') {
          setError(e.message);
          setStatus('error');
        } else {
          setInterim('');
          setStatus((s) => (s === 'error' ? s : 'idle'));
        }
      };
      setStatus('listening');
      postNative({ type: 'speech', action: 'start' });
      return;
    }
    if (!Ctor) {
      startDemo();
      return;
    }
    const r = new Ctor();
    r.lang = 'ru-RU';
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      finalText.current = text;
      setInterim(text);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setError(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Нет доступа к микрофону'
          : 'Не удалось распознать речь',
      );
      setStatus('error');
    };
    r.onend = () => {
      rec.current = null;
      const text = finalText.current.trim();
      finalText.current = '';
      setInterim('');
      setStatus((s) => (s === 'error' ? s : 'idle'));
      if (text) onFinalRef.current(text);
    };
    rec.current = r;
    try {
      r.start();
      setStatus('listening');
    } catch {
      rec.current = null;
      setStatus('error');
      setError('Микрофон занят');
    }
  }, [Ctor, native, startDemo]);

  useEffect(
    () => () => {
      clearDemo();
      rec.current?.abort();
      if (isNative()) postNative({ type: 'speech', action: 'cancel' });
    },
    [],
  );

  return { supported, status, interim, error, start, stop };
}
