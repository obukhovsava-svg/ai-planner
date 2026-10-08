import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
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

/** How long a completed action stays on screen before it dissolves. */
const DISMISS_AFTER = 6000;
const FADE_MS = 450;

/** Still waiting for the user (a question card or a pick-one list)? */
const isOpen = (m: ChatMessage) =>
  ['clarify', 'choose', 'confirm', 'move-ask', 'remind-ask'].includes(m.attachment?.type ?? '') && !(m.attachment as { state?: string }).state;

/** A finished action — fine to dissolve after a moment. Agenda/help/text answers stay until the next request. */
const isDone = (m: ChatMessage) =>
  ['event', 'task', 'undo', 'choose', 'clarify', 'confirm', 'move-ask', 'remind-ask'].includes(m.attachment?.type ?? '') && !isOpen(m);

/** On phones the on-screen keyboard needs the room — the orb steps aside while typing. */
const TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** One request with its answers. */
interface Exchange {
  id: string;
  messages: ChatMessage[];
  open: boolean;
}

/**
 * Chat without history: the big voice orb is always there; below it the current exchange and
 * every question still waiting for an answer (e.g. several from the iPhone command).
 * Completed actions dissolve after a few seconds.
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

  const exchanges = useMemo(() => {
    const out: Exchange[] = [];
    for (const m of messages) {
      if (m.role === 'user') out.push({ id: m.id, messages: [m], open: false });
      else out.at(-1)?.messages.push(m);
    }
    for (const e of out) e.open = e.messages.some(isOpen);
    return out;
  }, [messages]);
  const lastId = exchanges.at(-1)?.id;

  // Opening the tab shows a clean screen — except questions still waiting for an answer.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(exchanges.filter((e) => !e.open).map((e) => e.id)));
  const hide = (id: string) => setHidden((h) => new Set(h).add(id));
  const shown = exchanges.filter((e) => !hidden.has(e.id));
  const visible = shown.length > 0;

  const submit = async (raw: string) => {
    const text = raw.trim();
    if (!text || thinking) return;
    setInput('');
    // A new request clears finished answers (agenda, text); open questions stay.
    setHidden((h) => new Set([...h, ...exchanges.filter((e) => !e.open).map((e) => e.id)]));
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

  // The hero stays while listening, so the orb doesn't move when tapped.
  const showHero = !visible && !thinking;

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

      {/* Idle: welcome + orb in the middle. With a conversation the orb moves to the top
          and the messages scroll below it. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="transition-[flex-grow] duration-700 ease-spring" style={{ flexGrow: showHero ? 1 : 0 }} />

        <Collapse open={showHero}>
          <div className="animate-fade-in px-4 pb-2 text-center">
            <h2 className="text-[28px] font-bold leading-tight">Чем могу помочь?</h2>
            <p className="mt-2 text-[17px] leading-snug text-muted">
              Скажите или напишите — я добавлю
              <br />
              событие или задачу и уточню детали.
            </p>
          </div>
        </Collapse>

        {/* voice orb — steps aside while the keyboard is up */}
        <Collapse open={!typing}>
          <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
            <VoiceOrb size={showHero ? 92 : 72} listening={listening} level={speech.level} visible={!typing} onPress={toggleMic} />
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
        </Collapse>

        <div
          ref={scroller}
          className="no-scrollbar min-h-0 overflow-y-auto px-4 transition-[flex-grow] duration-700 ease-spring"
          style={{ flexGrow: showHero ? 0 : 1, flexBasis: 0 }}
        >
          <div className="flex flex-col gap-3 py-3">
            {shown.map((e) => (
              <ExchangeView key={e.id} exchange={e} settled={!e.open && (e.id !== lastId || !thinking)} onGone={() => hide(e.id)} />
            ))}
            {thinking && <Thinking />}
          </div>
        </div>

        <div className="transition-[flex-grow] duration-700 ease-spring" style={{ flexGrow: showHero ? 1 : 0 }} />
      </div>

      {/* text field — steps aside while listening */}
      <div className="pb-tabbar shrink-0 px-4">
        <div
          className="transition-[opacity,transform] duration-500 ease-spring"
          style={{ opacity: listening ? 0 : 1, transform: listening ? 'translateY(12px) scale(0.97)' : 'none', pointerEvents: listening ? 'none' : undefined }}
          aria-hidden={listening}
        >
          <form
            className="mt-2 flex items-center gap-2 rounded-full bg-surface py-1 pl-4 pr-1 shadow-[0_0_0_0.5px_var(--line)]"
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
              tabIndex={listening ? -1 : 0}
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
    </div>
  );
}

/** One exchange; a finished action dissolves after a few seconds, open questions stay. */
function ExchangeView({ exchange, settled, onGone }: { exchange: Exchange; settled: boolean; onGone(): void }) {
  const [leaving, setLeaving] = useState(false);
  const replies = exchange.messages.slice(1);
  const done = settled && replies.length > 0 && replies.some(isDone);
  useEffect(() => {
    if (!done) return;
    const t1 = window.setTimeout(() => setLeaving(true), DISMISS_AFTER);
    const t2 = window.setTimeout(onGone, DISMISS_AFTER + FADE_MS);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      setLeaving(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, replies.length]);
  return (
    <div
      className="animate-fade-in flex flex-col gap-3 transition-[opacity,transform,filter] ease-spring"
      style={{
        transitionDuration: `${FADE_MS}ms`,
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'translateY(-12px) scale(0.98)' : 'none',
        filter: leaving ? 'blur(4px)' : 'none',
      }}
    >
      {exchange.messages.map((m) => (
        <ChatBubble key={m.id} message={m} />
      ))}
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

/**
 * Smoothly hides / shows its content. Hiding: fade out first, then release the space;
 * showing: take the space first, then fade in — so a clipped edge is never visible.
 * Uses max-height (animatable everywhere, incl. older iOS WebViews).
 */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.scrollHeight));
    ro.observe(el);
    setH(el.scrollHeight);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      aria-hidden={!open}
      style={{
        maxHeight: open ? (h ?? 'none') : 0,
        opacity: open ? 1 : 0,
        overflow: 'hidden',
        pointerEvents: open ? undefined : 'none',
        transition: open
          ? 'max-height 0.42s var(--spring), opacity 0.35s ease 0.18s'
          : 'opacity 0.22s ease, max-height 0.42s var(--spring) 0.16s',
      }}
    >
      <div ref={inner}>{children}</div>
    </div>
  );
}
