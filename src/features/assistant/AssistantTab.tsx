import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUp } from 'lucide-react';
import { Header } from '@/components/Header';
import { useChatStore, type ChatMessage } from '@/store/useChatStore';
import { useUIStore } from '@/store/useUIStore';
import { haptic } from '@/lib/telegram';
import { aiStatus } from '@/lib/ai';
import { ChatBubble } from './ChatBubble';
import { handleUtterance } from './brain';
import { useSpeechRecognition } from './useSpeechRecognition';
import { VoiceOrb } from './VoiceOrb';

const SUGGESTIONS = ['Встреча завтра с 15 до 16', 'Смены с 9 до 21 по графику 2/2', 'Английский по вторникам в 19:00', 'Что у меня на неделе?'];

/** How long a completed action stays on screen before it dissolves. */
const DISMISS_AFTER = 6000;
const FADE_MS = 450;

/** Still waiting for the user (a question card or a pick-one list)? */
const isOpen = (m: ChatMessage) =>
  ['clarify', 'choose', 'confirm', 'move-ask'].includes(m.attachment?.type ?? '') && !(m.attachment as { state?: string }).state;

/** A finished action — fine to dissolve after a moment. Agenda/help/text answers stay until the next request. */
const isDone = (m: ChatMessage) =>
  ['event', 'task', 'undo', 'choose', 'clarify', 'confirm', 'move-ask'].includes(m.attachment?.type ?? '') && !isOpen(m);

/** On phones the on-screen keyboard needs the room — the orb steps aside while typing. */
const TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/**
 * Chat without history: the big voice orb is always there; above it only the current
 * exchange (your request + the answer). Completed actions dissolve after a few seconds.
 */
