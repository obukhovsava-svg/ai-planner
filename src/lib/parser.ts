/**
 * Local rule-based parser for Russian planning commands.
 *
 *   "Поставить встречу на завтра в 15:00"      → event, tomorrow 15:00–16:00
 *   "Добавь задачу купить молоко в пятницу"     → task, next Friday
 *   "Созвон с командой с 10 до 11:30 во вторник" → event, Tue 10:00–11:30
 *   "Что у меня завтра?"                         → agenda query
 *
 * Runs fully offline. To plug in an LLM later, implement `CommandInterpreter`
 * on the server and swap it in `features/assistant/interpreter.ts`.
 */
import type { Category, DateKey, Priority, TimeStr } from '@/types';
import { addDays, minutesToTime, startOfWeek, timeToMinutes, toKey, weekdayMon } from './date';

export type ParsedCommand =
  | {
      kind: 'event' | 'task';
      title: string;
      date?: DateKey;
      start?: TimeStr;
      end?: TimeStr;
      priority: Priority;
      category: Category;
    }
  | { kind: 'agenda'; date: DateKey };

// Unicode-aware word boundaries (JS \b only understands ASCII).
const B = '(?<![\\p{L}\\d])';
const E = '(?![\\p{L}\\d])';
const rx = (src: string) => new RegExp(src, 'iu');

const NUMBER_WORDS: Record<string, number> = {
  один: 1, одну: 1, одного: 1, два: 2, две: 2, двух: 2, три: 3, трёх: 3, трех: 3,
  четыре: 4, четырёх: 4, четырех: 4, пять: 5, пяти: 5, шесть: 6, шести: 6,
  семь: 7, семи: 7, восемь: 8, восьми: 8, девять: 9, девяти: 9, десять: 10, десяти: 10,
  одиннадцать: 11, одиннадцати: 11, двенадцать: 12, двенадцати: 12,
};

const MONTHS: Record<string, number> = {
  январ: 0, феврал: 1, март: 2, апрел: 3, ма: 4, июн: 5,
  июл: 6, август: 7, сентябр: 8, октябр: 9, ноябр: 10, декабр: 11,
};

const WEEKDAYS: [RegExp, number][] = [
  [/^понедельник/, 0], [/^вторник/, 1], [/^сред/, 2], [/^четверг/, 3],
  [/^пятниц/, 4], [/^суббот/, 5], [/^воскресень/, 6],
];

const EVENT_WORDS =
  /встреч|встрет|созвон|звонок|совещани|митинг|планёрк|планерк|обед|ужин|завтрак|тренировк|при[её]м|урок|лекци|занят|презентаци|собеседовани|консультаци|вебинар|концерт|кино|свидани|день рождени|календар|событи/iu;
const TASK_WORDS = /задач|напомн|купить|сделать|надо|нужно|не забыть|список/iu;

const CATEGORY_RULES: [RegExp, Category][] = [
  [/работ|офис|проект|отч[её]т|клиент|созвон|совещани|митинг|планёрк|планерк|презентаци|дедлайн|собеседовани/iu, 'work'],
  [/врач|доктор|спорт|тренировк|зал|бег|пробежк|йог|бассейн|анализ|стоматолог|здоров/iu, 'health'],
  [/учёб|учеб|урок|лекци|экзамен|курс|домашк|универ|школ|англ/iu, 'study'],
  [/купить|магазин|дом|семь|мам|пап|друз|подар|уборк|ужин|свидани|день рождени/iu, 'personal'],
];

const NOUN_FIX: Record<string, string> = {
  встречу: 'встреча', тренировку: 'тренировка', планёрку: 'планёрка', планерку: 'планерка',
  презентацию: 'презентация', консультацию: 'консультация', пробежку: 'пробежка',
  лекцию: 'лекция', уборку: 'уборка',
};

interface Ctx {
  text: string;
  now: Date;
}

