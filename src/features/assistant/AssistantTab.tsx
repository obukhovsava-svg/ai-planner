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
import { MicGlyph, VoiceOrb } from './VoiceOrb';

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
  // The orb ↔ glow morph when the keyboard comes and goes (see spread / gather below).
  const root = useRef<HTMLDivElement>(null);
  const inputBox = useRef<HTMLDivElement>(null);
  const orbBtn = useRef<HTMLButtonElement>(null);
  const orbWrap = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);

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

  /**
   * Keyboard up: the orb holds still while the keyboard slides in, then melts down into a thin
   * glowing line right above the field, a highlight running across it (Gemini-style).
   * Keyboard down: the line rides down with the field; once the keyboard and the tab bar are back,
   * it gathers into the orb in one move. Drawn by an overlay (transform / opacity only) anchored to
   * the top of the tab, which never moves — so the layout can switch underneath without janky frames.
   */
  const SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)';
  const melted = useRef(false);
  const cancelMorph = () =>
    [ghost.current, ghost.current?.children[0], ghost.current?.children[1], band.current, band.current?.firstElementChild, orbWrap.current].forEach((el) =>
      (el as HTMLElement | null | undefined)?.getAnimations().forEach((a) => a.cancel()),
    );
  /** Rect of `el` relative to the tab. */
  const rel = (el: Element) => {
    const r = el.getBoundingClientRect(), b = root.current!.getBoundingClientRect();
    return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
  };
  /** Where the glowing line sits: just above the text field. */
  const line = () => {
    const f = rel(inputBox.current!);
    return { x: 20, y: f.y - 4, w: f.w - 40, h: 8 };
  };
  const placeBand = () => {
    const l = line();
    Object.assign(band.current!.style, { left: `${l.x}px`, top: `${l.y}px`, width: `${l.w}px`, height: `${l.h}px` });
    return l;
  };
  /** The double takes the orb's exact place (solid, mic glyph), standing still. */
  const hold = () => {
    const btn = orbBtn.current, g = ghost.current;
    if (!btn || !g || !root.current) return false;
    const o = rel(btn);
    if (!o.w) return false;
    cancelMorph();
    Object.assign(g.style, { left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px`, opacity: '1', transform: 'none' });
    (g.children[0] as HTMLElement).style.opacity = '1';
    (g.children[1] as HTMLElement).style.opacity = '0';
    return true;
  };
  /** Ghost box → line: translate + scale between the two centres. */
  const toLine = (l: ReturnType<typeof line>) => {
    const g = ghost.current!;
    const o = { x: g.offsetLeft, y: g.offsetTop, w: g.offsetWidth, h: g.offsetHeight };
    return `translate(${l.x + l.w / 2 - (o.x + o.w / 2)}px, ${l.y + l.h / 2 - (o.y + o.h / 2)}px) scale(${l.w / o.w}, ${l.h / o.h})`;
  };
  const melt = () => {
    const g = ghost.current, b = band.current;
    if (!g || !b || !inputBox.current) return;
    melted.current = true;
    const l = placeBand();
    const end = toLine(l);
    const fill = 'forwards' as const;
    g.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: 'scale(1.08, 0.9)', opacity: 1, offset: 0.18 },
        { transform: end, opacity: 0 },
      ],
      { duration: 620, easing: SPRING, fill },
    );
    (g.children[0] as HTMLElement).animate([{ opacity: 1 }, { opacity: 1, offset: 0.15 }, { opacity: 0, offset: 0.55 }, { opacity: 0 }], { duration: 620, fill });
    (g.children[1] as HTMLElement).animate([{ opacity: 0 }, { opacity: 1, offset: 0.45 }, { opacity: 1 }], { duration: 620, fill });
    b.animate(
      [
        { opacity: 0, transform: 'scaleX(0.35)' },
        { opacity: 1, transform: 'scaleX(1.02)', offset: 0.55 },
        { opacity: 0.6, transform: 'scaleX(1)' },
      ],
      { duration: 900, delay: 260, easing: SPRING, fill },
    );
    (b.firstElementChild as HTMLElement).animate(
      [{ transform: 'translateX(-120%)', opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: `translateX(${l.w * 1.1}px)`, opacity: 0 }],
      { duration: 900, delay: 460, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill },
    );
  };
  /**
   * Runs `cb` once the screen has stopped moving: the keyboard has finished sliding and the
   * tab bar is back (the field's position and the viewport height hold still for a moment).
   * `frame` runs on every frame until then.
   */
  const pending = useRef<() => void>(() => {});
  const whenSettled = (min: number, cb: () => void, frame?: () => void) => {
    pending.current();
    const start = performance.now();
    let last = '';
    let still = start;
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      frame?.();
      const pos = `${window.visualViewport?.height ?? innerHeight}:${Math.round(inputBox.current?.getBoundingClientRect().top ?? 0)}`;
      if (pos !== last) {
        last = pos;
        still = now;
      }
      if ((now - start >= min && now - still >= 120) || now - start > 1000) {
        pending.current = () => {};
        cb();
      } else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    pending.current = () => cancelAnimationFrame(raf);
  };
  useEffect(() => () => pending.current(), []);
  const onFieldFocus = () => {
    if (!TOUCH || !hold()) return;
    melted.current = false;
    setTyping(true); // the layout makes room at once; the double keeps the orb's place
    whenSettled(150, melt);
  };
  const onFieldBlur = () => {
    if (!TOUCH) return;
    // The line follows the field down while the keyboard leaves and the tab bar returns.
    whenSettled(220, () => setTyping(false), () => melted.current && band.current && inputBox.current && placeBand());
  };
  const wasTyping = useRef(false);
  useLayoutEffect(() => {
    if (typing || !wasTyping.current) {
      wasTyping.current = typing;
      return;
    }
    wasTyping.current = false;
    // Everything has settled; the orb is back in the layout (hidden) — the line gathers into it.
    const g = ghost.current, b = band.current, w = orbWrap.current, btn = orbBtn.current;
    if (!g || !b || !w || !btn) return;
    const fill = 'forwards' as const;
    const wasMelted = melted.current;
    melted.current = false;
    cancelMorph();
    const o = rel(btn);
    Object.assign(g.style, { left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px`, opacity: '0', transform: 'none' });
    w.style.opacity = '0';
    const show = () => {
      w.style.opacity = '';
      g.style.opacity = '0';
      [g, g.children[0], g.children[1]].forEach((el) => (el as HTMLElement).getAnimations().forEach((a) => a.cancel()));
    };
    if (!wasMelted) {
      // Closed before it melted: the orb simply fades back in its place.
      w.animate([{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: SPRING }).finished.then(show, show);
      return;
    }
    const from = toLine({ x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight });
    b.animate([{ opacity: 0.6, transform: 'scaleX(1)' }, { opacity: 0, transform: 'scaleX(0.3)' }], { duration: 300, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill });
    g.animate(
      [
        { transform: from, opacity: 0 },
        { transform: 'scale(0.94, 1.06)', opacity: 1, offset: 0.72 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 640, easing: SPRING, fill },
    ).finished.then(show, show);
    (g.children[0] as HTMLElement).animate([{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], { duration: 640, fill });
    (g.children[1] as HTMLElement).animate([{ opacity: 1 }, { opacity: 1, offset: 0.45 }, { opacity: 0 }], { duration: 640, fill });
  }, [typing]);

  // The hero stays while listening, so the orb doesn't move when tapped.
  const showHero = !visible && !thinking;

  return (
    <div ref={root} className="relative flex h-full flex-col">
      {/* morph overlay: the orb's double and the glow band */}
      <div ref={ghost} aria-hidden className="pointer-events-none absolute z-30 origin-center will-change-transform" style={{ opacity: 0, left: 0, top: 0 }}>
        <div className="absolute inset-0 grid place-items-center rounded-full bg-fg text-bg">
          <MicGlyph size={33} />
        </div>
        <div
          className="absolute inset-0 rounded-full opacity-0"
          style={{ background: 'radial-gradient(closest-side, var(--ai-2), var(--ai-1) 60%, transparent)', filter: 'blur(4px)' }}
        />
      </div>
      <div ref={band} aria-hidden className="pointer-events-none absolute z-40 overflow-hidden rounded-full will-change-transform" style={{ opacity: 0 }}>
        <div className="absolute inset-y-0 left-0 w-1/3" style={{ background: 'linear-gradient(90deg, transparent, rgb(255 255 255 / 0.95), transparent)', filter: 'blur(3px)' }} />
        <div className="absolute inset-0 -z-10 rounded-full" style={{ background: 'linear-gradient(90deg, transparent, var(--ai-1) 18%, var(--ai-2) 50%, var(--ai-3) 82%, transparent)', filter: 'blur(3px)' }} />
      </div>
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
        <Collapse open={!typing} instant={TOUCH}>
          <div ref={orbWrap} className="flex shrink-0 flex-col items-center gap-1 pt-1">
            <VoiceOrb ref={orbBtn} size={showHero ? 92 : 72} listening={listening} level={speech.level} onPress={toggleMic} />
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
      <div ref={inputBox} className="pb-tabbar relative shrink-0 px-4">
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
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
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
function Collapse({ open, children, instant }: { open: boolean; children: ReactNode; instant?: boolean }) {
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
        // instant: the keyboard is resizing the screen anyway — switch the layout in one step
        // (the orb ↔ glow morph is drawn on top), instead of animating heights frame by frame.
        transition: instant
          ? 'none'
          : open
            ? 'max-height 0.42s var(--spring), opacity 0.35s ease 0.18s'
            : 'opacity 0.22s ease, max-height 0.42s var(--spring) 0.16s',
      }}
    >
      <div ref={inner}>{children}</div>
    </div>
  );
}
