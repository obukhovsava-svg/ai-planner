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

interface Env {
  OPENAI_API_KEY: string;
  BOT_TOKEN: string;
  MODEL: string;
  API_BASE: string;
  ALLOWED_ORIGIN: string;
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
    'eventHint', 'taskHint', 'priority', 'category', 'range', 'sourceDate', 'all',
  ],
  properties: {
    intent: { type: 'string', enum: ['create', 'agenda', 'delete', 'move', 'complete', 'undo', 'help', 'smalltalk'] },
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
    all: { type: 'boolean', description: 'delete: whole series ("все тренировки")' },
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
- agenda («что у меня завтра / на неделе / на выходных»): range с from/to.
- undo («отмени последнее»), help («что ты умеешь»), smalltalk (приветствие, спасибо) — reply с коротким дружелюбным ответом.
- Если смысл неясен — actions пустой, reply: короткий уточняющий вопрос по-русски.
Список ближайших дел пользователя дан ниже, используй его, чтобы правильно назвать то, что нужно перенести/удалить/отметить.`;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = cors(request.headers.get('Origin'), env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    const url = new URL(request.url);
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
