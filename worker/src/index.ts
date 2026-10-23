import { mergeDocs, emptyDoc, type PlannerDoc } from '../../src/lib/merge';
import { reminderInstances } from '../../src/lib/reminderCore';
import { occursOn } from '../../src/lib/recurrence';
import { execute } from './exec';
import { buildDigest, DEFAULT_DIGEST, minutesOf, type DigestSettings } from './digest';
import { buildIcs } from './ics';
import { timeToMinutes } from '../../src/lib/date';
import { analyze, guardNoteMode, isConfident, splitRequests } from '../../src/lib/parser';
/**
 * AI brain for the planner Mini App (Cloudflare Worker).
 *
 * POST /analyze  { text, today, weekday, time, items }  →  { actions: Analysis[], reply: string | null }
 *
 * Security:
 *  • Every request must carry Telegram `initData` (header X-Telegram-Init-Data) signed for BOT_TOKEN —
 *    only your own Mini App inside Telegram can spend your OpenAI tokens.
 *  • CORS is limited to ALLOWED_ORIGIN; a small per-user rate limit guards against loops.
 */

/* Minimal D1 typings (avoids pulling in @cloudflare/workers-types). */
interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
interface D1Database {
  prepare(query: string): D1Stmt;
  batch(statements: D1Stmt[]): Promise<unknown>;
}

interface Env {
  AI: { run(model: string, input: Record<string, unknown>): Promise<any> };
  /** Workers AI model (free tier); the OpenAI-compatible provider is only a fallback. */
  WAI_MODEL?: string;
  DB: D1Database;
  OPENAI_API_KEY: string;
  BOT_TOKEN: string;
  MODEL: string;
  API_BASE: string;
  ALLOWED_ORIGIN: string;
  APP_URL: string;
  /** Optional: your Telegram chat id — feedback from the app is forwarded there (send /myid to the bot). */
  ADMIN_CHAT_ID?: string;
  /** The bot's worker only: the app's own server («plan-app»), see wrangler.toml. */
  APP?: { fetch(request: Request): Promise<Response> };
  /** "1" on the app's server: no Telegram, no scheduled jobs. */
  APP_ONLY?: string;
}

const MAX_TEXT = 600;
const RATE_PER_MIN = 20;
const hits = new Map<string, number[]>();

/* ------------------------------------------------------------ Telegram initData */

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Validates Telegram Mini App initData; returns the user id or null. */
/**
 * The caller: a Telegram user (signed initData) or the iOS app, whose random device key is the
 * account (no sign-up). Device users are stored as "dev:" + a hash of the key — the key itself
 * is never kept, and the id cannot be guessed from it.
 */
async function authUser(request: Request, env: Env): Promise<string | null> {
  const tgUser = await verifyInitData(request.headers.get('X-Telegram-Init-Data') ?? '', env.BOT_TOKEN);
  if (tgUser) return tgUser;
  const key = request.headers.get('X-Device-Key') ?? '';
  if (!/^[0-9a-f]{64}$/.test(key)) return null;
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`planner-device:${key}`));
  return `dev:${hex(digest).slice(0, 40)}`;
}
const isDeviceUser = (user: string) => user.startsWith('dev:');

async function verifyInitData(initData: string, botToken: string): Promise<string | null> {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  if (hex(await hmac(secret, check)) !== hash) return null;
  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > 7 * 24 * 3600) return null;
  try {
    return String(JSON.parse(params.get('user') ?? '{}').id ?? 'anon');
  } catch {
    return 'anon';
  }
}

function rateLimited(user: string): boolean {
  const now = Date.now();
  const recent = (hits.get(user) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(user, recent);
  return recent.length > RATE_PER_MIN;
}

/* ------------------------------------------------------------ Prompt & schema */

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, 'null'], ...extra });

const ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'intent', 'title', 'date', 'start', 'end', 'duration', 'repeat', 'needsStart', 'kindWord',
    'eventHint', 'taskHint', 'priority', 'category', 'range', 'sourceDate', 'shift', 'all', 'targetKind', 'bulk',
    'remind', 'remindOffset', 'remindCancel', 'remindAt', 'note', 'noteMode',
  ],
  properties: {
    intent: { type: 'string', enum: ['create', 'agenda', 'delete', 'move', 'complete', 'remind', 'note', 'undo', 'help', 'smalltalk'] },
    title: { type: 'string', description: 'create: short title in nominative case. delete/move/complete: what to look for.' },
    date: nullable('string', { description: 'YYYY-MM-DD. For move: the NEW date.' }),
    start: nullable('string', { description: 'HH:MM, 24h' }),
    end: nullable('string', { description: 'HH:MM, 24h' }),
    duration: nullable('integer', { description: 'minutes, only if said ("на час")' }),
    repeat: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['freq', 'interval', 'byWeekday', 'cycle', 'until', 'nth'],
      properties: {
        freq: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
        interval: { type: 'integer' },
        byWeekday: { type: ['array', 'null'], items: { type: 'integer' }, description: 'Mon=0 … Sun=6, for several weekdays' },
        cycle: {
          type: ['object', 'null'],
          additionalProperties: false,
          required: ['on', 'off'],
          properties: { on: { type: 'integer' }, off: { type: 'integer' } },
          description: 'shift rota: freq=day, e.g. 2/2 → {on:2, off:2}; "сутки через трое" → {on:1, off:3}',
        },
        until: nullable('string', { description: 'YYYY-MM-DD last day, if said' }),
        nth: nullable('integer', {
          description: 'freq month only: N-th weekday of the month with ONE byWeekday ("каждый второй вторник" → nth 2, byWeekday [1]; "последняя пятница" → nth -1, [4]); without byWeekday nth -1 = last day of month',
        }),
      },
    },
    needsStart: { type: 'boolean', description: 'true if a shift rota was given without the first day' },
    kindWord: nullable('string', { enum: ['event', 'task', null], description: 'only if the user explicitly said "событие/в календарь" or "задача"' }),
    eventHint: { type: 'boolean', description: 'meeting/appointment/class/shift-like thing that occupies time' },
    taskHint: { type: 'boolean', description: 'a to-do: buy, call, send, prepare, remind…' },
    priority: { type: 'string', enum: ['low', 'medium', 'high'] },
    category: { type: 'string', enum: ['work', 'personal', 'health', 'study', 'other'] },
    range: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['from', 'to', 'label'],
      properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string', description: 'e.g. "на этой неделе", empty for a single day' } },
      description: 'agenda only',
    },
    sourceDate: nullable('string', { description: 'move: the date the thing is moved FROM ("со среды")' }),
    shift: nullable('integer', { description: 'move: relative shift in minutes ("на час позже" → 60, "на 30 минут раньше" → -30, "на день позже" → 1440)' }),
    all: { type: 'boolean', description: 'delete: whole series of one repeating thing ("все тренировки")' },
    targetKind: nullable('string', { enum: ['event', 'task', 'any', null], description: 'delete/move: which kind is meant ("удали событие" → event, "все задачи" → task, "все дела" → any)' }),
    remind: { type: 'boolean', description: 'create: the new item should get a reminder ("напомни купить хлеб в 10")' },
    remindOffset: nullable('integer', { description: 'minutes before ("за час" → 60, "за день" → 1440); 0 = at the time; null if not said' }),
    remindCancel: { type: 'boolean', description: 'remind: switch a reminder OFF ("убери напоминание о …")' },
    note: nullable('string', { description: 'create: the new item\'s note ("заметка: взять документы"); note: the text to add / put into the existing item\'s note' }),
    noteMode: nullable('string', { enum: ['append', 'replace', 'clear', 'read', null], description: 'note only: append (добавь/допиши), replace (замени), clear (очисти), read (что в заметке)' }),
    remindAt: nullable('string', { description: 'remind: exact moment YYYY-MM-DDTHH:MM when a time is said WITHOUT "за …" ("напомни о созвоне в 16:55", "напомни про созвон через 5 минут")' }),
    bulk: { type: 'boolean', description: 'delete EVERYTHING of targetKind in date/range ("удали все события на понедельник", "удали все задачи", "очисти всё на завтра")' },
  },
} as const;

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['actions', 'reply'],
  properties: {
    actions: { type: 'array', items: ACTION_SCHEMA },
    reply: nullable('string', { description: 'short friendly answer for small talk / help / unclear input; null otherwise' }),
  },
} as const;

/** The next 14 days with their weekdays: models get "в воскресенье" → date wrong when counting themselves. */
function calendarAhead(today: string): string {
  const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const base = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return '';
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(base.getTime() + i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    return `${i === 0 ? 'сегодня ' : i === 1 ? 'завтра ' : ''}${wd[d.getUTCDay()]} ${key}`;
  }).join(', ');
}

function systemPrompt(today: string, weekday: string, time: string): string {
  return `Ты — разбор команд для русскоязычного планировщика (календарь + задачи) в Telegram.
Сегодня ${today} (${weekday}), сейчас ${time}. Неделя начинается с понедельника.
Календарь (бери даты отсюда, не считай сам): ${calendarAhead(today)}.

Преврати сообщение пользователя в список действий (actions) строго по JSON-схеме. Одно сообщение может содержать несколько дел.
Правила:
- НЕ выдумывай. Если дата, время начала или конца не названы — ставь null (приложение само переспросит).
- Относительные даты («завтра», «в пятницу», «через неделю», «15-го») переводи в YYYY-MM-DD относительно сегодняшней даты. «В пятницу» = ближайшая будущая пятница.
- Время в 24-часовом формате. «В 3» про встречу днём = 15:00; «в 9 утра» = 09:00; «вечером» без числа = 19:00.
- «с 9 до 21» → start 09:00, end 21:00. «на час» → duration 60.
- Разговорное время: «полвосьмого» = 07:30 (вечера → 19:30), «в половине десятого» = 09:30, «без пятнадцати семь» = 06:45, «четверть восьмого» = 07:15, «в обед» = 13:00, «до вечера» = 18:00, «на 3 часа дня» = 15:00 (время, не длительность).
- «на выходных» = ближайшая суббота; «в конце месяца» = последний день месяца; «в начале ноября» = 1 ноября; «в среду на следующей неделе» = среда следующей недели.
- «отпуск с 1 по 10 ноября» → date 1-е, repeat {freq day, interval 1, until 10-е}, start 00:00, end 23:59. «весь день», дни рождения и праздники без времени → 00:00–23:59.
- «каждое 5 число» / «5 числа каждого месяца» → freq month, date = ближайшее 5-е.
- «каждый второй вторник» → freq month, nth 2, byWeekday [1], date = ближайший такой вторник; «последняя пятница месяца» → nth -1, [4]; «последний день месяца» → nth -1, byWeekday null.
- cycle только для смен (freq day), в остальных случаях cycle null. date повторяющегося события — первый реальный день повтора.
- «записаться к врачу» — это задача (taskHint), а «к врачу в 9:40» — событие.
- Повторы: «каждый понедельник» → freq week, interval 1 (date = ближайший понедельник, можно сегодня); «по вторникам и четвергам» → byWeekday [1,3]; «по будням» → [0,1,2,3,4]; «каждые 2 недели» → interval 2; «ежедневно» → day.
- Графики смен: «2/2», «2 через 2», «график 2 на 2» → freq day, interval 1, cycle {on:2, off:2}; «сутки через трое» → cycle {on:1, off:3}, start 08:00, end 23:59; «5/2» → week, byWeekday [0..4]. Если не сказано, с какого дня начинается график — date null и needsStart true.
- title: коротко, с заглавной буквы, в именительном падеже («встречу с Анной» → «Встреча с Анной»), без дат, времени и слов «поставь/добавь/напомни».
- move («перенеси X на …»): title = что ищем, date/start/end = новое время, sourceDate = откуда («со среды», «завтрашнюю» → завтра). «с 10 вечера на 8 вечера до 10» → start 20:00, end 22:00. «на час позже» → shift 60, «на 30 минут раньше» → shift -30, date/start null.
- delete («удали/отмени X»), complete («я сделал X», «отметь X выполненной»): title = что ищем, date — если указан день.
- Массовое удаление («удали все события на понедельник», «удали все задачи», «очисти всё на завтра», «удали все дела на неделе»): intent delete, bulk true, title "", targetKind event/task/any, date или range.
- Если не названо, что именно удалить/перенести («удали», «перенеси задачу», «удали событие»): title "", targetKind по слову — приложение само покажет список на выбор.
- Если при переносе не сказано, на когда («перенеси встречу с Анной»): date и start null — приложение спросит.
- Напоминания о СУЩЕСТВУЮЩЕМ деле («напомни о встрече с Анной за час», «напомни за 15 минут до тренировки», «напоминай за день до каждой смены», «поставь напоминание на обед»): intent remind, title = что ищем (в именительном падеже), remindOffset если сказано за сколько, иначе null.
- «напомни о созвоне в 16:55», «напомни про созвон через 5 минут» (время без «за …») → intent remind, remindAt = этот момент (YYYY-MM-DDTHH:MM), start null. «напомни о встрече завтра в 12 за 15 минут» → remindOffset 15, start 12:00 (время самой встречи).
- «созвон в 17, напомни за 5 минут», «встреча в 15 с напоминанием за час», «предупреди меня за 10 минут до созвона», «за 5 минут напомни о созвоне» — это тоже напоминания.
- Заметки к существующему делу: «добавь в заметку к встрече с Анной взять документы», «допиши к созвону обсудить бюджет», «к тренировке запиши взять полотенце» → intent note, noteMode append, title = дело («Встреча с Анной», в именительном падеже), note = сам текст («Взять документы»). «замени заметку к созвону на …» → replace; «очисти/удали заметку к …» → clear; «что в заметке к …», «покажи заметку …» → read (note null).
- Новое дело с заметкой: «встреча завтра с 15 до 16, заметка: взять документы» → intent create, note «Взять документы».
- Выключить напоминание («убери/отключи напоминание о тренировке», «не напоминай о планёрке»): intent remind, remindCancel true.
- Новое дело с напоминанием («напомни купить хлеб завтра в 10», «напомни через 2 часа выключить духовку», «напомни позвонить маме»): intent create, remind true, remindOffset 0 если просят напомнить в указанное время; taskHint true.
- Если непонятно, существующее это дело или новое, — используй intent remind: приложение само создаст дело, если не найдёт.
- agenda («что у меня завтра / на неделе / на выходных»): range с from/to.
- undo («отмени последнее»), help («что ты умеешь»), smalltalk (приветствие, спасибо) — reply с коротким дружелюбным ответом.
- Если смысл неясен — actions пустой, reply: короткий уточняющий вопрос по-русски.
Список ближайших дел пользователя дан ниже, используй его, чтобы правильно назвать то, что нужно перенести/удалить/отметить.`;
}