/** Remove the matched fragment from the working text. */
function take(ctx: Ctx, re: RegExp): RegExpMatchArray | null {
  const m = ctx.text.match(re);
  if (m && m.index !== undefined) {
    ctx.text = `${ctx.text.slice(0, m.index)} ${ctx.text.slice(m.index + m[0].length)}`;
  }
  return m;
}

function normalize(input: string): string {
  // Case is preserved (names in titles); every matcher below is case-insensitive.
  let t = ` ${input.replace(/[«»"!?,;]/g, ' ')} `;
  t = t.replace(rx(`${B}в час(?=\\s+(дня|ночи))`), 'в 1');
  for (const [word, n] of Object.entries(NUMBER_WORDS)) {
    t = t.replace(new RegExp(`${B}${word}${E}`, 'giu'), String(n));
  }
  return t.replace(/\s+/g, ' ');
}

function applyDaypart(hour: number, rawPart: string | undefined, isEvent: boolean): number {
  const part = rawPart?.toLowerCase();
  if (part) {
    if (/дня|вечера/.test(part) && hour < 12) return hour + 12;
    if (/ночи/.test(part) && hour === 12) return 0;
    if (/утра/.test(part) && hour === 12) return 0;
    return hour;
  }
  // "в 3" for a meeting almost always means 15:00.
  if (isEvent && hour >= 1 && hour <= 6) return hour + 12;
  return hour;
}

const hhmm = (h: number, m = 0): TimeStr | undefined =>
  h >= 0 && h < 24 && m >= 0 && m < 60 ? minutesToTime(h * 60 + m) : undefined;

function parseDuration(ctx: Ctx): number | undefined {
  if (take(ctx, rx(`${B}на\\s+полчаса${E}`))) return 30;
  if (take(ctx, rx(`${B}на\\s+полтора\\s+часа${E}`))) return 90;
  const m = take(ctx, rx(`${B}на\\s+(\\d+)?\\s*(час(?:а|ов)?|минут[уы]?)${E}`));
  if (!m) return undefined;
  const n = m[1] ? Number(m[1]) : 1;
  return m[2].startsWith('час') ? n * 60 : n;
}

function parseTime(ctx: Ctx, isEvent: boolean): { start?: TimeStr; end?: TimeStr; date?: DateKey } {
  const part = '(?:\\s*(утра|дня|вечера|ночи))?';
  const clock = '(\\d{1,2})(?:[:.](\\d{2})|\\s(\\d{2})(?!\\d))?';

  // "через 2 часа", "через 30 минут" — relative to now
  const rel = take(ctx, rx(`${B}через\\s+(\\d+)?\\s*(час(?:а|ов)?|минут[уы]?)${E}`));
  if (rel) {
    const n = rel[1] ? Number(rel[1]) : 1;
    const target = new Date(ctx.now.getTime() + (rel[2].startsWith('час') ? n * 60 : n) * 60_000);
    return { date: toKey(target), start: hhmm(target.getHours(), target.getMinutes()) };
  }

  // "с 10 до 11:30 [вечера]"
  const range = take(ctx, rx(`${B}(?:с|от)\\s+${clock}${part}\\s+(?:до|по)\\s+${clock}(?:\\s*час(?:а|ов)?)?${part}`));
  if (range) {
    const [, h1, m1a, m1b, p1, h2, m2a, m2b, p2] = range;
    const dp = p1 ?? p2;
    let sh = applyDaypart(Number(h1), dp, isEvent);
    let eh = applyDaypart(Number(h2), p2 ?? p1, isEvent);
    if (eh < sh && eh + 12 < 24) eh += 12;
    if (sh > eh) sh -= 12;
    return { start: hhmm(sh, Number(m1a ?? m1b ?? 0)), end: hhmm(eh, Number(m2a ?? m2b ?? 0)) };
  }

  if (take(ctx, rx(`${B}(?:в|к)?\\s*полдень${E}`))) return { start: '12:00' };
  if (take(ctx, rx(`${B}(?:в|к)?\\s*полночь${E}`))) return { start: '00:00' };

  // "на 15:00" — only with minutes, so "на 3 человека" stays untouched
  const onClock = take(ctx, rx(`${B}на\\s+(\\d{1,2})[:.](\\d{2})${E}`));
  if (onClock) return { start: hhmm(Number(onClock[1]), Number(onClock[2])) };

  // "в 15:00", "к 9 утра", "в 7 часов вечера", "в 15 30" (but not "к 5 числа")
  const notDate = '(?!\\s*(?:-?го\\s+)?(?:числа|январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр|недел|минут))';
  const single = take(ctx, rx(`${B}(?:в|к)\\s+${clock}${notDate}(?:\\s*час(?:а|ов)?)?${part}${E}`));
  if (single) {
    const [, h, ma, mb, p] = single;
    return { start: hhmm(applyDaypart(Number(h), p, isEvent), Number(ma ?? mb ?? 0)) };
  }

  // bare "15:00"
  const bare = take(ctx, /(?<!\d)(\d{1,2}):(\d{2})(?!\d)/u);
  if (bare) return { start: hhmm(Number(bare[1]), Number(bare[2])) };

  if (take(ctx, rx(`${B}утром${E}`))) return { start: '09:00' };
  if (take(ctx, rx(`${B}(?:днём|днем)${E}`))) return { start: '13:00' };
  if (take(ctx, rx(`${B}вечером${E}`))) return { start: '19:00' };
  return {};
}

