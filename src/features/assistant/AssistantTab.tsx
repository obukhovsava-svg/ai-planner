import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, SquarePen } from 'lucide-react';
import { Header, IconButton } from '@/components/Header';
import { useChatStore } from '@/store/useChatStore';
import { haptic } from '@/lib/telegram';
import { ChatBubble } from './ChatBubble';
import { handleUtterance } from './interpreter';
import { useSpeechRecognition } from './useSpeechRecognition';
import { VoiceOrb } from './VoiceOrb';

const SUGGESTIONS = ['Встреча завтра в 15:00', 'Купить продукты в субботу', 'Что у меня сегодня?', 'Созвон во вторник с 10 до 11'];

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
      // A short pause so the reply reads as a response rather than a flash.
      const [reply] = await Promise.all([handleUtterance(text), new Promise((r) => setTimeout(r, 450))]);
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
        title="Ассистент"
        actions={
          !empty && (
            <IconButton
              label="Новый диалог"
              onClick={() => {
                haptic.impact('light');
                clear();
              }}
            >
              <SquarePen className="size-[17px]" strokeWidth={2.2} />
            </IconButton>
          )
        }
      />

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4">
        {empty ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-8 pb-4 text-center">
            <div className="animate-fade-up">
              <h2 className="text-[28px] font-bold leading-tight tracking-[0.005em]">Чем могу помочь?</h2>
              <p className="mt-2 text-[17px] leading-snug text-muted">
                Скажите или напишите — я добавлю
                <br />
                событие в календарь или задачу.
              </p>
            </div>

            <div className="animate-fade-up [animation-delay:80ms]">
              <VoiceOrb listening={listening} onPress={toggleMic} />
            </div>

            <div className="flex min-h-11 flex-col items-center justify-center px-6">
              {listening ? (
                <p key="interim" className={`animate-fade-in text-[17px] ${speech.interim ? 'text-fg' : 'text-shimmer'}`}>
                  {speech.interim || 'Слушаю…'}
                </p>
              ) : speech.error ? (
                <p className="text-[15px] text-red">{speech.error}</p>
              ) : (
                <p className="text-[13px] text-muted">
                  {speech.supported ? 'Коснитесь, чтобы говорить' : 'Распознавание речи недоступно · демо-режим'}
                </p>
              )}
            </div>

            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className="animate-fade-up rounded-full bg-surface px-4 py-2 text-[15px] transition-transform duration-300 ease-spring active:scale-95"
                  style={{ animationDelay: `${160 + i * 50}ms` }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 py-4">
            {messages.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))}
            {thinking && <p className="text-shimmer animate-fade-in pl-1 text-[17px]">Думаю…</p>}
          </div>
        )}
      </div>

      <div className="pb-tabbar shrink-0 px-4 pt-2">
        {!empty && listening && (
          <div className="animate-fade-up mb-3 flex flex-col items-center gap-3">
            <VoiceOrb size={72} listening onPress={toggleMic} />
            <p className={`max-w-full truncate text-[17px] ${speech.interim ? 'text-fg' : 'text-shimmer'}`}>{speech.interim || 'Слушаю…'}</p>
          </div>
        )}
        {!empty && speech.error && <p className="mb-2 text-center text-[13px] text-red">{speech.error}</p>}
        <form
          className="flex items-center gap-2 rounded-full bg-surface py-1 pl-4 pr-1 shadow-[0_0_0_0.5px_var(--line)]"
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Спросите что-нибудь"
            enterKeyHint="send"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[17px] text-fg outline-none placeholder:text-muted"
          />
          {input.trim() ? (
            <button
              key="send"
              type="submit"
              disabled={thinking}
              aria-label="Отправить"
              className="animate-fade-in grid size-[34px] shrink-0 place-items-center rounded-full bg-blue text-white transition-transform duration-300 ease-spring active:scale-90 disabled:opacity-40"
            >
              <ArrowUp className="size-[19px]" strokeWidth={2.6} />
            </button>
          ) : (
            <button
              key="mic"
              type="button"
              onClick={toggleMic}
              aria-label={listening ? 'Остановить запись' : 'Голосовой ввод'}
              className={`animate-fade-in grid size-[34px] shrink-0 place-items-center rounded-full transition-all duration-300 ease-spring active:scale-90 ${
                listening ? 'bg-red text-white' : 'text-muted'
              }`}
            >
              <Mic className="size-[20px]" strokeWidth={2} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