/* ------------------------------------------------------------ Telegram bot (/start) */

/** Secret Telegram must echo back on every webhook call; derived from the bot token, so nothing extra to store. */
async function webhookSecret(env: Env): Promise<string> {
  return hex(await hmac(enc.encode('ai-planner-webhook'), env.BOT_TOKEN)).slice(0, 48);
}

async function tg(env: Env, method: string, payload: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json() as Promise<{ ok: boolean; description?: string; result?: unknown }>;
}

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** The current announcement for /broadcast (a new key = a new announcement). */
const BROADCAST = {
  key: 'wallpaper-v2',
  text: `🖼 <b>Планы и задачи прямо на экране блокировки</b>

Планер теперь умеет ставить обои: слева планы на день, справа задачи. Обновляются сами.

Как включить (2 минуты, только iPhone):
1. Откройте планер → ⚙️ Настройки → «Обои экрана блокировки».
2. Нажмите «Установить команду» → «Добавить команду».
3. Вернитесь в планер и нажмите «Подключить», обои сразу появятся.
4. Чтобы обновлялись сами: «Команды» → «Автоматизация» → «+» → «Приложение» → Telegram → отметьте «Закрыто» → «Запускать сразу» → «Обои ПЛАН».

Если уже стояла старая «Обои ПЛАН», сначала удалите её.`,
};

/** "Open" button; with a reminder id it deep-links straight to that task / event. */
function openButton(env: Env, rid?: string) {
  const url = rid ? `${env.APP_URL}?open=${encodeURIComponent(rid)}` : env.APP_URL;
  const label = rid === 'a' ? '✨ Ответить в планере' : rid ? '📅 Открыть' : '📅 Открыть планер';
  return { inline_keyboard: [[{ text: label, web_app: { url } }]] };
}

async function onTelegramUpdate(update: any, env: Env) {
  const msg = update?.message;
  if (!msg?.chat?.id || msg.chat.type !== 'private') return;
  const name = escapeHtml(String(msg.from?.first_name ?? '').slice(0, 40));
  const text = String(msg.text ?? '');

  if (text.startsWith('/start') || text.startsWith('/help')) {
    await tg(env, 'sendMessage', {
      chat_id: msg.chat.id,
      parse_mode: 'HTML',
      text:
        `Привет${name ? `, ${name}` : ''}! 👋\n\n` +
        `Я — <b>AI-планер</b>: календарь, задачи и умный ассистент в одном месте.\n\n` +
        `🗓 Расписание как в Календаре iPhone — месяц, день, повторы и графики смен 2/2\n` +
        `✅ Задачи с датами, приоритетами и категориями\n` +
        `✨ Ассистент понимает обычную речь: скажите «встреча с Анной завтра с 15 до 16» — и всё окажется в календаре\n\n` +
        `Нажмите кнопку ниже, чтобы открыть планер 👇`,
      reply_markup: openButton(env),
    });
    return;
  }

  // "/today", "/tomorrow" — the summary on demand
  if (/^\/(today|tomorrow|сегодня|завтра)\b/iu.test(text)) {
    const user = String(msg.from?.id ?? msg.chat.id);
    const { tz } = await loadDoc(env, user);
    const ok = await sendDigest(env, user, tz ?? 0, /tomorrow|завтра/iu.test(text) ? 'evening' : 'morning');
    if (!ok) await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: 'Откройте планер хотя бы раз, чтобы я увидел ваше расписание 👇', reply_markup: openButton(env) });
    return;
  }
  if (text.startsWith('/stats')) {
    if (!env.ADMIN_CHAT_ID || String(msg.chat.id) !== env.ADMIN_CHAT_ID) return; // admin only; others get nothing
    await tg(env, 'sendMessage', { chat_id: msg.chat.id, parse_mode: 'HTML', text: await statsText(env) });
    return;
  }
  // "/users" — admin only: everyone who opened the planner, most active first, with their Telegram
  // name and @username (from getChat: what the bot can see anyway).
  if (text.startsWith('/users')) {
    if (!env.ADMIN_CHAT_ID || String(msg.chat.id) !== env.ADMIN_CHAT_ID) return;
    try {
      // Telegram caps a message at 4096 characters: split on line breaks
      const say = async (t: string) => {
        const r = await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: t });
        if (!r.ok) console.error('/users send failed:', r.description);
      };
      let chunk = '';
      for (const line of (await usersText(env)).split('\n')) {
        if (chunk.length + line.length > 3500) {
          await say(chunk);
          chunk = '';
        }
        chunk += (chunk ? '\n' : '') + line;
      }
      if (chunk) await say(chunk);
    } catch (e) {
      console.error('/users failed:', String(e));
      await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: `/users: ошибка ${String(e).slice(0, 300)}` }).catch(() => null);
    }
    return;
  }
  // "/broadcast" — admin only: preview of the announcement and who gets it; "/broadcast_send" sends it.
  // Each user gets a given announcement once (webhook retries and double taps are safe).
  if (text.startsWith('/broadcast')) {
    if (!env.ADMIN_CHAT_ID || String(msg.chat.id) !== env.ADMIN_CHAT_ID) return;
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS broadcast_sent (key TEXT NOT NULL, user_id TEXT NOT NULL, ok INTEGER NOT NULL, PRIMARY KEY (key, user_id))').run();
    const { results } = await env.DB.prepare("SELECT s.user_id FROM seen s WHERE s.user_id NOT LIKE 'dev:%' AND s.user_id GLOB '[0-9]*' AND NOT EXISTS (SELECT 1 FROM broadcast_sent b WHERE b.key = ?1 AND b.user_id = s.user_id)")
      .bind(BROADCAST.key)
      .all<{ user_id: string }>();
    const message = { parse_mode: 'HTML', text: BROADCAST.text, reply_markup: openButton(env) };
    if (!text.startsWith('/broadcast_send')) {
      await tg(env, 'sendMessage', { chat_id: msg.chat.id, ...message });
      await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: `☝️ Получат: ${results.length}. Отправить — /broadcast_send` });
      return;
    }
    let sent = 0;
    for (const { user_id } of results) {
      // claim first, so a retried webhook running alongside never sends twice
      const claim = await env.DB.prepare('INSERT OR IGNORE INTO broadcast_sent (key, user_id, ok) VALUES (?1, ?2, 0)').bind(BROADCAST.key, user_id).run();
      if (!claim.meta.changes) continue;
      const r = (await tg(env, 'sendMessage', { chat_id: user_id, ...message }).catch(() => null)) as { ok?: boolean } | null;
      if (r?.ok) await env.DB.prepare('UPDATE broadcast_sent SET ok = 1 WHERE key = ?1 AND user_id = ?2').bind(BROADCAST.key, user_id).run();
      if (r?.ok) sent++;
      await new Promise((res) => setTimeout(res, 60)); // well under Telegram's 30 messages a second
    }
    await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: `Рассылка: доставлено ${sent} из ${results.length}.` });
    return;
  }
  // "/wpfix" — admin only: a personal note to those whose wallpaper is drawn but never fetched by
  // their Shortcut (no setup, or an old link); "/wpfix_send" sends it. Each person once.
  if (text.startsWith('/wpfix')) {
    if (!env.ADMIN_CHAT_ID || String(msg.chat.id) !== env.ADMIN_CHAT_ID) return;
    await ensureWallpaper(env);
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS broadcast_sent (key TEXT NOT NULL, user_id TEXT NOT NULL, ok INTEGER NOT NULL, PRIMARY KEY (key, user_id))').run();
    const key = 'wpfix-1';
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT w.user_id, u.token FROM wallpaper_b64 w JOIN users u ON u.user_id = w.user_id
       WHERE w.user_id GLOB '[0-9]*' AND ${notOwn(env, 'w.user_id')}
         AND NOT EXISTS (SELECT 1 FROM wallpaper_hits h WHERE h.user_id = w.user_id)
         AND NOT EXISTS (SELECT 1 FROM broadcast_sent b WHERE b.key = ?1 AND b.user_id = w.user_id)`,
    )
      .bind(key)
      .all<{ user_id: string; token: string }>();
    const note = (token: string) => ({
      parse_mode: 'HTML',
      text: `🖼 <b>Обои почти готовы</b>

Планер уже рисует ваши обои, но iPhone их пока не забирает: скорее всего, в команде старая ссылка или она не до конца настроена. Чинится за минуту:

1. Нажмите на ссылку, чтобы скопировать:
<code>${PUBLIC_ORIGIN}/wallpaper/${token}.jpg</code>
2. «Команды» → «Обои ПЛАН» → вставьте ссылку в «Получить содержимое URL» вместо старой. Нет команды — планер → ⚙️ Настройки → «Добавить обои».
3. Запустите команду один раз, обои появятся.
4. Чтобы обновлялись сами: «Команды» → «Автоматизация» → «+» → «Приложение» → Telegram → «Закрыто» → «Запускать сразу» → «Обои ПЛАН».

Не получается или у вас Android? Просто ответьте на это сообщение 🙂 Ссылку никому не пересылайте.`,
    });
    if (!text.startsWith('/wpfix_send')) {
      await tg(env, 'sendMessage', { chat_id: msg.chat.id, ...note('ВАШ_ЛИЧНЫЙ_КЛЮЧ') });
      await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: `☝️ Получат: ${results.length}, у каждого своя ссылка. Отправить — /wpfix_send` });
      return;
    }
    let sent = 0;
    for (const { user_id, token } of results) {
      const claim = await env.DB.prepare('INSERT OR IGNORE INTO broadcast_sent (key, user_id, ok) VALUES (?1, ?2, 0)').bind(key, user_id).run();
      if (!claim.meta.changes) continue;
      const r = (await tg(env, 'sendMessage', { chat_id: user_id, ...note(token) }).catch(() => null)) as { ok?: boolean } | null;
      if (r?.ok) {
        await env.DB.prepare('UPDATE broadcast_sent SET ok = 1 WHERE key = ?1 AND user_id = ?2').bind(key, user_id).run();
        sent++;
      }
      await new Promise((res) => setTimeout(res, 60));
    }
    await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: `Обои: доставлено ${sent} из ${results.length}.` });
    return;
  }
  if (/^\/(transfer|перенос)\b/iu.test(text)) {
    const user = String(msg.from?.id ?? msg.chat.id);
    const { results } = await env.DB.prepare('SELECT 1 FROM state WHERE user_id = ?1').bind(user).all();
    if (!results.length) {
      await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: 'Сначала откройте планер здесь хотя бы раз — переносить пока нечего 👇', reply_markup: openButton(env) });
      return;
    }
    await tg(env, 'sendMessage', { chat_id: msg.chat.id, parse_mode: 'HTML', text: transferText(await transferCode(env, user)) });
    return;
  }
  if (text.startsWith('/myid')) {
    await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: `Ваш chat id: ${msg.chat.id}` });
    return;
  }

  // Anything else said to the bot — typed or a voice message — is a request for the planner,
  // handled like the iPhone voice button: no need to open the app.
  const user = String(msg.from?.id ?? msg.chat.id);
  let said = text.startsWith('/') ? '' : text.trim();
  if (!said && msg.voice?.file_id) said = (await transcribe(env, msg.voice.file_id)) ?? '';
  if (!said) {
    await tg(env, 'sendMessage', {
      chat_id: msg.chat.id,
      text: msg.voice ? 'Не расслышал 🙈 Попробуйте ещё раз или напишите текстом.' : 'Напишите или скажите голосом, что добавить, например «завтра в 15:00 созвон». Или откройте планер 👇\n\n/today — план на сегодня, /tomorrow — на завтра',
      reply_markup: openButton(env),
    });
    return;
  }
  if (rateLimited(`s:${user}`)) return;
  await tg(env, 'sendChatAction', { chat_id: msg.chat.id, action: 'typing' }).catch(() => null);
  const { tz } = await loadDoc(env, user);
  const res = await runShortcut(env, user, tz ?? -180, said.slice(0, MAX_TEXT));
  // what the planner didn't understand is worth reading: it shows what people expect from it
  if (!res.doc && env.ADMIN_CHAT_ID && user !== env.ADMIN_CHAT_ID)
    await tg(env, 'sendMessage', { chat_id: env.ADMIN_CHAT_ID, text: `💬 В чат бота от ${user}${msg.voice ? ' (голосом)' : ''}:\n\n${said.slice(0, 1000)}\n\n↳ ${res.answer}` }).catch(() => null);
  await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: `${msg.voice ? `🎙 «${said.slice(0, 200)}»\n\n` : ''}${res.answer}`, reply_markup: openButton(env, res.doc ? undefined : 'a') });
}

/** A Telegram voice message → text (Workers AI Whisper). */
async function transcribe(env: Env, fileId: string): Promise<string | null> {
  try {
    const f = (await tg(env, 'getFile', { file_id: fileId })) as { result?: { file_path?: string; file_size?: number } };
    if (!f.result?.file_path || (f.result.file_size ?? 0) > 5_000_000) return null;
    const audio = await (await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${f.result.file_path}`)).arrayBuffer();
    const out = (await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: toBase64(new Uint8Array(audio)), language: 'ru' })) as { text?: string };
    console.log('voice →', audio.byteLength, 'bytes,', out.text ? `${out.text.length} chars` : 'no text');
    return out.text?.trim() || null;
  } catch (e) {
    console.error('voice transcription failed:', String(e));
    return null;
  }
}