function parseDate(ctx: Ctx): DateKey | undefined {
  const today = toKey(ctx.now);

  if (take(ctx, rx(`${B}(?:на\\s+)?послезавтра${E}`))) return addDays(today, 2);
  if (take(ctx, rx(`${B}(?:на\\s+)?завтра${E}`))) return addDays(today, 1);
  if (take(ctx, rx(`${B}(?:на\\s+)?сегодня${E}`))) return today;

  const after = take(ctx, rx(`${B}через\\s+(\\d+)?\\s*(день|дня|дней|недел[юяи]|недель|месяц)${E}`));
  if (after) {
    const n = after[1] ? Number(after[1]) : 1;
    if (after[2].startsWith('недел')) return addDays(today, n * 7);
    if (after[2].startsWith('месяц')) return addDays(today, n * 30);
    return addDays(today, n);
  }

  if (take(ctx, rx(`${B}(?:на\\s+)?следующей\\s+неделе${E}`))) return addDays(startOfWeek(today), 7);

  const wd = take(ctx, rx(`${B}(?:в|во|на)?\\s*(следующ\\p{L}*\\s+)?(понедельник|вторник|среду|среда|четверг|пятниц[уа]|суббот[уа]|воскресенье)${E}`));
  if (wd) {
    const target = WEEKDAYS.find(([re]) => re.test(wd[2].toLowerCase()))![1];
    if (wd[1]) return addDays(startOfWeek(today), 7 + target);
    const diff = (target - weekdayMon(ctx.now) + 7) % 7 || 7;
    return addDays(today, diff);
  }

  const dm = take(ctx, rx(`${B}(?:на\\s+)?(\\d{1,2})(?:-?го)?\\s+(январ|феврал|март|апрел|ма|июн|июл|август|сентябр|октябр|ноябр|декабр)\\p{L}*${E}`));
  if (dm) {
    const day = Number(dm[1]);
    const month = MONTHS[dm[2].toLowerCase()];
    let d = new Date(ctx.now.getFullYear(), month, day);
    if (toKey(d) < today) d = new Date(ctx.now.getFullYear() + 1, month, day);
    return toKey(d);
  }

  const numeric = take(ctx, /(?<![\d:])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d:])/u);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    let year = numeric[3] ? Number(numeric[3]) : ctx.now.getFullYear();
    if (year < 100) year += 2000;
    if (month >= 0 && month < 12) {
      let d = new Date(year, month, day);
      if (!numeric[3] && toKey(d) < today) d = new Date(year + 1, month, day);
      return toKey(d);
    }
  }

  const dayOnly = take(ctx, rx(`${B}(?:на\\s+)?(\\d{1,2})(?:-?го)?\\s+числа${E}`));
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    let d = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), day);
    if (toKey(d) < today) d = new Date(ctx.now.getFullYear(), ctx.now.getMonth() + 1, day);
    return toKey(d);
  }
  return undefined;
}