export function AssistantTab() {
  const messages = useChatStore((s) => s.messages);
  const push = useChatStore((s) => s.push);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [typing, setTyping] = useState(false);
  const ai = useSyncExternalStore(aiStatus.subscribe, aiStatus.get);
  const showToast = useUIStore((s) => s.showToast);
  const scroller = useRef<HTMLDivElement>(null);

  // The current exchange = the last user message and everything after it.
  const exchange = useMemo(() => {
    const i = messages.findLastIndex((m) => m.role === 'user');
    return i < 0 ? [] : messages.slice(i);
  }, [messages]);
  const exchangeId = exchange[0]?.id;

  // Opening the tab shows a clean screen — unless a question is still waiting for an answer.
  const [hiddenId, setHiddenId] = useState<string | undefined>(() => (exchange.some(isOpen) ? undefined : exchangeId));
  const [leaving, setLeaving] = useState(false);
  const visible = Boolean(exchangeId) && exchangeId !== hiddenId;

  const replies = exchange.slice(1);
  const settled = !thinking && replies.length > 0 && !replies.some(isOpen) && replies.some(isDone);

  useEffect(() => {
    if (!visible || !settled) return;
    const t1 = window.setTimeout(() => setLeaving(true), DISMISS_AFTER);
    const t2 = window.setTimeout(() => {
      setHiddenId(exchangeId);
      setLeaving(false);
    }, DISMISS_AFTER + FADE_MS);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [visible, settled, exchangeId, replies.length]);

  const submit = async (raw: string) => {
    const text = raw.trim();
    if (!text || thinking) return;
    setInput('');
    setLeaving(false);
    push({ role: 'user', text });
    setThinking(true);
    try {
      // A short pause so the reply reads as a response rather than a flash.
      const [answers] = await Promise.all([handleUtterance(text), new Promise((r) => setTimeout(r, 450))]);
      for (const reply of answers) push({ role: 'assistant', ...reply });
      const last = answers.at(-1)?.attachment?.type;
      haptic.notify(last === 'event' || last === 'task' ? 'success' : 'warning');
    } finally {
      setThinking(false);
    }
  };

  const speech = useSpeechRecognition({ onFinal: submit });
  const listening = speech.status === 'listening';

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, messages.at(-1)?.text, thinking]);

  const toggleMic = () => {
    haptic.impact(listening ? 'light' : 'medium');
    if (listening) speech.stop();
    else speech.start();
  };

  const showHero = !visible && !thinking && !listening;

  return (
    <div className="flex h-full flex-col">
      <Header
        title="Ассистент"
        subtitle={
          <button type="button" onClick={() => ai.detail && showToast(ai.detail)} className="flex items-center gap-1.5 transition-opacity active:opacity-50">
            <span
              className={`size-[7px] rounded-full ${
                ai.state === 'ok' ? 'bg-green' : ai.state === 'error' ? 'bg-red' : ai.state === 'off' ? 'bg-faint' : 'bg-faint/50'
              }`}
            />
            {ai.state === 'ok' ? 'GPT · онлайн' : ai.state === 'error' ? 'Офлайн-режим · ошибка AI' : ai.state === 'off' ? 'Офлайн-режим' : 'GPT'}
          </button>
        }
      />

      {/* current exchange (or the welcome) */}
      <div ref={scroller} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4">
        <div className="flex min-h-full flex-col justify-end gap-3 py-3">
          {showHero ? (
            <div key="hero" className="animate-fade-in flex flex-col items-center gap-5 pb-2 text-center">
              <div>
                <h2 className="text-[28px] font-bold leading-tight">Чем могу помочь?</h2>
                <p className="mt-2 text-[17px] leading-snug text-muted">
                  Скажите или напишите — я добавлю
                  <br />
                  событие или задачу и уточню детали.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submit(s)}
                    className="animate-fade-up rounded-full bg-surface px-4 py-2 text-[15px] transition-transform duration-300 ease-spring active:scale-95"
                    style={{ animationDelay: `${80 + i * 50}ms` }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div
              key={exchangeId ?? 'pending'}
              className="flex flex-col gap-3 transition-[opacity,transform,filter] ease-spring"
              style={{
                transitionDuration: `${FADE_MS}ms`,
                opacity: leaving ? 0 : 1,
                transform: leaving ? 'translateY(-12px) scale(0.98)' : 'none',
                filter: leaving ? 'blur(4px)' : 'none',
              }}
            >
              {visible && exchange.map((m) => <ChatBubble key={m.id} message={m} />)}
              {thinking && <Thinking />}
            </div>
          )}
        </div>
      </div>

      {/* always-available voice orb + text field */}
      <div className="pb-tabbar shrink-0 px-4">
        <div
          className="grid transition-[grid-template-rows,opacity,transform] duration-500 ease-spring"
          style={{
            gridTemplateRows: typing ? '0fr' : '1fr',
            opacity: typing ? 0 : 1,
            transform: typing ? 'scale(0.85) translateY(20px)' : 'none',
          }}
          aria-hidden={typing}
        >
          <div className="min-h-0 overflow-hidden">
        <div className="flex flex-col items-center gap-2 pb-3 pt-1">
          <VoiceOrb size={96} listening={listening} onPress={toggleMic} />
          <div className="flex min-h-6 items-center px-6 text-center">
            {listening ? (
              <p key="interim" className={`animate-fade-in max-w-full truncate text-[17px] ${speech.interim ? 'text-fg' : 'text-shimmer'}`}>
                {speech.interim || 'Слушаю…'}
              </p>
            ) : speech.error ? (
              <p className="text-[15px] text-red">{speech.error}</p>
            ) : (
              <p className="text-[13px] text-muted">{speech.supported ? 'Коснитесь, чтобы говорить' : 'Голос недоступен · демо-режим'}</p>
            )}
          </div>
        </div>
          </div>
        </div>
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
            onFocus={() => TOUCH && setTyping(true)}
            onBlur={() => setTyping(false)}
            placeholder="Или напишите…"
            enterKeyHint="send"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[17px] text-fg outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={!input.trim() || thinking}
            aria-label="Отправить"
            className={`grid shrink-0 place-items-center rounded-full bg-blue text-white transition-all duration-500 ease-spring active:scale-90 ${
              input.trim() ? 'size-[34px] opacity-100' : 'size-[34px] scale-50 opacity-0'
            }`}
          >
            <ArrowUp className="size-[19px]" strokeWidth={2.6} />
          </button>
        </form>
      </div>
    </div>
  );
}

/** "Думаю" with a spinning sparkle, a light sweep over the word and bouncing dots. */
function Thinking() {
  return (
    <div className="animate-fade-in flex items-center gap-2 pl-1" role="status" aria-label="Думаю">
      <svg viewBox="0 0 24 24" className="size-5 animate-[spin_2.4s_linear_infinite]" aria-hidden>
        <defs>
          <linearGradient id="think-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--ai-1)" />
            <stop offset="0.5" stopColor="var(--ai-2)" />
            <stop offset="1" stopColor="var(--ai-3)" />
          </linearGradient>
        </defs>
        <path d="M12 2.5c.5 4.6 2.9 7 9.5 9.5-6.6 2.5-9 4.9-9.5 9.5-.5-4.6-2.9-7-9.5-9.5 6.6-2.5 9-4.9 9.5-9.5Z" fill="url(#think-g)" />
      </svg>
      <span className="text-shimmer text-[17px] font-medium">Думаю</span>
      <span className="flex items-end gap-[3px] pb-[3px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-[5px] rounded-full bg-[var(--ai-2)]"
            style={{ animation: `think-dot 1.1s ease-in-out ${i * 0.16}s infinite` }}
          />
        ))}
      </span>
      <style>{'@keyframes think-dot{0%,80%,100%{transform:translateY(0);opacity:.35}40%{transform:translateY(-5px);opacity:1}}'}</style>
    </div>
  );
}