/* ------------------------------------------------------------ iOS app in the background */
// The app's widgets, wallpaper and local reminders, computed from the server copy — so they stay
// fresh even when the planner hasn't been opened (same shape as src/lib/nativeReminders.ts).

function widgetSnapshot(doc: PlannerDoc, today: string) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDaysKey(today, i);
    return {
      date,
      events: doc.events
        .filter((e) => occursOn(e, date))
        .sort((a, b) => a.start.localeCompare(b.start))
        .map((e) => ({ title: e.title, start: e.start, end: e.end, color: e.color })),
      tasks: doc.tasks
        .filter((t) => t.date === date)
        .sort((a, b) => Number(a.done) - Number(b.done) || (a.time ?? '99').localeCompare(b.time ?? '99'))
        .map((t) => ({ id: t.id, title: t.title, time: t.time, done: t.done, hi: t.priority === 'high' || undefined })),
    };
  });
  const late = doc.tasks
    .filter((t) => !t.done && t.date && t.date < today)
    .sort((a, b) => a.date!.localeCompare(b.date!))
    .map((t) => ({ id: t.id, title: t.title, date: t.date!, hi: t.priority === 'high' || undefined }));
  const inbox = doc.tasks
    .filter((t) => !t.done && !t.date)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10)
    .map((t) => ({ id: t.id, title: t.title }));
  return { days, overdue: late.length, late: late.slice(0, 10), inbox };
}

function nativeReminders(doc: PlannerDoc, tz: number) {
  return reminderInstances(doc.events, doc.tasks, { today: localNow(tz).today, tz })
    .slice(0, 60)
    .map((r) => {
      const [title, ...rest] = r.text.split('\n');
      return { id: r.rid, at: r.at, title: title.replace(/^⏰\s*/, ''), body: rest.join('\n'), open: r.rid };
    });
}

/* ------------------------------------------------------------ Lock-screen wallpaper (Telegram users) */
// The Mini App draws the wallpaper (today + tomorrow) and uploads it; the user's Shortcut fetches
// today's image by the personal link and sets it with «Установить обои».

// Links people put into Shortcuts and calendars go through the Russian relay (Cloud.ru
// Container Apps, relay/cloudru-proxy.js): mobile networks in Russia throttle Cloudflare.
const PUBLIC_ORIGIN = 'https://plan-relay.containerapps.ru';
let wallpaperReady = false;
async function ensureWallpaper(env: Env) {
  if (wallpaperReady) return;
  // Stored as base64 text: D1 hands text back fast (a BLOB comes back as a huge number array).
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS wallpaper_b64 (user_id TEXT NOT NULL, day TEXT NOT NULL, img TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, day))'),
    // "a fresh picture is on its way": set by the planner on every change, before it uploads
    env.DB.prepare('CREATE TABLE IF NOT EXISTS wallpaper_pending (user_id TEXT PRIMARY KEY, at INTEGER NOT NULL)'),
    // last Shortcut download per user: which network it came through (relay or workers.dev directly) and how long it took
    env.DB.prepare('CREATE TABLE IF NOT EXISTS wallpaper_hits (user_id TEXT PRIMARY KEY, at INTEGER NOT NULL, via TEXT, ms INTEGER, n INTEGER NOT NULL DEFAULT 1)'),
  ]);
  wallpaperReady = true;
}
const MAX_WALLPAPER = 1_900_000; // base64 chars (~1.4 MB JPEG)

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const U = Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array };
  if (U.fromBase64) return U.fromBase64(b64);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------ Usage stats (/stats, admin only) */

let statsReady = false;
async function ensureStats(env: Env) {
  if (statsReady) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS seen (user_id TEXT PRIMARY KEY, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS metrics (day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, key))'),
  ]);
  statsReady = true;
}

/** Days are counted in Moscow time — the admin's clock. */
const MSK = 3 * 3600_000;
const mskDay = (ms = Date.now()) => new Date(ms + MSK).toISOString().slice(0, 10);
const mskDayStart = (daysAgo = 0) => Date.parse(`${mskDay(Date.now() - daysAgo * 86_400_000)}T00:00:00Z`) - MSK;

/** Counts an event of the day (e.g. a Shortcut run) and/or marks the user as seen. Never fails the request. */
/**
 * The owner's own accounts (Telegram + iPhone, Mac, simulator, old test keys): left out of /stats
 * and /users, and their actions don't count in the daily metrics.
 */
const OWN_ACCOUNTS = [
  'dev:097b0b0be89c02469aea028f87ba14c873023ed2', // iPhone + Mac (shared key)
  'dev:441841291c92bf1d6c75335b42c0a152b5a68847', // simulator
  'dev:305fa0bee22ace1e1bf41972798c9783c39c4376', // Mac, before the shared key
  'dev:c5700cbce53f21eb89b1c817f1382fbc67e0e234', // an early test install
];
const isOwn = (env: Env, user?: string | null) => Boolean(user) && (user === env.ADMIN_CHAT_ID || OWN_ACCOUNTS.includes(user!));
/** SQL: "user_id NOT IN (…)" for the owner's accounts. */
const notOwn = (env: Env, col = 'user_id') => `${col} NOT IN (${[env.ADMIN_CHAT_ID ?? '', ...OWN_ACCOUNTS].map((u) => `'${u.replace(/'/g, '')}'`).join(', ')})`;

async function track(env: Env, key: string | null, user?: string | null) {
  try {
    await ensureStats(env);
    const now = Date.now();
    const stmts: D1Stmt[] = [];
    if (key && !isOwn(env, user)) stmts.push(env.DB.prepare('INSERT INTO metrics (day, key, n) VALUES (?1, ?2, 1) ON CONFLICT (day, key) DO UPDATE SET n = n + 1').bind(mskDay(now), key));
    if (user && user !== 'anon')
      stmts.push(env.DB.prepare('INSERT INTO seen (user_id, first_at, last_at) VALUES (?1, ?2, ?2) ON CONFLICT (user_id) DO UPDATE SET last_at = ?2').bind(user, now));
    if (stmts.length) await env.DB.batch(stmts);
  } catch {
    /* stats are best-effort */
  }
}

/** For /users: one line per person, ranked by activity (items, this week's items, last visit). */
async function usersText(env: Env): Promise<string> {
  await ensureStats(env);
  const { results } = await env.DB.prepare(
    `SELECT s.user_id, s.last_at, st.doc, (SELECT 1 FROM users u WHERE u.user_id = s.user_id) tok, (SELECT COUNT(*) FROM wallpaper_b64 w WHERE w.user_id = s.user_id) wp FROM seen s LEFT JOIN state st ON st.user_id = s.user_id WHERE ${notOwn(env, 's.user_id')}`,
  ).all<{ user_id: string; last_at: number; doc: string | null; tok: number | null; wp: number }>();
  const now = Date.now(), DAY = 86_400_000;
  const rows = results.map((r) => {
    let items = 0, week = 0;
    try {
      const d = JSON.parse(r.doc ?? '{}') as { tasks?: { createdAt?: number }[]; events?: { createdAt?: number }[] };
      for (const x of [...(d.tasks ?? []), ...(d.events ?? [])]) {
        items++;
        if (now - (x.createdAt ?? 0) < 7 * DAY) week++;
      }
    } catch {
      /* broken doc */
    }
    const days = (now - r.last_at) / DAY;
    const score = items * 2 + week * 3 + (days < 1 ? 20 : days < 3 ? 12 : days < 6 ? 4 : 0) + (r.tok ? 5 : 0) + (r.wp ? 5 : 0);
    const status = (items === 0 && !r.tok && !r.wp) || days > 5 ? (days > 2 ? '🔴' : '⚪️') : days > 2 ? '🟡' : '🟢';
    return { ...r, items, week, days, score, status };
  });
  rows.sort((a, b) => b.score - a.score);
  // Names are cached: a Worker may make only ~50 outside requests per run, so getChat goes out
  // for at most 35 people not seen yet (the rest come with the next /users).
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS tg_names (user_id TEXT PRIMARY KEY, label TEXT NOT NULL, at INTEGER NOT NULL)').run();
  const { results: cached } = await env.DB.prepare('SELECT user_id, label FROM tg_names').all<{ user_id: string; label: string }>();
  const names = new Map(cached.map((c) => [c.user_id, c.label]));
  let budget = 35;
  for (const r of rows) {
    if (r.user_id.startsWith('dev:') || names.has(r.user_id) || budget-- <= 0) continue;
    const c = (await tg(env, 'getChat', { chat_id: r.user_id }).catch(() => null)) as { ok?: boolean; result?: { username?: string; first_name?: string; last_name?: string } } | null;
    if (!c?.ok) continue;
    const name = [c.result?.first_name, c.result?.last_name].filter(Boolean).join(' ');
    const label = `${c.result?.username ? '@' + c.result.username : 'без юзернейма'}${name ? ` (${name})` : ''}`;
    names.set(r.user_id, label);
    await env.DB.prepare('INSERT INTO tg_names (user_id, label, at) VALUES (?1, ?2, ?3) ON CONFLICT (user_id) DO UPDATE SET label = ?2, at = ?3').bind(r.user_id, label, now).run();
  }
  const lines: string[] = [];
  for (const [i, r] of rows.entries()) {
    const who = r.user_id.startsWith('dev:') ? `📱 приложение ${r.user_id.slice(4, 10)}` : `${names.get(r.user_id) ?? 'имя загрузится в следующий раз'} · ${r.user_id}`;
    const extras = `${r.tok ? '🎙' : ''}${r.wp ? '🖼' : ''}`;
    const ago = r.days < 1 ? 'сегодня' : `${Math.floor(r.days)} дн. назад`;
    lines.push(`${r.status} ${i + 1}. ${who}\n    записей ${r.items} (за неделю ${r.week}) · был ${ago} ${extras}`);
  }
  return `👥 Пользователи (${rows.length}), от активных к неактивным\n🟢 активен · 🟡 засыпает · ⚪️ зашёл, ничего не сделал · 🔴 мёртвый\n\n${lines.join('\n')}`;
}

