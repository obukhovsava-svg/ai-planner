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
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(query: string): D1Stmt;
  batch(statements: D1Stmt[]): Promise<unknown>;
}

interface Env {
  DB: D1Database;
  OPENAI_API_KEY: string;
  BOT_TOKEN: string;
  MODEL: string;
  API_BASE: string;
  ALLOWED_ORIGIN: string;
  APP_URL: string;
}

const MAX_TEXT = 600;
const RATE_PER_MIN = 20;
const hits = new Map<string, number[]>();

/* ------------------------------------------------------------ Telegram initData */

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Validates Telegram Mini App initData; returns the user id or null. */
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
    'eventHint', 'taskHint', 'priority', 'category', 'range', 'sourceDate', 'all', 'targetKind', 'bulk',
    'remind', 'remindOffset', 'remindCancel',
  ],
  properties: {
    intent: { type: 'string', enum: ['create', 'agenda', 'delete', 'move', 'complete', 'remind', 'undo', 'help', 'smalltalk'] },
    title: { type: 'string', description: 'create: short title in nominative case. delete/move/complete: what to look for.' },
    date: nullable('string', { description: 'YYYY-MM-DD. For move: the NEW date.' }),
    start: nullable('string', { description: 'HH:MM, 24h' }),
    end: nullable('string', { description: 'HH:MM, 24h' }),
    duration: nullable('integer', { description: 'minutes, only if said ("на час")' }),
    repeat: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['freq', 'interval', 'byWeekday', 'cycle', 'until'],
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
    all: { type: 'boolean', description: 'delete: whole series of one repeating thing ("все тренировки")' },
    targetKind: nullable('string', { enum: ['event', 'task', 'any', null], description: 'delete/move: which kind is meant ("удали событие" → event, "все задачи" → task, "все дела" → any)' }),
    remind: { type: 'boolean', description: 'create: the new item should get a reminder ("напомни купить хлеб в 10")' },
    remindOffset: nullable('integer', { description: 'minutes before ("за час" → 60, "за день" → 1440); 0 = at the time; null if not said' }),
    remindCancel: { type: 'boolean', description: 'remind: switch a reminder OFF ("убери напоминание о …")' },
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

function systemPrompt(today: string, weekday: string, time: string): string {
  return `Ты — разбор команд для русскоязычного планировщика (календарь + задачи) в Telegram.
Сегодня ${today} (${weekday}), сейчас ${time}. Неделя начинается с понедельника.

Преврати сообщение пользователя в список действий (actions) строго по JSON-схеме. Одно сообщение может содержать несколько дел.
Правила:
- НЕ выдумывай. Если дата, время начала или конца не названы — ставь null (приложение само переспросит).
- Относительные даты («завтра», «в пятницу», «через неделю», «15-го») переводи в YYYY-MM-DD относительно сегодняшней даты. «В пятницу» = ближайшая будущая пятница.
- Время в 24-часовом формате. «В 3» про встречу днём = 15:00; «в 9 утра» = 09:00; «вечером» без числа = 19:00.
- «с 9 до 21» → start 09:00, end 21:00. «на час» → duration 60.
- Повторы: «каждый понедельник» → freq week, interval 1 (date = ближайший понедельник, можно сегодня); «по вторникам и четвергам» → byWeekday [1,3]; «по будням» → [0,1,2,3,4]; «каждые 2 недели» → interval 2; «ежедневно» → day.
- Графики смен: «2/2», «2 через 2», «график 2 на 2» → freq day, interval 1, cycle {on:2, off:2}; «сутки через трое» → cycle {on:1, off:3}, start 08:00, end 23:59; «5/2» → week, byWeekday [0..4]. Если не сказано, с какого дня начинается график — date null и needsStart true.
- title: коротко, с заглавной буквы, в именительном падеже («встречу с Анной» → «Встреча с Анной»), без дат, времени и слов «поставь/добавь/напомни».
- move («перенеси X на …»): title = что ищем, date/start/end = новое время, sourceDate = откуда («со среды»).
- delete («удали/отмени X»), complete («я сделал X», «отметь X выполненной»): title = что ищем, date — если указан день.
- Массовое удаление («удали все события на понедельник», «удали все задачи», «очисти всё на завтра», «удали все дела на неделе»): intent delete, bulk true, title "", targetKind event/task/any, date или range.
- Если не названо, что именно удалить/перенести («удали», «перенеси задачу», «удали событие»): title "", targetKind по слову — приложение само покажет список на выбор.
- Если при переносе не сказано, на когда («перенеси встречу с Анной»): date и start null — приложение спросит.
- Напоминания о СУЩЕСТВУЮЩЕМ деле («напомни о встрече с Анной за час», «напомни за 15 минут до тренировки», «напоминай за день до каждой смены», «поставь напоминание на обед»): intent remind, title = что ищем (в именительном падеже), remindOffset если сказано за сколько, иначе null.
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

function openButton(env: Env) {
  return { inline_keyboard: [[{ text: '📅 Открыть планер', web_app: { url: env.APP_URL } }]] };
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

  await tg(env, 'sendMessage', {
    chat_id: msg.chat.id,
    text: 'Всё планирование — внутри приложения. Откройте планер и скажите ассистенту, что добавить 👇',
    reply_markup: openButton(env),
  });
}

/* ------------------------------------------------------------ Handler */

function cors(origin: string | null, env: Env): Record<string, string> {
  const allowed = origin && (origin === env.ALLOWED_ORIGIN || origin.startsWith('http://localhost')) ? origin : env.ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

/** Every minute: send what is due. Reminders more than 6 h late are dropped silently. */
async function sendDue(env: Env) {
  const now = Date.now();
  await env.DB.prepare('UPDATE reminders SET sent = 1 WHERE sent = 0 AND fire_at < ?1').bind(now - 6 * 3600_000).run();
  const { results } = await env.DB.prepare('SELECT user_id, rid, text FROM reminders WHERE sent = 0 AND fire_at <= ?1 ORDER BY fire_at LIMIT 50')
    .bind(now + 20_000)
    .all<{ user_id: string; rid: string; text: string }>();
  for (const r of results) {
    await tg(env, 'sendMessage', { chat_id: r.user_id, text: r.text, reply_markup: openButton(env) }).catch(() => null);
    await env.DB.prepare('UPDATE reminders SET sent = 1 WHERE user_id = ?1 AND rid = ?2').bind(r.user_id, r.rid).run();
  }
}

export default {
  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(sendDue(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = cors(request.headers.get('Origin'), env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    const url = new URL(request.url);

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
      return json({ ok: result.ok, description: result.description }, 200, headers);
    }

    // The Mini App syncs its upcoming reminders; the cron below sends them.
    if (request.method === 'POST' && url.pathname === '/reminders/sync') {
      const user = await verifyInitData(request.headers.get('X-Telegram-Init-Data') ?? '', env.BOT_TOKEN);
      if (!user || user === 'anon') return json({ error: 'unauthorized' }, 401, headers);
      let payload: { reminders?: { rid?: unknown; at?: unknown; text?: unknown }[] };
      try {
        payload = await request.json();
      } catch {
        return json({ error: 'bad_json' }, 400, headers);
      }
      const list = (payload.reminders ?? [])
        .filter((r) => typeof r.rid === 'string' && typeof r.at === 'number' && typeof r.text === 'string')
        .slice(0, 300)
        .map((r) => ({ rid: (r.rid as string).slice(0, 120), at: Math.round(r.at as number), text: (r.text as string).slice(0, 600) }));
      const stmts = [
        // Anything not re-sent was removed or edited away in the app.
        env.DB.prepare('DELETE FROM reminders WHERE user_id = ?1 AND sent = 0').bind(user),
        env.DB.prepare('DELETE FROM reminders WHERE user_id = ?1 AND sent = 1 AND fire_at < ?2').bind(user, Date.now() - 2 * 86_400_000),
        ...list.map((r) =>
          env.DB.prepare(
            `INSERT INTO reminders (user_id, rid, fire_at, text, sent) VALUES (?1, ?2, ?3, ?4, 0)
             ON CONFLICT (user_id, rid) DO UPDATE SET
               text = excluded.text,
               sent = CASE WHEN reminders.sent = 1 AND reminders.fire_at = excluded.fire_at THEN 1 ELSE 0 END,
               fire_at = excluded.fire_at`,
          ).bind(user, r.rid, r.at, r.text),
        ),
      ];
      await env.DB.batch(stmts);
      return json({ ok: true, count: list.length }, 200, headers);
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, model: env.MODEL, api: env.API_BASE, key: Boolean(env.OPENAI_API_KEY), bot: Boolean(env.BOT_TOKEN) }, 200, headers);
    }
    if (request.method !== 'POST' || url.pathname !== '/analyze') return json({ error: 'not_found' }, 404, headers);

    const user = await verifyInitData(request.headers.get('X-Telegram-Init-Data') ?? '', env.BOT_TOKEN);
    if (!user) return json({ error: 'unauthorized' }, 401, headers);
    if (rateLimited(user)) return json({ error: 'rate_limited' }, 429, headers);

    let body: { text?: string; today?: string; weekday?: string; time?: string; items?: string };
    try {
      body = await request.json();
    } catch {
      return json({ error: 'bad_json' }, 400, headers);
    }
    const text = String(body.text ?? '').slice(0, MAX_TEXT).trim();
    if (!text) return json({ error: 'empty' }, 400, headers);

    const messages = [
      { role: 'system', content: systemPrompt(String(body.today), String(body.weekday), String(body.time)) },
      { role: 'system', content: `Ближайшие дела пользователя:\n${String(body.items ?? '').slice(0, 4000) || '(пусто)'}` },
      { role: 'user', content: text },
    ];
    const call = (payload: Record<string, unknown>) =>
      fetch(`${(env.API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: env.MODEL, max_completion_tokens: 4000, ...payload }),
      });

    let res = await call({
      messages,
      response_format: { type: 'json_schema', json_schema: { name: 'planner_actions', strict: true, schema: RESPONSE_SCHEMA } },
    });
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

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return json({ error: 'upstream', status: res.status, detail }, 502, headers);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string; refusal?: string } }[]; usage?: unknown };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return json({ error: 'empty_completion' }, 502, headers);
    try {
      return json({ ...JSON.parse(content), usage: data.usage }, 200, headers);
    } catch {
      return json({ error: 'bad_completion' }, 502, headers);
    }
  },
};