function cleanTitle(text: string): string {
  let t = text
    .replace(
      rx(`^\\s*(?:пожалуйста\\s+)?(?:поставь(?:те)?|поставить|добавь(?:те)?|добавить|создай(?:те)?|создать|запланируй(?:те)?|запланировать|запиши|записать|напомни(?:те)?|напомнить|назначь|назначить|сделай|внеси|внести)${E}\\s*(?:мне${E})?\\s*(?:пожалуйста${E})?`),
      ' ',
    )
    .replace(rx(`^\\s*(?:мне\\s+)?(?:нужно|надо|не\\s+забыть|не\\s+забудь)${E}`), ' ')
    .replace(rx(`${B}(?:в\\s+)?(?:календарь|задачи|список\\s+задач)${E}`), ' ')
    .replace(rx(`${B}(?:новую\\s+|новое\\s+)?(?:задачу|задача|событие)${E}\\s*:?`), ' ')
    .replace(rx(`${B}(?:срочно|срочная|срочную|важно|важная|важную|пожалуйста)${E}`), ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip prepositions left dangling at either end after removing date/time.
  const dangling = rx(`^(?:на|в|во|к|с|до|о|об|про|что)${E}\\s*|\\s*${B}(?:на|в|во|к|с|до|и|о|об|про)$`);
  for (let i = 0; i < 3; i++) t = t.replace(dangling, '').trim();

  t = t.replace(/^\p{L}+/u, (w) => NOUN_FIX[w.toLowerCase()] ?? w);
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

const AGENDA_RE = rx(`^\\s*(?:а\\s+)?(?:что|какие|какой|покажи|расскажи)${E}.*(?:план|дел|задач|событи|расписани|у меня)`);

export function parseCommand(input: string, now: Date = new Date()): ParsedCommand | null {
  const raw = input.trim();
  if (!raw) return null;

  const ctx: Ctx = { text: normalize(raw), now };

  if (AGENDA_RE.test(ctx.text)) {
    return { kind: 'agenda', date: parseDate(ctx) ?? toKey(now) };
  }

  const priority: Priority = /срочн|важн|asap|критичн/iu.test(ctx.text)
    ? 'high'
    : /не\s+срочно|когда-нибудь|потом/iu.test(ctx.text)
      ? 'low'
      : 'medium';
  const category = CATEGORY_RULES.find(([re]) => re.test(ctx.text))?.[1] ?? 'other';

  const explicitTask = TASK_WORDS.test(ctx.text);
  const looksLikeEvent = EVENT_WORDS.test(ctx.text);

  const duration = parseDuration(ctx);
  const time = parseTime(ctx, looksLikeEvent || !explicitTask);
  const date = parseDate(ctx) ?? time.date;

  // Routing: explicit task words win; otherwise timed or event-like phrases go to the calendar.
  const kind: 'event' | 'task' =
    explicitTask && !/встреч|встрет|созвон|совещани/iu.test(ctx.text)
      ? 'task'
      : looksLikeEvent || (time.start && !explicitTask)
        ? 'event'
        : 'task';

  let { start, end } = time;
  if (kind === 'event') {
    start ??= '09:00';
    end ??= minutesToTime(timeToMinutes(start) + (duration ?? 60));
  }

  const title = cleanTitle(ctx.text) || (kind === 'event' ? 'Новое событие' : 'Новая задача');

  return {
    kind,
    title,
    date: kind === 'event' ? (date ?? toKey(now)) : date,
    start,
    end: kind === 'event' ? end : undefined,
    priority,
    category,
  };
}