async function statsText(env: Env): Promise<string> {
  await ensureStats(env);
  await ensureDigestTables(env);
  const today = mskDayStart(0), week = mskDayStart(6);
  const one = async <T,>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results[0];
  const users = await one<{ total: number; app: number }>(`SELECT COUNT(*) total, COALESCE(SUM(user_id LIKE 'dev:%'), 0) app FROM state WHERE ${notOwn(env)}`);
  const seen = await one<{ newToday: number; newWeek: number; actToday: number; actWeek: number }>(
    'SELECT COALESCE(SUM(first_at >= ?1), 0) newToday, COALESCE(SUM(first_at >= ?2), 0) newWeek, COALESCE(SUM(last_at >= ?1), 0) actToday, COALESCE(SUM(last_at >= ?2), 0) actWeek FROM seen WHERE ' + notOwn(env),
    today,
    week,
  );
  const metric = async (key: string) =>
    one<{ d: number; w: number }>('SELECT COALESCE(SUM(CASE WHEN day = ?2 THEN n END), 0) d, COALESCE(SUM(CASE WHEN day >= ?3 THEN n END), 0) w FROM metrics WHERE key = ?1', key, mskDay(), mskDay(week));
  const shortcut = await metric('shortcut');
  const ai = await metric('ai');
  const linked = await one<{ n: number }>(`SELECT COUNT(*) n FROM users WHERE ${notOwn(env)}`);
  const digest = await one<{ n: number }>(`SELECT COUNT(*) n FROM digest WHERE (morning = 1 OR evening = 1) AND ${notOwn(env)}`);
  const feedback = await one<{ n: number }>(`SELECT COUNT(*) n FROM feedback WHERE ${notOwn(env)}`);

  // What people keep in the planner (items that still exist).
  const { results } = await env.DB.prepare(`SELECT doc FROM state WHERE ${notOwn(env)}`).all<{ doc: string }>();
  let ev = 0, tk = 0, done = 0, evToday = 0, tkToday = 0, week7 = 0;
  for (const r of results) {
    try {
      const d = JSON.parse(r.doc) as { tasks?: { createdAt?: number; done?: boolean }[]; events?: { createdAt?: number }[] };
      for (const e of d.events ?? []) {
        ev++;
        if ((e.createdAt ?? 0) >= today) evToday++;
        if ((e.createdAt ?? 0) >= week) week7++;
      }
      for (const t of d.tasks ?? []) {
        tk++;
        if (t.done) done++;
        if ((t.createdAt ?? 0) >= today) tkToday++;
        if ((t.createdAt ?? 0) >= week) week7++;
      }
    } catch {
      /* skip a broken doc */
    }
  }

  return [
    `📊 <b>Статистика ПЛАН</b> · ${new Date(Date.now() + MSK).toISOString().slice(11, 16)} МСК`,
    '',
    `👥 Пользователей: <b>${users.total}</b> (Telegram ${users.total - users.app} · iPhone ${users.app})`,
    `🆕 Новых: сегодня <b>${seen.newToday}</b> · за 7 дней ${seen.newWeek}`,
    `🔥 Активных: сегодня <b>${seen.actToday}</b> · за 7 дней ${seen.actWeek}`,
    '',
    `📅 Добавлено сегодня: <b>${evToday + tkToday}</b> (событий ${evToday}, задач ${tkToday})`,
    `За 7 дней: ${week7} · всего в планерах: ${ev + tk} (событий ${ev}, задач ${tk}, выполнено ${done})`,
    '',
    `🎙 Кнопка iPhone: сегодня <b>${shortcut.d}</b> · за 7 дней ${shortcut.w} (подключили ${linked.n})`,
    `✨ Запросов к ИИ: сегодня ${ai.d} · за 7 дней ${ai.w}`,
    `☀️ Сводку включили: ${digest.n}`,
    `💬 Отзывов: ${feedback.n}`,
  ].join('\n');
}

/* ------------------------------------------------------------ Calendar subscription (iPhone / Mac / Google) */

let feedTableReady = false;
async function ensureFeedTable(env: Env) {
  if (feedTableReady) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS calendar_feed (user_id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, tasks INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)').run();
  feedTableReady = true;
}

function feedLinks(origin: string, token: string) {
  const ics = `${origin}/cal/${token}.ics`;
  return { page: `${origin}/cal/${token}`, ics, webcal: ics.replace(/^https?:/, 'webcal:') };
}

function subscribePage(links: ReturnType<typeof feedLinks>): string {
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(links.webcal)}`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Планер в Календаре</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,'SF Pro Text',system-ui,sans-serif;background:#000;color:#fff;-webkit-font-smoothing:antialiased}
main{max-width:460px;margin:0 auto;padding:48px 20px 40px}h1{font-size:30px;line-height:1.15;margin:20px 0 10px;letter-spacing:-.02em}p{color:rgba(235,235,245,.65);font-size:17px;line-height:1.45;margin:0 0 14px}
.icon{width:76px;height:76px;border-radius:20px;background:linear-gradient(135deg,#5b8cff,#a78bfa 52%,#ff8fa3);display:grid;place-items:center}
.btn{display:block;text-align:center;text-decoration:none;font-weight:600;font-size:17px;border-radius:999px;padding:16px;margin-top:12px}
.primary{background:#0a84ff;color:#fff}.secondary{background:#1c1c1e;color:#0a84ff}
ol{margin:22px 0 0;padding-left:20px;color:rgba(235,235,245,.65);font-size:15px;line-height:1.5}li{margin-bottom:6px}
code{display:block;margin-top:18px;padding:12px;border-radius:12px;background:#1c1c1e;color:rgba(235,235,245,.65);font-size:12px;word-break:break-all}
</style></head><body><main>
<div class="icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15.5" rx="4"/><path d="M8 3v3.5M16 3v3.5"/></svg></div>
<h1>Планер в Календаре</h1>
<p>События из планера появятся в Календаре iPhone и Mac, в его виджетах на экране «Домой» и экране блокировки, на Apple Watch.</p>
<a class="btn primary" href="${links.webcal}">Подписаться на iPhone или Mac</a>
<a class="btn secondary" href="${google}">Добавить в Google Календарь</a>
<ol><li>Нажмите «Подписаться» → «Подписаться» в окне iPhone.</li><li>Календарь «Планер» обновляется сам — новые события появятся через несколько минут.</li><li>Виджет: удерживайте экран «Домой» → «+» → «Календарь».</li></ol>
<code>${links.ics}</code>
</main></body></html>`;
}

/* ------------------------------------------------------------ Daily summary */

let digestTableReady = false;
async function ensureDigestTables(env: Env) {
  if (digestTableReady) return;
  await env.DB.batch([
    env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS digest (user_id TEXT PRIMARY KEY, morning INTEGER NOT NULL, morning_time TEXT NOT NULL, evening INTEGER NOT NULL, evening_time TEXT NOT NULL, last_morning TEXT, last_evening TEXT)',
    ),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, text TEXT NOT NULL, created_at INTEGER NOT NULL)'),
  ]);
  digestTableReady = true;
}

type DigestRow = { morning: number; morning_time: string; evening: number; evening_time: string; last_morning: string | null; last_evening: string | null };
const toSettings = (r?: DigestRow | null): DigestSettings =>
  r ? { morning: Boolean(r.morning), morningTime: r.morning_time, evening: Boolean(r.evening), eveningTime: r.evening_time } : { ...DEFAULT_DIGEST };

async function getDigest(env: Env, user: string): Promise<DigestSettings> {
  await ensureDigestTables(env);
  const { results } = await env.DB.prepare('SELECT * FROM digest WHERE user_id = ?1').bind(user).all<DigestRow>();
  return toSettings(results[0]);
}

async function setDigest(env: Env, user: string, patch: Partial<DigestSettings>): Promise<DigestSettings> {
  const cur = await getDigest(env, user);
  const time = (v: unknown, d: string) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d);
  const next: DigestSettings = {
    morning: typeof patch.morning === 'boolean' ? patch.morning : cur.morning,
    morningTime: time(patch.morningTime, cur.morningTime),
    evening: typeof patch.evening === 'boolean' ? patch.evening : cur.evening,
    eveningTime: time(patch.eveningTime, cur.eveningTime),
  };
  await env.DB.prepare(
    `INSERT INTO digest (user_id, morning, morning_time, evening, evening_time) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (user_id) DO UPDATE SET morning = ?2, morning_time = ?3, evening = ?4, evening_time = ?5`,
  )
    .bind(user, next.morning ? 1 : 0, next.morningTime, next.evening ? 1 : 0, next.eveningTime)
    .run();
  return next;
}

/** Sends the summary now; false when the user has no data on the server yet. */
async function sendDigest(env: Env, user: string, tz: number, kind: 'morning' | 'evening', skipEmpty = false): Promise<boolean> {
  const { results } = await env.DB.prepare('SELECT 1 FROM state WHERE user_id = ?1').bind(user).all();
  if (!results.length) return false;
  const { doc } = await loadDoc(env, user);
  // An empty planner gets the "first steps" messages instead: a daily "nothing planned" teaches to ignore the bot.
  if (skipEmpty && !doc.tasks.length && !doc.events.length) return true;
  const today = localNow(tz).today;
  const d = buildDigest(doc, today, kind);
  const day = kind === 'morning' ? today : addDaysKey(today, 1);
  const app = (open: string) => ({ web_app: { url: `${env.APP_URL}?open=${encodeURIComponent(open)}` } });
  const keyboard = d.empty
    ? [[{ text: kind === 'morning' ? '✨ Запланировать день' : '✨ Запланировать завтра', ...app('a') }]]
    : [[{ text: kind === 'morning' ? '📅 Открыть день' : '📅 Открыть завтра', ...app(`d:${day}`) }]];
  const res = await tg(env, 'sendMessage', { chat_id: user, text: d.text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }).catch(() => ({ ok: false }));
  return Boolean(res.ok);
}

const addDaysKey = (key: string, n: number) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Every minute: whoever's local time has reached their summary time and hasn't got it today. */
/**
 * When each Telegram user's next summary is due (UTC ms). The minute cron reads only the due rows
 * through the index — scanning every user every minute was 94% of all database reads.
 */
let digestDueReady = false;
async function ensureDigestDue(env: Env) {
  if (digestDueReady) return;
  await ensureDigestTables(env);
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS digest_due (user_id TEXT PRIMARY KEY, at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_digest_due ON digest_due (at)'),
  ]);
  // first run: every Telegram user gets a row, due now (the cron then works out the real time)
  const { results } = await env.DB.prepare('SELECT 1 FROM digest_due LIMIT 1').all();
  if (!results.length) await env.DB.prepare(`INSERT OR IGNORE INTO digest_due (user_id, at) SELECT user_id, 0 FROM state WHERE user_id NOT LIKE 'dev:%'`).run();
  digestDueReady = true;
}

