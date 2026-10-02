import { useEffect, useRef, useState } from 'react';
import { ArrowUp, RotateCcw } from 'lucide-react';
import { Header, IconButton } from '@/components/Header';
import { useChatStore } from '@/store/useChatStore';
import { haptic } from '@/lib/telegram';
import { ChatBubble } from './ChatBubble';
import { handleUtterance } from './interpreter';
import { useSpeechRecognition } from './useSpeechRecognition';
import { VoiceButton, Waveform } from './VoiceButton';

const SUGGESTIONS = [
  'Встреча завтра в 15:00',
  'Купить продукты в субботу',
  'Что у меня сегодня?',
  'Созвон во вторник с 10 до 11',
];

export function AssistantTab() {
  const messages = useChatStore((s) => s.messages);
  const push = useChatStore((s) => s.push);
  const clear = useChatStore((s) => s.clear);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const submit = async (raw: string) => {
    const text = raw.trim();
    if (!text || thinking) return;
    setInput('');
    push({ role: 'user', text });
    setThinking(true);
    try {
      // Small delay so the reply feels like a response, not a flash.
      const [reply] = await Promise.all([handleUtterance(text), new Promise((r) => setTimeout(r, 350))]);
      push({ role: 'assistant', ...reply });
      haptic.notify(reply.attachment && reply.attachment.type !== 'agenda' ? 'success' : 'warning');
    } finally {
      setThinking(false);
    }
  };

  const speech = useSpeechRecognition({ onFinal: submit });
  const listening = speech.status === 'listening';

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, thinking, speech.interim]);

  const toggleMic = () => {
    haptic.impact(listening ? 'light' : 'medium');
    if (listening) speech.stop();
    else speech.start();
  };

  const empty = messages.length === 0;

  return (
    <div className="flex h-full flex-col">
      <Header
        title={<span className="text-gemini">AI Ассистент</span>}
        subtitle="Голос → план"
        actions={
          !empty && (
            <IconButton label="Очистить чат" onClick={() => { haptic.impact('light'); clear(); }}>
              <RotateCcw className="size-[18px]" />
            </IconButton>
          )
        }
      />

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4">
        {empty ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-6 py-6 text-center">
            <div className="animate-fade-up">
              <h2 className="text-gemini text-[32px] font-bold leading-tight tracking-tight">Чем могу помочь?</h2>
              <p className="mt-2 text-[15px] text-muted">
                Скажите или напишите — я добавлю
                <br />
                событие в календарь или задачу в список.
              </p>
            </div>
            <VoiceButton listening={listening} onPress={toggleMic} />
            <div className="min-h-12">
              {listening ? (
                <div className="flex flex-col items-center gap-2">
                  <Waveform />
                  <p className="text-[15px] font-medium">{speech.interim || 'Слушаю…'}</p>
                </div>
              ) : (
                <p className="text-xs text-faint">
                  {speech.supported ? 'Нажмите на микрофон и говорите' : 'Распознавание речи недоступно — демо-режим'}
                </p>
              )}
              {speech.error && <p className="mt-1 text-xs text-red">{speech.error}</p>}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className="animate-fade-up rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium shadow-card active:scale-95"
                  style={{ animationDelay: `${120 + i * 60}ms` }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-4">
            {messages.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))}
            {thinking && (
              <div className="flex items-center gap-1.5 pl-10" aria-label="Думаю">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-2 animate-bounce rounded-full bg-gemini" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            )}
            {listening && (
              <div className="animate-fade-up flex justify-end">
                <p className="max-w-[80%] rounded-[20px] rounded-br-md border border-dashed border-blue/50 px-4 py-2.5 text-[15px] text-muted">
                  {speech.interim || 'Слушаю…'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="pb-tabbar shrink-0 px-4 pt-2">
        {!empty && (
          <div className="mb-1 flex flex-col items-center">
            <VoiceButton compact listening={listening} onPress={toggleMic} />
            {speech.error && <p className="text-xs text-red">{speech.error}</p>}
          </div>
        )}
        <form
          className="flex items-center gap-2 rounded-full border border-line bg-surface p-1.5 pl-4 shadow-card focus-within:border-blue"
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Например: обед с Аней в пятницу в 13"
            enterKeyHint="send"
            className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-faint"
          />
          <button
            type="submit"
            disabled={!input.trim() || thinking}
            aria-label="Отправить"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-gemini text-white transition active:scale-90 disabled:opacity-30"
          >
            <ArrowUp className="size-5" strokeWidth={2.5} />
          </button>
        </form>
      </div>
    </div>
  );
}
