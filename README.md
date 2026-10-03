# AI Task & Schedule Planner — Telegram Mini App

Calendar, an AI voice assistant, and a task list in a single Telegram Mini App.
Vite + React 19 + TypeScript + Tailwind CSS v4 + Zustand + lucide-react.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173 — works in a regular browser (Telegram API is mocked)
npm run build      # production build in dist/
```

## Connecting to Telegram

1. Deploy `dist/` to any HTTPS hosting (Vercel, Netlify, GitHub Pages, Cloudflare Pages).
   For local testing, open a tunnel: `npx cloudflared tunnel --url http://localhost:5173`.
2. In @BotFather: `/newapp` (or Bot Settings → Menu Button) → enter the HTTPS URL.
3. Open the bot in Telegram → Menu button.

## Structure

```
src/
├── main.tsx                     # entry point: initTelegram() + ThemeProvider
├── App.tsx                      # main container: screen + TabBar + Toast
├── index.css                    # design tokens (light/dark), safe-area utilities, animations
├── types.ts                     # Task, CalendarEvent, Priority, Category …
├── lib/
│   ├── telegram.ts              # WebApp wrapper: ready/expand, haptics, safe-area, theme; no-op outside Telegram
│   ├── parser.ts                # Russian-language NLP: "встреча завтра в 15:00" → structured action
│   ├── date.ts                  # date utilities (Monday-first week, Russian month names)
│   ├── storage.ts               # persistence adapter (LocalStorage ⇄ backend)
│   └── meta.ts                  # priority / category / color dictionaries
├── store/
│   ├── usePlannerStore.ts       # tasks and events (persist)
│   ├── useUIStore.ts            # active tab, theme override, selected date, toast
│   └── useChatStore.ts          # AI chat history
├── providers/ThemeProvider.tsx  # theme: Telegram colorScheme → system → manual override
├── hooks/useSwipe.ts            # horizontal swipes (days/months)
├── components/                  # Header, TabBar, Sheet, SwipeableRow, Segmented, Toast, ThemeToggle
└── features/
    ├── calendar/                # CalendarGrid (month/week), DayTimeline, EventSheet
    ├── assistant/               # AssistantTab, VoiceButton, ChatBubble, useSpeechRecognition, interpreter
    └── tasks/                   # TasksTab, QuickAdd, TaskItem, TaskSheet
```

## Key decisions

- **Telegram SDK** — the official `telegram-web-app.js` plus a typed wrapper (`lib/telegram.ts`)
  instead of `@telegram-apps/sdk-react`: zero dependencies, a stable API, and in a plain browser
  every call becomes a safe no-op.
- **Theme** — follows `Telegram.WebApp.colorScheme` (or `prefers-color-scheme`) by default.
  The header button sets a manual override (marked with a dot); switching back to the
  Telegram theme returns to auto mode. The switch uses a circular View Transitions reveal,
  with a smooth color fade as fallback. Telegram's header/background colors are synced too.
- **Safe area** — `env(safe-area-inset-*)` combined with `WebApp.safeAreaInset` /
  `contentSafeAreaInset` (published as CSS variables, updated on `safeAreaChanged`).
- **AI** — the local parser runs offline. It understands: today/tomorrow/the day after tomorrow,
  weekdays, "next Monday", "15 октября", "20.10", "5 числа", "in 2 hours", "with … until …",
  "3 pm", "in the evening", "for an hour and a half", "urgent" → high priority, plus categories.
  Questions like "Что у меня завтра?" return the agenda.
- **Voice** — Web Speech API (`ru-RU`). Where it is unavailable (many WebViews), a demo mode
  simulates recognition so the flow can still be tested.

## Server (Cloudflare Worker + D1) — `worker/`

- **Data**: each user's planner (tasks, events, tombstones) lives in D1 (`state`). The app syncs
  the whole document (`POST /state/sync`, authorised by Telegram `initData`); the server merges
  per item (newest `updatedAt` wins, deletions are tombstones) — see `src/lib/merge.ts`.
- **Reminders**: computed on the server from the stored data in the user's timezone
  (`src/lib/reminderCore.ts`), sent by the bot every minute; the 35-day window is rolled daily.
- **Assistant**: `POST /analyze` → OpenAI-compatible model with a strict JSON schema.
- **iPhone Shortcut**: `public/Планер.shortcut` (signed, built by `shortcut/build.py`), installed
  via `install.html`. Dictation → `POST /shortcut?key=…` → the model parses it, `worker/src/exec.ts`
  applies it to the stored data right away, the bot replies «Готово ✅ …». Anything needing a
  decision (bulk delete, ambiguous match) is queued and finished by the app.
- **Bot**: `/start` greeting; reminder buttons deep-link to the item (`?open=t:<id>` / `e:<id>:<date>`).

Secrets (Cloudflare dashboard → Worker → Settings → Variables and Secrets): `OPENAI_API_KEY`, `BOT_TOKEN`.

## Backend integration

- **Storage**: replace `localAdapter` in `src/lib/storage.ts` with HTTP calls
  (`GET/PUT /api/state/:key`); authorize with `Telegram.WebApp.initData` and verify the signature on the server.
- **LLM**: implement `CommandInterpreter` in `src/features/assistant/interpreter.ts`
  (POST the text to your server → return a `ParsedCommand`). The rest of the UI does not change.