/** The next moment (UTC ms) a summary is due, given what was already sent today. */
function nextDigestAt(st: DigestSettings, tz: number, last: { morning: string | null; evening: string | null }): number {
  const local = localNow(tz);
  const nowMin = minutesOf(local.time);
  let best = Infinity;
  for (const kind of ['morning', 'evening'] as const) {
    if (!st[kind]) continue;
    const at = minutesOf(kind === 'morning' ? st.morningTime : st.eveningTime);
    // today while it's still within the 3-hour delivery window and not sent yet, else tomorrow
    const day = last[kind] !== local.today && nowMin < at + 180 ? local.today : addDaysKey(local.today, 1);
    const [y, m, d] = day.split('-').map(Number);
    best = Math.min(best, Date.UTC(y, m - 1, d, Math.floor(at / 60), at % 60) + tz * 60_000);
  }
  return Number.isFinite(best) ? best : Date.now() + 7 * 86_400_000; // both off: look again in a week
}

/** A new Telegram user, a new timezone or new settings: work out the time again on the next minute. */
async function recheckDigest(env: Env, user: string) {
  if (isDeviceUser(user)) return;
  await ensureDigestDue(env);
  await env.DB.prepare('INSERT INTO digest_due (user_id, at) VALUES (?1, 0) ON CONFLICT (user_id) DO UPDATE SET at = 0').bind(user).run();
}

/** Users per cron run: each costs ~5 database queries, and a run may make 50 on the free plan. */
const DIGESTS_PER_RUN = 6;

async function sendDigests(env: Env): Promise<number> {
  await ensureDigestDue(env);
  const { results } = await env.DB.prepare(
    `SELECT q.user_id AS user_id, s.user_id AS has_state, s.tz AS tz, d.morning, d.morning_time, d.evening, d.evening_time, d.last_morning, d.last_evening
     FROM digest_due q LEFT JOIN state s ON s.user_id = q.user_id LEFT JOIN digest d ON d.user_id = q.user_id
     WHERE q.at <= ?1 ORDER BY q.at LIMIT ${DIGESTS_PER_RUN}`,
  )
    .bind(Date.now())
    .all<DigestRow & { user_id: string; has_state: string | null; tz: number | null; morning: number | null }>();
  for (const r of results) {
    if (!r.has_state) {
      await env.DB.prepare('DELETE FROM digest_due WHERE user_id = ?1').bind(r.user_id).run();
      continue;
    }
    const st = toSettings(r.morning === null ? null : r);
    const tz = r.tz ?? 0;
    const now = localNow(tz);
    const mins = minutesOf(now.time);
    const last = { morning: r.last_morning, evening: r.last_evening };
    for (const kind of ['morning', 'evening'] as const) {
      const on = kind === 'morning' ? st.morning : st.evening;
      const at = minutesOf(kind === 'morning' ? st.morningTime : st.eveningTime);
      // Within 3 hours after the chosen time (a missed cron run still delivers), once a day.
      if (!on || mins < at || mins >= at + 180 || last[kind] === now.today) continue;
      await env.DB.prepare(
        `INSERT INTO digest (user_id, morning, morning_time, evening, evening_time, ${kind === 'morning' ? 'last_morning' : 'last_evening'})
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (user_id) DO UPDATE SET ${kind === 'morning' ? 'last_morning' : 'last_evening'} = ?6`,
      )
        .bind(r.user_id, st.morning ? 1 : 0, st.morningTime, st.evening ? 1 : 0, st.eveningTime, now.today)
        .run();
      last[kind] = now.today;
      await sendDigest(env, r.user_id, tz, kind, true);
    }
    await env.DB.prepare('UPDATE digest_due SET at = ?2 WHERE user_id = ?1').bind(r.user_id, nextDigestAt(st, tz, last)).run();
  }
  return results.length;
}

/* ------------------------------------------------------------ First steps for empty planners */
// Most people who leave never add a single item. Up to three short messages, in the evening of
// their local time, while the planner is still empty: each one asks for one thing they can do by
// just replying to the bot. Stops as soon as anything is added.
const NUDGES = [
  { after: 20 * 3_600_000, text: '👋 Что у вас завтра? Просто напишите или скажите голосом прямо сюда, например: «завтра в 10 врач, в 19 тренировка». Я сам разложу по времени и напомню.' },
  { after: 44 * 3_600_000, text: '💡 Одна фраза, и неделя расписана: «тренировка по вторникам и четвергам в 19:00». Я поставлю её на каждую неделю и напомню за час. Напишите сюда 👇' },
  { after: 92 * 3_600_000, text: 'Последнее от меня 🙂 Если было некогда, напишите сюда любое дело, и я его запишу. А если планер не подошёл, ответьте одним словом почему: это очень поможет сделать его лучше.' },
];

/** Approved 13.10: on. */
const NUDGES_ON = true;

/** Nudges per run: each is a message and a database write. */
const NUDGES_PER_RUN = 5;

async function sendNudges(env: Env) {
  let nudged = 0;
  if (!NUDGES_ON) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS nudges (user_id TEXT PRIMARY KEY, step INTEGER NOT NULL, at INTEGER NOT NULL)').run();
  const { results } = await env.DB.prepare(
    `SELECT s.user_id, s.first_at, st.doc, COALESCE(st.tz, u.tz, -180) AS tz, n.step, n.at
     FROM seen s LEFT JOIN state st ON st.user_id = s.user_id LEFT JOIN users u ON u.user_id = s.user_id LEFT JOIN nudges n ON n.user_id = s.user_id
     WHERE s.user_id GLOB '[0-9]*' AND COALESCE(n.step, 0) < ?1`,
  )
    .bind(NUDGES.length)
    .all<{ user_id: string; first_at: number; doc: string | null; tz: number; step: number | null; at: number | null }>();
  const now = Date.now();
  for (const r of results) {
    if (r.user_id === env.ADMIN_CHAT_ID) continue;
    try {
      const d = JSON.parse(r.doc ?? '{}') as { tasks?: unknown[]; events?: unknown[] };
      if (d.tasks?.length || d.events?.length) continue;
    } catch {
      continue;
    }
    const hour = Number(localNow(r.tz).time.slice(0, 2));
    if (hour < 18 || hour > 20) continue;
    const step = r.step ?? 0;
    const since = step === 0 ? now - (r.first_at || 0) : now - (r.at ?? 0);
    if (since < NUDGES[step].after - (step === 0 ? 0 : NUDGES[step - 1].after)) continue;
    const res = (await tg(env, 'sendMessage', { chat_id: r.user_id, text: NUDGES[step].text, reply_markup: openButton(env) }).catch(() => null)) as { ok?: boolean } | null;
    // blocked the bot → no more tries
    await env.DB.prepare('INSERT INTO nudges (user_id, step, at) VALUES (?1, ?2, ?3) ON CONFLICT (user_id) DO UPDATE SET step = ?2, at = ?3')
      .bind(r.user_id, res?.ok ? step + 1 : NUDGES.length, now)
      .run();
    await new Promise((ok) => setTimeout(ok, 60));
    if (++nudged >= NUDGES_PER_RUN) break; // the rest on the next run (every 30 min)
  }
}

/* ------------------------------------------------------------ Handler */

function cors(origin: string | null, env: Env): Record<string, string> {
  // The Mini App's site, the iOS app (its pages come from planner://app) and local development.
  const allowed = origin && (origin === env.ALLOWED_ORIGIN || origin === 'planner://app' || origin.startsWith('http://localhost')) ? origin : env.ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data, X-Device-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

type LlmResult =
  | { ok: true; data: { actions?: any[]; reply?: string | null }; usage?: unknown }
  | { ok: false; error: string; status?: number; detail?: string };

let effortOk = true;

/** Free & fast: Cloudflare Workers AI with a JSON schema. */
async function workersAi(env: Env, messages: { role: string; content: string }[]): Promise<LlmResult> {
  try {
    const r = await env.AI.run(env.WAI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages,
      response_format: { type: 'json_schema', json_schema: RESPONSE_SCHEMA },
      max_tokens: 1200,
      temperature: 0,
    });
    const data = typeof r?.response === 'string' ? JSON.parse(r.response) : r?.response;
    if (!data || !Array.isArray(data.actions)) return { ok: false, error: 'bad_completion' };
    return { ok: true, data, usage: r?.usage };
  } catch (e) {
    return { ok: false, error: 'workers_ai', detail: String(e).slice(0, 200) };
  }
}

/** Model call: Workers AI first; the paid OpenAI-compatible provider only if that fails. */
async function llm(env: Env, text: string, today: string, weekday: string, time: string, items: string): Promise<LlmResult> {
  const fast = await workersAi(env, [
    { role: 'system', content: systemPrompt(today, weekday, time) },
    { role: 'system', content: `Ближайшие дела пользователя:\n${items.slice(0, 4000) || '(пусто)'}` },
    { role: 'user', content: text },
  ]);
  if (fast.ok || !env.OPENAI_API_KEY) return keepNamedDates(fast, text, today, time);
  return keepNamedDates(await providerLlm(env, text, today, weekday, time, items), text, today, time);
}

/** A day the user named ("в воскресенье", "18 октября") is read by the rules exactly; the model
 * sometimes counts it wrong (or drops it, and the item lands on today) — the rules' date wins. */
function keepNamedDates(r: LlmResult, text: string, today: string, time: string): LlmResult {
  if (!r.ok || !Array.isArray(r.data.actions)) return r;
  const [y, m, d] = today.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  if (![y, m, d].every(Number.isFinite)) return r;
  const now = new Date(y, m - 1, d, Number.isFinite(hh) ? hh : 12, Number.isFinite(mm) ? mm : 0);
  const parts = splitRequests(text);
  const creates = r.data.actions.filter((a) => a?.intent === 'create');
  if (creates.length !== parts.length) return r;
  parts.forEach((part, i) => {
    const a = analyze(part, now);
    if (a.intent === 'create' && a.date && creates[i].date !== a.date && !creates[i].repeat) creates[i].date = a.date;
  });
  return r;
}

/** OpenAI-compatible provider (strict JSON schema, JSON-mode fallback). */
async function providerLlm(env: Env, text: string, today: string, weekday: string, time: string, items: string): Promise<LlmResult> {
  const messages = [
    { role: 'system', content: systemPrompt(today, weekday, time) },
    { role: 'system', content: `Ближайшие дела пользователя:\n${items.slice(0, 4000) || '(пусто)'}` },
    { role: 'user', content: text },
  ];
  const call = (payload: Record<string, unknown>) =>
    fetch(`${(env.API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.MODEL, max_completion_tokens: 4000, ...payload }),
    });
  const strict = { messages, response_format: { type: 'json_schema', json_schema: { name: 'planner_actions', strict: true, schema: RESPONSE_SCHEMA } } };
  // Parsing a short phrase needs little "thinking" — ask for the fast mode; remember if the provider rejects it.
  let res = effortOk ? await call({ ...strict, reasoning_effort: 'low' }) : await call(strict);
  if (res.status === 400 && effortOk) {
    effortOk = false;
    res = await call(strict);
  }
  // Some OpenAI-compatible providers don't support strict JSON schemas — fall back to JSON mode
  // with the schema spelled out in the prompt (the app validates every field anyway).
  if (res.status === 400) {
    res = await call({
      messages: [
        ...messages.slice(0, 2),
        { role: 'system', content: `Ответь ТОЛЬКО JSON-объектом по этой схеме:\n${JSON.stringify(RESPONSE_SCHEMA)}` },
        messages[2],
      ],
      response_format: { type: 'json_object' },
    });
  }
  if (!res.ok) return { ok: false, error: 'upstream', status: res.status, detail: (await res.text()).slice(0, 300) };
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: unknown };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return { ok: false, error: 'empty_completion' };
  try {
    return { ok: true, data: JSON.parse(content), usage: data.usage };
  } catch {
    return { ok: false, error: 'bad_completion' };
  }
}

/* ------------------------------------------------------------ iPhone Shortcut (voice → assistant) */

const WD_LONG = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** The user's local "now" from their stored timezone offset (JS getTimezoneOffset, minutes). */
function localNow(tz: number) {
  const d = new Date(Date.now() - tz * 60_000);
  return {
    today: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
    weekday: WD_LONG[d.getUTCDay()],
    time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`,
  };
}

/** The rules' answer when they are sure (as a model-shaped result), otherwise null. */
function rulesFirst(text: string, tz: number): LlmResult | null {
  // A Date whose UTC fields are the user's local time — the parser reads local fields, and the worker runs in UTC.
  const localDate = new Date(Date.now() - tz * 60_000);
  const parts = splitRequests(text);
  const analyses = parts.map((p) => analyze(p, localDate));
  if (!analyses.length || !analyses.every((a, i) => isConfident(a, parts[i]))) return null;
  if (analyses.some((a) => ['help', 'undo', 'smalltalk'].includes(a.intent))) return null;
  return { ok: true, data: { actions: analyses as any[], reply: null } };
}

async function shortcutUser(env: Env, key: string) {
  if (!key || key.length < 20) return null;
  const { results } = await env.DB.prepare('SELECT user_id, tz FROM users WHERE token = ?1').bind(key).all<{ user_id: string; tz: number }>();
  return results[0] ?? null;
}

const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(24)).buffer);

/* ------------------------------------------------------------ Server-side planner data */

const MAX_DOC = 900_000;

async function loadDoc(env: Env, user: string): Promise<{ doc: PlannerDoc; tz: number | null }> {
  const { results } = await env.DB.prepare('SELECT doc, tz FROM state WHERE user_id = ?1').bind(user).all<{ doc: string; tz: number | null }>();
  if (!results[0]) return { doc: emptyDoc(), tz: null };
  try {
    return { doc: JSON.parse(results[0].doc) as PlannerDoc, tz: results[0].tz };
  } catch {
    return { doc: emptyDoc(), tz: results[0].tz };
  }
}

async function saveDoc(env: Env, user: string, doc: PlannerDoc, tz: number) {
  await env.DB.prepare(
    'INSERT INTO state (user_id, doc, tz, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (user_id) DO UPDATE SET doc = ?2, tz = ?3, updated_at = ?4',
  )
    .bind(user, JSON.stringify(doc), tz, Date.now())
    .run();
  await scheduleReminders(env, user, doc, tz);
  // a Telegram user who only ever wrote to the bot still gets the summaries (no write if known)
  if (!isDeviceUser(user)) {
    await ensureDigestDue(env);
    await env.DB.prepare('INSERT INTO digest_due (user_id, at) VALUES (?1, 0) ON CONFLICT (user_id) DO NOTHING').bind(user).run();
  }
}

/** Recomputes the user's upcoming reminders from their data (35 days ahead). */
async function scheduleReminders(env: Env, user: string, doc: PlannerDoc, tz: number) {
  // The iOS app schedules its own notifications on the device; the bot can't write to it anyway.
  if (isDeviceUser(user)) return;
  const list = reminderInstances(doc.events, doc.tasks, { today: localNow(tz).today, tz });
  // Only what changed is written (a save used to rewrite every reminder 35 days ahead): writes are
  // the scarcest database resource on the free plan.
  const { results: have } = await env.DB.prepare('SELECT rid, fire_at, text, sent FROM reminders WHERE user_id = ?1')
    .bind(user)
    .all<{ rid: string; fire_at: number; text: string; sent: number }>();
  const want = new Set(list.map((r) => r.rid));
  const old = Date.now() - 2 * 86_400_000;
  const gone = new Set<string>();
  const stmts: Stmt[] = [];
  for (const r of have) {
    // removed or edited away (unsent), or delivered / failed long ago
    if ((r.sent === 0 && !want.has(r.rid)) || (r.sent !== 0 && r.fire_at < old)) {
      gone.add(r.rid);
      stmts.push(env.DB.prepare('DELETE FROM reminders WHERE user_id = ?1 AND rid = ?2').bind(user, r.rid));
    }
  }
  const byRid = new Map(have.map((r) => [r.rid, r]));
  for (const r of list) {
    const cur = byRid.get(r.rid);
    if (cur && !gone.has(r.rid) && cur.fire_at === r.at && cur.text === r.text) continue;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO reminders (user_id, rid, fire_at, text, sent) VALUES (?1, ?2, ?3, ?4, 0)
         ON CONFLICT (user_id, rid) DO UPDATE SET
           text = excluded.text,
           sent = CASE WHEN reminders.sent = 1 AND reminders.fire_at = excluded.fire_at THEN 1 ELSE 0 END,
           fire_at = excluded.fire_at`,
      ).bind(user, r.rid, r.at, r.text),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
}

/**
 * Daily (from 03:00 UTC): roll every Telegram user's 35-day reminder window forward, even if the
 * planner is never opened. A few users per minute — one run may make only 50 database queries on
 * the free plan, so doing everyone at once stopped part-way.
 */
const ROLL_PER_RUN = 4;
async function rollStep(env: Env) {
  const nowUtc = new Date();
  if (nowUtc.getUTCHours() < 3) return;
  const day = nowUtc.toISOString().slice(0, 10);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS jobs (name TEXT PRIMARY KEY, day TEXT NOT NULL, cursor TEXT NOT NULL)').run();
  const { results: job } = await env.DB.prepare("SELECT day, cursor FROM jobs WHERE name = 'roll'").all<{ day: string; cursor: string }>();
  const done = '\uffff';
  if (job[0]?.day === day && job[0].cursor === done) return;
  const cursor = job[0]?.day === day ? job[0].cursor : '';
  const { results } = await env.DB.prepare(`SELECT user_id, doc, tz FROM state WHERE user_id > ?1 AND user_id NOT LIKE 'dev:%' ORDER BY user_id LIMIT ${ROLL_PER_RUN}`)
    .bind(cursor)
    .all<{ user_id: string; doc: string; tz: number | null }>();
  for (const r of results) {
    try {
      await scheduleReminders(env, r.user_id, JSON.parse(r.doc), r.tz ?? 0);
    } catch {
      /* skip a broken row */
    }
  }
  const next = results.length < ROLL_PER_RUN ? done : results[results.length - 1].user_id;
  await env.DB.prepare("INSERT INTO jobs (name, day, cursor) VALUES ('roll', ?1, ?2) ON CONFLICT (name) DO UPDATE SET day = ?1, cursor = ?2").bind(day, next).run();
}

/** Light sanity check of a document coming from a client. */
function cleanDoc(raw: any): PlannerDoc | null {
  if (!raw || !Array.isArray(raw.tasks) || !Array.isArray(raw.events)) return null;
  const ok = (x: any) => x && typeof x.id === 'string' && typeof x.title === 'string' && typeof x.createdAt === 'number';
  return {
    tasks: raw.tasks.filter(ok).slice(0, 3000),
    events: raw.events.filter((e: any) => ok(e) && typeof e.date === 'string' && typeof e.start === 'string' && typeof e.end === 'string').slice(0, 3000),
    deleted: raw.deleted && typeof raw.deleted === 'object' ? raw.deleted : {},
  };
}

type Stmt = ReturnType<Env['DB']['prepare']>;

/* ------------------------------------------------------------ Telegram → app transfer
 * The bot (or the planner in Telegram) gives a one-time 6-digit code; the iPhone/Mac app sends it
 * with its device key, and the Telegram planner is merged into the app's own account. */
const TRANSFER_TTL = 10 * 60_000;
async function transferCode(env: Env, user: string): Promise<string> {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS transfer_codes (code TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL)').run();
  await env.DB.prepare('DELETE FROM transfer_codes WHERE user_id = ?1 OR expires < ?2').bind(user, Date.now()).run();
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const code = String(n).padStart(6, '0');
  await env.DB.prepare('INSERT OR REPLACE INTO transfer_codes (code, user_id, expires) VALUES (?1, ?2, ?3)').bind(code, user, Date.now() + TRANSFER_TTL).run();
  return code;
}
const transferText = (code: string) =>
  `📲 Код для приложения ПЛАН: <code>${code}</code>\n\nВ приложении на iPhone или Mac: Настройки → «Перенести из бота» → введите код. Ваши события и задачи добавятся туда, здесь всё останется как было.\n\nКод действует 10 минут, никому его не пересылайте.`;

/** Tables keyed by user_id. Some are created lazily, so a missing one is skipped. */
const USER_TABLES = ['transfer_codes', 'state', 'reminders', 'users', 'queue', 'digest', 'feedback', 'seen', 'nudges', 'tg_names', 'calendar_feed', 'broadcast_sent', 'wallpaper_b64', 'wallpaper_pending', 'wallpaper_hits', 'digest_due'];

async function deleteAccount(env: Env, user: string) {
  for (const table of USER_TABLES) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?1`).bind(user).run().catch(() => null);
  }
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS wiped (user_id TEXT PRIMARY KEY, at INTEGER NOT NULL)').run();
  await env.DB.prepare('INSERT INTO wiped (user_id, at) VALUES (?1, ?2) ON CONFLICT (user_id) DO UPDATE SET at = ?2').bind(user, Date.now()).run();
}

async function wipedSince(env: Env, user: string): Promise<number | null> {
  const r = await env.DB.prepare('SELECT at FROM wiped WHERE user_id = ?1').bind(user).all<{ at: number }>().catch(() => null);
  return r?.results[0]?.at ?? null;
}

/** Every minute: send what is due. Reminders more than 6 h late are dropped silently. */
/** Reminders per cron run: each is one outgoing request (the free plan allows 50 per run). */
const REMINDERS_PER_RUN = 25;

async function sendDue(env: Env) {
  const now = Date.now();
  await env.DB.prepare('UPDATE reminders SET sent = 3 WHERE sent = 0 AND fire_at < ?1').bind(now - 6 * 3600_000).run();
  const { results } = await env.DB.prepare(`SELECT user_id, rid, text FROM reminders WHERE sent = 0 AND fire_at <= ?1 ORDER BY fire_at LIMIT ${REMINDERS_PER_RUN}`)
    .bind(now + 20_000)
    .all<{ user_id: string; rid: string; text: string }>();
  const done: Stmt[] = [];
  try {
    for (const r of results) {
      const res = await tg(env, 'sendMessage', { chat_id: r.user_id, text: r.text, ...(r.rid.startsWith('diag:plain') ? {} : { reply_markup: openButton(env, r.rid) }) }).catch((e) => ({
        ok: false,
        description: String(e),
      }));
      // Keep Telegram's answer so delivery problems are visible (sent = 2 → failed).
      done.push(
        env.DB.prepare('UPDATE reminders SET sent = ?3, error = ?4 WHERE user_id = ?1 AND rid = ?2').bind(
          r.user_id,
          r.rid,
          res.ok ? 1 : 2,
          res.ok ? null : String(res.description ?? 'unknown').slice(0, 300),
        ),
      );
    }
  } finally {
    // one batch for the whole run, written even if the loop stopped: nothing is sent twice
    if (done.length) await env.DB.batch(done);
  }
}

/** Runs one dictated phrase on the user's server copy; returns the answer for the notification. */
async function runShortcut(env: Env, user: string, tz: number, text: string): Promise<{ answer: string; doc: PlannerDoc | null }> {
  // The Shortcut waits for the result and shows it as an iPhone notification.
  const now = localNow(tz);
  // Simple phrases: offline rules, instantly. Otherwise the model.
  const r = rulesFirst(text, tz) ?? (await llm(env, text, now.today, now.weekday, now.time, ''));
  const actions = r.ok ? (r.data.actions ?? []).map((a: any) => guardNoteMode(a, text)) : null;

  // Run it on the server copy right away; only what needs the user goes to the app.
  let changed = false;
  let savedDoc: PlannerDoc | null = null;
  let lines: string[] = [];
  let unresolved: any[] | null = actions;
  if (actions?.length) {
    const stored = await loadDoc(env, user);
    const res = execute(stored.doc, actions, { today: now.today, now: Date.now(), nowMinutes: timeToMinutes(now.time), newId: () => crypto.randomUUID() });
    lines = res.lines;
    unresolved = res.unresolved;
    changed = JSON.stringify(res.doc) !== JSON.stringify(stored.doc);
    if (changed) await saveDoc(env, user, res.doc, stored.tz ?? tz);
    savedDoc = res.doc;
  }
  // A plan without a time is asked about right in the reply below — not queued for the assistant too.
  const noTime = unresolved?.find((u: any) => u?.intent === 'create' && !u.start && u.title);
  if (!actions || (unresolved?.length && !(noTime && unresolved.length === 1))) {
    await env.DB.prepare('INSERT INTO queue (user_id, text, actions, created_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(user, text, actions ? JSON.stringify(unresolved) : null, Date.now())
      .run();
  }
  const body = lines.join('; ');
  // A plan without a time: ask right here, with a phrase to answer (the chat can't hold a question).
  const pending = noTime
    ? `Во сколько «${noTime.title}»? Напишите вместе со временем, например: «${String(noTime.title).toLowerCase()} в 15:00».`
    : !actions || unresolved?.length
      ? 'Нужно уточнение — вопрос ждёт в ассистенте.'
      : '';
  // "Готово ✅" only when something changed; answers to questions (schedule, a note) come as they are.
  const answer = lines.length
    ? `${changed ? 'Готово ✅ ' : ''}${body.charAt(0).toUpperCase()}${body.slice(1)}${/[.:]$/.test(body) ? '' : '.'}${pending ? ` ${pending}` : ''}`
    : r.ok && r.data.reply && !unresolved?.length
      ? String(r.data.reply)
      : pending || `Нужно уточнение — вопрос ждёт в ассистенте.`;
  return { answer, doc: changed ? savedDoc : null };
}

export default {
  async scheduled(_controller: { cron?: string }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    if (env.APP_ONLY) return; // the app keeps its reminders on the device: nothing to send
    // One run may make 50 database queries and 50 outgoing requests (free plan): the jobs take turns.
    ctx.waitUntil(
      (async () => {
        await sendDue(env);
        const digests = await sendDigests(env);
        if (new Date().getUTCMinutes() % 30 === 0) await sendNudges(env);
        else if (digests < 3) await rollStep(env);
      })().catch((e) => console.error('cron', String(e))),
    );
  },

  async fetch(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    const headers = cors(request.headers.get('Origin'), env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    const url = new URL(request.url);

    // The app imports the Telegram planner by a one-time code: read here (the bot's database), merged there.
    if (env.APP && request.method === 'POST' && url.pathname === '/transfer/import') {
      const key = request.headers.get('X-Device-Key') ?? '';
      if (!/^[0-9a-f]{64}$/.test(key)) return json({ error: 'unauthorized' }, 401, headers);
      if (rateLimited(`t:${key.slice(0, 16)}`)) return json({ error: 'rate_limited' }, 429, headers);
      const body = (await request.json().catch(() => ({}))) as { code?: string; tz?: number };
      const code = String(body.code ?? '').replace(/\D/g, '');
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS transfer_codes (code TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL)').run();
      const { results } = await env.DB.prepare('SELECT user_id, expires FROM transfer_codes WHERE code = ?1').bind(code).all<{ user_id: string; expires: number }>();
      const row = results[0];
      if (!row || row.expires < Date.now()) return json({ error: 'bad_code' }, 404, headers);
      await env.DB.prepare('DELETE FROM transfer_codes WHERE code = ?1').bind(code).run();
      const { doc, tz } = await loadDoc(env, row.user_id);
      const res = await env.APP.fetch(
        new Request(new URL('/state/sync', request.url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Device-Key': key },
          body: JSON.stringify({ doc, tz: Number.isFinite(body.tz) ? Math.round(body.tz!) : (tz ?? 0) }),
        }),
      );
      if (!res.ok) return json({ error: 'merge_failed' }, 502, headers);
      return json({ ok: true, events: doc.events.length, tasks: doc.tasks.length }, 200, headers);
    }
    if (request.method === 'POST' && url.pathname === '/transfer/code') {
      const user = await authUser(request, env);
      if (!user || user === 'anon' || isDeviceUser(user)) return json({ error: 'unauthorized' }, 401, headers);
      return json({ code: await transferCode(env, user), ttl: TRANSFER_TTL }, 200, headers);
    }

    // The iPhone / Mac app lives on its own server and database («plan-app»): everything it sends
    // carries a device key and is handed over as is. Telegram requests never do.
    if (env.APP && request.headers.has('X-Device-Key') && !request.headers.has('X-Telegram-Init-Data')) return env.APP.fetch(request);
    // The app's server answers the app only.
    if (env.APP_ONLY && (url.pathname.startsWith('/telegram/') || url.pathname.startsWith('/wallpaper') || url.pathname === '/shortcut')) {
      return json({ error: 'not_here' }, 404, headers);
    }

    // Telegram → bot updates.
    if (request.method === 'POST' && url.pathname === '/telegram/webhook') {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== (await webhookSecret(env))) return new Response('forbidden', { status: 403 });
      try {
        await onTelegramUpdate(await request.json(), env);
      } catch {
        /* never make Telegram retry */
      }
      return new Response('ok');
    }
    // One-time setup: point the bot's webhook at this worker (idempotent; it can only ever point here).
    if (request.method === 'POST' && url.pathname === '/telegram/setup') {
      const result = await tg(env, 'setWebhook', {
        url: `${url.origin}/telegram/webhook`,
        secret_token: await webhookSecret(env),
        allowed_updates: ['message'],
        drop_pending_updates: true,
      });
      // The bot's command menu (+ /stats in the admin's chat only).
      const commands = [
        { command: 'today', description: 'План на сегодня' },
        { command: 'tomorrow', description: 'План на завтра' },
        { command: 'start', description: 'Открыть планер' },
      ];
      await tg(env, 'setMyCommands', { commands });
      if (env.ADMIN_CHAT_ID)
        await tg(env, 'setMyCommands', { commands: [...commands, { command: 'stats', description: 'Статистика (только вам)' }], scope: { type: 'chat', chat_id: Number(env.ADMIN_CHAT_ID) } });
      return json({ ok: result.ok, description: result.description }, 200, headers);
    }

    // Two-way sync: merge the app's document with the server copy, store, return the result.
    if (request.method === 'POST' && url.pathname === '/state/sync') {
      const user = await authUser(request, env);
      if (!user || user === 'anon') return json({ error: 'unauthorized' }, 401, headers);
      const body = (await request.json().catch(() => null)) as { doc?: unknown; tz?: number } | null;
      const incoming = cleanDoc(body?.doc);
      if (!incoming) return json({ error: 'bad_doc' }, 400, headers);
      // After «Удалить мои данные» another device of the same account may still hold the old copy:
      // anything created before the wipe is not taken back.
      const wipedAt = await wipedSince(env, user);
      if (wipedAt) {
        incoming.tasks = incoming.tasks.filter((t) => t.createdAt >= wipedAt);
        incoming.events = incoming.events.filter((e) => e.createdAt >= wipedAt);
      }
      const stored = await loadDoc(env, user);
      const tz = Number.isFinite(body?.tz) ? Math.round(body!.tz!) : (stored.tz ?? 0);
      const merged = mergeDocs(stored.doc, incoming);
      if (JSON.stringify(merged).length > MAX_DOC) return json({ error: 'too_large' }, 413, headers);
      await saveDoc(env, user, merged, tz);
      await env.DB.prepare('UPDATE users SET tz = ?2 WHERE user_id = ?1').bind(user, tz).run();
      // a new Telegram user or a new timezone: the summary time is worked out again
      if (!isDeviceUser(user) && (stored.tz === null || stored.tz !== tz)) ctx.waitUntil(recheckDigest(env, user).catch(() => null));
      ctx.waitUntil(track(env, null, user));
      return json({ doc: merged }, 200, headers);
    }

    // Calendar subscription: the personal link (app) and the feed / subscribe page (public, by secret token).
    if (request.method === 'POST' && url.pathname === '/calendar') {
      const user = await authUser(request, env);
      if (!user || user === 'anon') return json({ error: 'unauthorized' }, 401, headers);
      const body = (await request.json().catch(() => ({}))) as { reset?: boolean; tasks?: boolean };
      await ensureFeedTable(env);
      const { results } = await env.DB.prepare('SELECT token, tasks FROM calendar_feed WHERE user_id = ?1').bind(user).all<{ token: string; tasks: number }>();
      const token = results[0] && !body.reset ? results[0].token : randomToken();
      const tasks = typeof body.tasks === 'boolean' ? body.tasks : results[0] ? Boolean(results[0].tasks) : true;
      await env.DB.prepare(
        'INSERT INTO calendar_feed (user_id, token, tasks, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (user_id) DO UPDATE SET token = ?2, tasks = ?3',
      )
        .bind(user, token, tasks ? 1 : 0, Date.now())
        .run();
      return json({ ...feedLinks(PUBLIC_ORIGIN, token), tasks }, 200, headers);
    }
    const cal = url.pathname.match(/^\/cal\/([0-9a-f]{40,64})(\.ics)?$/);
    if (request.method === 'GET' && cal) {
      await ensureFeedTable(env);
      const { results } = await env.DB.prepare('SELECT user_id, tasks FROM calendar_feed WHERE token = ?1').bind(cal[1]).all<{ user_id: string; tasks: number }>();
      const feed = results[0];
      // app users' calendar links live in the app's database
      if (!feed && env.APP) return env.APP.fetch(request);
      if (!feed) return new Response('Ссылка устарела — получите новую в планере: Настройки → Календарь iPhone.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      if (!cal[2]) return new Response(subscribePage(feedLinks(PUBLIC_ORIGIN, cal[1])), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      const { doc, tz } = await loadDoc(env, feed.user_id);
      const ics = buildIcs(doc, { today: localNow(tz ?? 0).today, appUrl: env.APP_URL, tasks: Boolean(feed.tasks) });
      return new Response(ics, {
        headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="planner.ics"', 'Cache-Control': 'max-age=300' },
      });
    }

    // Summary settings / a sample now / feedback — from the app's settings sheet.
    if (request.method === 'POST' && ['/settings', '/digest/test', '/feedback'].includes(url.pathname)) {
      const user = await authUser(request, env);
      if (!user || user === 'anon') return json({ error: 'unauthorized' }, 401, headers);
      const body = (await request.json().catch(() => ({}))) as { digest?: Partial<DigestSettings>; kind?: string; text?: string; tz?: number };
      if (url.pathname === '/settings') {
        const digest = body.digest ? await setDigest(env, user, body.digest) : await getDigest(env, user);
        if (body.digest) await recheckDigest(env, user);
        return json({ digest }, 200, headers);
      }
      if (url.pathname === '/digest/test') {
        const { tz } = await loadDoc(env, user);
        const ok = await sendDigest(env, user, Number.isFinite(body.tz) ? Math.round(body.tz!) : (tz ?? 0), body.kind === 'evening' ? 'evening' : 'morning');
        return json({ ok }, 200, headers);
      }
      const text = String(body.text ?? '').trim().slice(0, 2000);
      if (!text) return json({ error: 'empty' }, 400, headers);
      if (rateLimited(`f:${user}`)) return json({ error: 'rate' }, 429, headers);
      await ensureDigestTables(env);
      await env.DB.prepare('INSERT INTO feedback (user_id, text, created_at) VALUES (?1, ?2, ?3)').bind(user, text, Date.now()).run();
      if (env.ADMIN_CHAT_ID) await tg(env, 'sendMessage', { chat_id: env.ADMIN_CHAT_ID, text: `💬 Отзыв от ${user}:\n\n${text}` }).catch(() => null);
      return json({ ok: true }, 200, headers);
    }

    // iPhone Shortcut: dictated text → model → queued for the app; the bot confirms.
    if (request.method === 'POST' && url.pathname === '/shortcut') {
      const u = await shortcutUser(env, url.searchParams.get('key') ?? (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, ''));
      const plain = (t: string, status = 200) => new Response(t, { status, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
      if (!u) return plain('Неверный ключ. Скопируйте ссылку заново: планер → Ассистент → «Кнопка на iPhone».', 401);
      if (rateLimited(`s:${u.user_id}`)) return plain('Слишком много запросов, подождите минуту.', 429);
      ctx.waitUntil(track(env, 'shortcut', u.user_id));
      const raw = await request.text();
      let text = raw;
      try {
        const j = JSON.parse(raw);
        text = String(j.text ?? j.Text ?? Object.values(j)[0] ?? '');
      } catch {
        const form = new URLSearchParams(raw);
        if (form.get('text')) text = form.get('text')!;
      }
      text = text.slice(0, MAX_TEXT).trim();
      if (!text) return plain('Не расслышал — попробуйте ещё раз.', 400);

      return plain((await runShortcut(env, u.user_id, u.tz ?? 0, text)).answer);
    }

    // The iOS app's «Добавить в ПЛАН» (App Intent, works with the app closed): same as above, the
    // account is the device key; answers with the text and the fresh list of local reminders.
    if (request.method === 'POST' && url.pathname === '/shortcut/device') {
      const user = await authUser(request, env);
      if (!user || !isDeviceUser(user)) return json({ error: 'unauthorized' }, 401, headers);
      if (rateLimited(`s:${user}`)) return json({ error: 'rate_limited' }, 429, headers);
      ctx.waitUntil(track(env, 'shortcut', user));
      const body = (await request.json().catch(() => ({}))) as { text?: string; tz?: number };
      const text = String(body.text ?? '').slice(0, MAX_TEXT).trim();
      if (!text) return json({ answer: 'Не расслышал — попробуйте ещё раз.', reminders: null }, 200, headers);
      const tz = Number.isFinite(body.tz) ? Math.round(body.tz!) : 0;
      const res = await runShortcut(env, user, tz, text);
      const reminders = res.doc ? nativeReminders(res.doc, tz) : null;
      const snapshot = res.doc ? { ...widgetSnapshot(res.doc, localNow(tz).today), at: Date.now() } : null;
      return json({ answer: res.answer, reminders, snapshot }, 200, headers);
    }

    // A tap on a task's circle in the iOS widget: done (an overdue one leaves the list, as in the
    // app). Answers with the fresh widget data and reminders.
    if (request.method === 'POST' && url.pathname === '/task/done') {
      const user = await authUser(request, env);
      if (!user || !isDeviceUser(user)) return json({ error: 'unauthorized' }, 401, headers);
      const body = (await request.json().catch(() => ({}))) as { id?: string; tz?: number };
      const stored = await loadDoc(env, user);
      const tz = Number.isFinite(body.tz) ? Math.round(body.tz!) : (stored.tz ?? 0);
      const today = localNow(tz).today, now = Date.now();
      const doc = stored.doc;
      const task = doc.tasks.find((t) => t.id === body.id);
      if (task && !task.done) {
        if (task.date && task.date < today) {
          doc.tasks = doc.tasks.filter((t) => t.id !== task.id);
          doc.deleted[task.id] = now;
        } else {
          doc.tasks = doc.tasks.map((t) => (t.id === task.id ? { ...t, done: true, completedAt: now, updatedAt: now } : t));
        }
        await saveDoc(env, user, doc, tz);
      }
      return json({ ok: Boolean(task), snapshot: { ...widgetSnapshot(doc, today), at: now }, reminders: nativeReminders(doc, tz) }, 200, headers);
    }

    // iOS app in the background (wallpaper action, background refresh): the fresh widget data
    // and local reminders from the server copy.
    if (request.method === 'POST' && url.pathname === '/snapshot') {
      const user = await authUser(request, env);
      if (!user || !isDeviceUser(user)) return json({ error: 'unauthorized' }, 401, headers);
      const body = (await request.json().catch(() => ({}))) as { tz?: number };
      const stored = await loadDoc(env, user);
      const tz = Number.isFinite(body.tz) ? Math.round(body.tz!) : (stored.tz ?? 0);
      const { results } = await env.DB.prepare('SELECT updated_at FROM state WHERE user_id = ?1').bind(user).all<{ updated_at: number }>();
      const at = results[0]?.updated_at ?? 0;
      return json({ snapshot: { ...widgetSnapshot(stored.doc, localNow(tz).today), at }, reminders: nativeReminders(stored.doc, tz), at }, 200, headers);
    }

    // The Mini App uploads the drawn wallpaper for a day (body: JPEG as base64 text, ?day=YYYY-MM-DD).
    if (request.method === 'POST' && url.pathname === '/wallpaper') {
      const user = await authUser(request, env);
      if (!user || user === 'anon') return json({ error: 'unauthorized' }, 401, headers);
      const day = url.searchParams.get('day') ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: 'bad_day' }, 400, headers);
      const today = url.searchParams.get('today') ?? '';
      const keepFrom = /^\d{4}-\d{2}-\d{2}$/.test(today) ? addDaysKey(today, -1) : addDaysKey(day, -2);
      const img = (await request.text()).replace(/^data:image\/\w+;base64,/, '');
      if (!img.length || img.length > MAX_WALLPAPER || !/^[A-Za-z0-9+/=]+$/.test(img.slice(0, 200))) return json({ error: 'bad_image' }, 413, headers);
      await ensureWallpaper(env);
      await env.DB.batch([
        env.DB.prepare('INSERT INTO wallpaper_b64 (user_id, day, img, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (user_id, day) DO UPDATE SET img = ?3, updated_at = ?4').bind(user, day, img, Date.now()),
        // Days ahead are drawn in advance (for when the planner isn't opened), so keep from yesterday on.
        env.DB.prepare('DELETE FROM wallpaper_b64 WHERE user_id = ?1 AND day < ?2').bind(user, keepFrom),
      ]);
      return json({ ok: true }, 200, headers);
    }
    // The planner says a fresh picture is coming (sent right on a change, before the upload).
    if (request.method === 'POST' && url.pathname === '/wallpaper/pending') {
      const user = await authUser(request, env);
      if (!user || user === 'anon') return json({ error: 'unauthorized' }, 401, headers);
      await ensureWallpaper(env);
      await env.DB.prepare('INSERT INTO wallpaper_pending (user_id, at) VALUES (?1, ?2) ON CONFLICT (user_id) DO UPDATE SET at = ?2').bind(user, Date.now()).run();
      return json({ ok: true }, 200, headers);
    }
    // The Shortcut: today's wallpaper by the personal link (same key as the voice Shortcut).
    const wp = url.pathname.match(/^\/wallpaper\/([0-9a-f]{20,64})(?:\.jpg)?$/);
    if (request.method === 'GET' && wp) {
      const u = await shortcutUser(env, wp[1]);
      if (!u) return new Response('Неверная ссылка', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      await ensureWallpaper(env);
      const t0 = Date.now();
      const today = localNow(u.tz ?? 0).today;
      // Closing Telegram right after a change starts the Shortcut while the planner is still
      // uploading: wait briefly for that upload instead of handing out the old picture. Kept short:
      // the automation's request times out on a slow mobile network, and an older picture is better than none.
      for (let i = 0; i < 8; i++) {
        const { results: st } = await env.DB.prepare(
          'SELECT p.at AS pending, (SELECT updated_at FROM wallpaper_b64 WHERE user_id = ?1 AND day = ?2) AS done FROM wallpaper_pending p WHERE p.user_id = ?1',
        )
          .bind(u.user_id, today)
          .all<{ pending: number; done: number | null }>();
        const p = st[0];
        if (!p || (p.done ?? 0) >= p.pending || Date.now() - p.pending > 10_000) break;
        await new Promise((r) => setTimeout(r, 400));
      }
      // Today's image (drawn the day before as "tomorrow" if the planner wasn't opened since).
      const { results } = await env.DB.prepare('SELECT img FROM wallpaper_b64 WHERE user_id = ?1 AND day <= ?2 ORDER BY day DESC LIMIT 1')
        .bind(u.user_id, today)
        .all<{ img: string }>();
      const raw = results[0]?.img;
      const via = String((request as unknown as { cf?: { asOrganization?: string } }).cf?.asOrganization ?? '').slice(0, 60);
      ctx.waitUntil(
        env.DB.prepare('INSERT INTO wallpaper_hits (user_id, at, via, ms) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (user_id) DO UPDATE SET at = ?2, via = ?3, ms = ?4, n = n + 1')
          .bind(u.user_id, Date.now(), via, Date.now() - t0)
          .run()
          .catch(() => {}),
      );
      if (!raw) return new Response('Откройте планер в Telegram, чтобы нарисовать обои', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      return new Response(fromBase64(raw) as unknown as BodyInit, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } });
    }

    // Personal key for the Shortcut (issued to the signed-in Mini App user).
    if (request.method === 'POST' && url.pathname === '/shortcut/token') {
      const user = await authUser(request, env);
      if (!user || user === 'anon') return json({ error: 'unauthorized' }, 401, headers);
      const body = (await request.json().catch(() => ({}))) as { tz?: number; reset?: boolean };
      const tz = Number.isFinite(body.tz) ? Math.round(body.tz!) : 0;
      const { results } = await env.DB.prepare('SELECT token FROM users WHERE user_id = ?1').bind(user).all<{ token: string }>();
      const token = results[0]?.token && !body.reset ? results[0].token : randomToken();
      await env.DB.prepare('INSERT INTO users (user_id, token, tz) VALUES (?1, ?2, ?3) ON CONFLICT (user_id) DO UPDATE SET token = ?2, tz = ?3')
        .bind(user, token, tz)
        .run();
      return json({ token, url: `${PUBLIC_ORIGIN}/shortcut?key=${token}` }, 200, headers);
    }

    // The bot sends the personal link to the chat: in Telegram a tap on <code> copies it, which
    // works even where the Mini App can't write to the clipboard.
    if (request.method === 'POST' && url.pathname === '/shortcut/send') {
      const user = await authUser(request, env);
      if (!user || user === 'anon' || isDeviceUser(user)) return json({ error: 'unauthorized' }, 401, headers);
      if (rateLimited(`l:${user}`)) return json({ error: 'rate_limited' }, 429, headers);
      const body = (await request.json().catch(() => ({}))) as { kind?: string };
      const { results } = await env.DB.prepare('SELECT token FROM users WHERE user_id = ?1').bind(user).all<{ token: string }>();
      const token = results[0]?.token;
      if (!token) return json({ error: 'no_token' }, 404, headers);
      const wallpaper = body.kind === 'wallpaper';
      const link = wallpaper ? `${PUBLIC_ORIGIN}/wallpaper/${token}.jpg` : `${PUBLIC_ORIGIN}/shortcut?key=${token}`;
      const text = wallpaper
        ? `🖼 Ссылка для команды «Обои ПЛАН» — нажмите на неё, чтобы скопировать:\n\n<code>${link}</code>\n\nПотом откройте команду и вставьте ссылку. Никому её не пересылайте.`
        : `🎙 Ссылка для команды «Планер» — нажмите на неё, чтобы скопировать:\n\n<code>${link}</code>\n\nПотом откройте команду и вставьте ссылку. Никому её не пересылайте.`;
      const r = (await tg(env, 'sendMessage', { chat_id: user, parse_mode: 'HTML', text }).catch(() => null)) as { ok?: boolean } | null;
      return json({ ok: Boolean(r?.ok) }, r?.ok ? 200 : 502, headers);
    }

    // The app collects what was dictated via the Shortcut and applies it locally.
    if (request.method === 'POST' && url.pathname === '/shortcut/pull') {
      const user = await authUser(request, env);
      if (!user || user === 'anon') return json({ error: 'unauthorized' }, 401, headers);
      const { results } = await env.DB.prepare('SELECT id, text, actions FROM queue WHERE user_id = ?1 ORDER BY id LIMIT 20')
        .bind(user)
        .all<{ id: number; text: string; actions: string | null }>();
      if (results.length) await env.DB.prepare('DELETE FROM queue WHERE user_id = ?1 AND id <= ?2').bind(user, results[results.length - 1].id).run();
      return json({ items: results.map((r) => ({ text: r.text, actions: r.actions ? JSON.parse(r.actions) : null })) }, 200, headers);
    }

    // «Удалить мои данные»: everything stored for this account, on every table, goes away.
    if (request.method === 'POST' && url.pathname === '/account/delete') {
      const user = await authUser(request, env);
      if (!user || user === 'anon') return json({ error: 'unauthorized' }, 401, headers);
      await deleteAccount(env, user);
      return json({ ok: true }, 200, headers);
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      const me = (await tg(env, 'getMe', {}).catch(() => null)) as { result?: { username?: string } } | null;
      return json(
        { ok: true, model: env.WAI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', fallback: env.MODEL, bot: me?.result?.username ?? null },
        200,
        headers,
      );
    }
    if (request.method !== 'POST' || url.pathname !== '/analyze') return json({ error: 'not_found' }, 404, headers);

    const user = await authUser(request, env);
    if (!user) return json({ error: 'unauthorized' }, 401, headers);
    if (rateLimited(user)) return json({ error: 'rate_limited' }, 429, headers);
    ctx.waitUntil(track(env, 'ai', user));

    let body: { text?: string; today?: string; weekday?: string; time?: string; items?: string };
    try {
      body = await request.json();
    } catch {
      return json({ error: 'bad_json' }, 400, headers);
    }
    const text = String(body.text ?? '').slice(0, MAX_TEXT).trim();
    if (!text) return json({ error: 'empty' }, 400, headers);

    const r = await llm(env, text, String(body.today), String(body.weekday), String(body.time), String(body.items ?? ''));
    if (!r.ok) return json({ error: r.error, status: r.status, detail: r.detail }, 502, headers);
    return json({ ...r.data, usage: r.usage }, 200, headers);
  },
};
