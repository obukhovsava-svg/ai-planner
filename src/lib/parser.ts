/**
 * Offline analyser for Russian planning phrases.
 *
 * `analyze()` does not make decisions — it extracts facts (intent, title, date, start/end,
 * duration, repeat rule, hints) and leaves what is *missing* undefined, so the assistant
 * can ask about it instead of guessing. See features/assistant/brain.ts for the decisions.
 *
 *   "Встреча с Анной завтра с 15 до 16"          → create, date+start+end
 *   "Смены с 9 до 21 по графику 2/2"              → create, rota 2/2, start day unknown
 *   "Созвон каждый понедельник и среду в 10"      → create, weekly Mon+Wed
 *   "Перенеси тренировку со среды на пятницу в 19" → move
 *   "Удали встречу с Анной"                        → delete
 *   "Что у меня на неделе?"                        → agenda (range)
 */
import type { Category, DateKey, Priority, Repeat, TimeStr } from '@/types';
import { addDays, minutesToTime, startOfWeek, timeToMinutes, toKey, weekdayMon } from './date';

export type Intent = 'create' | 'agenda' | 'delete' | 'move' | 'complete' | 'remind' | 'undo' | 'help' | 'smalltalk';

export interface Analysis {
  intent: Intent;
  /** create: cleaned title. delete/move/complete: what to look for. */
  title: string;
  date?: DateKey;
  start?: TimeStr;
  end?: TimeStr;
  /** Minutes, from "на час", "на 30 минут"… */
  duration?: number;
  repeat?: Repeat;
  /** A rota/schedule was given but not the day it starts on. */
  needsStart: boolean;
  /** Explicit "событие/в календарь" or "задача/в задачи". */
  kindWord?: 'event' | 'task';
  eventHint: boolean;
  taskHint: boolean;
  priority: Priority;
  category: Category;
  /** agenda: requested range. */
  range?: { from: DateKey; to: DateKey; label: string };
  /** move: "со среды" — the occurrence being moved. */
  sourceDate?: DateKey;
  /** delete: "все тренировки" / "всю серию". */
  all: boolean;
  /** delete/move: what kind of item is meant ("удали событие", "все задачи"). */
  targetKind?: 'event' | 'task' | 'any';
  /** delete: everything of `targetKind` in `range`/`date` ("удали все события на понедельник"). */
  bulk: boolean;
  /** create: "напомни купить хлеб в 10" — the new item gets a reminder. */
  remind?: boolean;
  /** Minutes before ("за час" → 60); 0 = at the time itself. */
  remindOffset?: number;
  /** remind: "убери напоминание о …". */
  remindCancel?: boolean;
}

// Unicode-aware word boundaries (JS \b only understands ASCII).
const B = '(?<![\\p{L}\\d])';
const E = '(?![\\p{L}\\d])';
const rx = (src: string) => new RegExp(src, 'iu');

const NUMBER_WORDS: Record<string, number> = {
  один: 1, одну: 1, одного: 1, два: 2, две: 2, двух: 2, двое: 2, три: 3, трёх: 3, трех: 3, трое: 3,
  четыре: 4, четырёх: 4, четырех: 4, четверо: 4, пять: 5, пяти: 5, шесть: 6, шести: 6,
  семь: 7, семи: 7, восемь: 8, восьми: 8, девять: 9, девяти: 9, десять: 10, десяти: 10,
  одиннадцать: 11, одиннадцати: 11, двенадцать: 12, двенадцати: 12,
};

const MONTHS: Record<string, number> = {
  январ: 0, феврал: 1, март: 2, апрел: 3, ма: 4, июн: 5,
  июл: 6, август: 7, сентябр: 8, октябр: 9, ноябр: 10, декабр: 11,
};

const WEEKDAYS: [RegExp, number][] = [
  [/^(понедельник|пн)/, 0], [/^(вторник|вт)/, 1], [/^(сред|ср)/, 2], [/^(четверг|чт)/, 3],
  [/^(пятниц|пт)/, 4], [/^(суббот|сб)/, 5], [/^(воскресень|вс)/, 6],
];
const weekdayOf = (word: string) => WEEKDAYS.find(([re]) => re.test(word.toLowerCase()))?.[1];

const WD_WORD = '(?:понедельник|вторник|сред|четверг|пятниц|суббот|воскресень)\\p{L}*';
const WD_ANY = `(?:${WD_WORD}|пн|вт|ср|чт|пт|сб|вс)`;

const EVENT_WORDS =
  /встреч|встрет|созвон|звонок|совещани|митинг|планёрк|планерк|обед|ужин|завтрак|тренировк|при[её]м|урок|лекци|занят|презентаци|собеседовани|консультаци|вебинар|концерт|кино|театр|свидани|день рождени|праздник|вечеринк|смен|дежурств|вахт|сутки|пар[аыу](?!\p{L})|экзамен|матч|игр[аы]|репетици|массаж|стрижк|маникюр/iu;
const TASK_WORDS =
  /задач|напомн|купить|сделать|надо|нужно|не забыть|список|позвонить|написать|отправить|оплатить|заплатить|забрать|отнести|подготовить|проверить|заказать|записаться|прочитать|выучить|убрать|постирать|починить/iu;

const CATEGORY_RULES: [RegExp, Category][] = [
  [/работ|офис|проект|отч[её]т|клиент|созвон|совещани|митинг|планёрк|планерк|презентаци|дедлайн|собеседовани|смен|дежурств|вахт/iu, 'work'],
  [/врач|доктор|спорт|тренировк|зал|бег|пробежк|йог|бассейн|анализ|стоматолог|здоров|массаж/iu, 'health'],
  [/учёб|учеб|урок|лекци|экзамен|курс|домашк|универ|школ|англ|пар[аыу](?!\p{L})/iu, 'study'],
  [/купить|магазин|дом|семь|мам|пап|друз|подар|уборк|ужин|свидани|день рождени/iu, 'personal'],
];

const NOUN_FIX: Record<string, string> = {
  встречу: 'встреча', тренировку: 'тренировка', планёрку: 'планёрка', планерку: 'планерка',
  презентацию: 'презентация', консультацию: 'консультация', пробежку: 'пробежка',
  лекцию: 'лекция', уборку: 'уборка', смены: 'смена', смену: 'смена', пару: 'пара', пары: 'пара',
  // prepositional / genitive after "о …", "до …"
  встрече: 'встреча', встречи: 'встреча', тренировке: 'тренировка', тренировки: 'тренировка',
  планёрке: 'планёрка', планерке: 'планерка', планёрки: 'планёрка', смене: 'смена', лекции: 'лекция',
  презентации: 'презентация', консультации: 'консультация', пробежке: 'пробежка', уборке: 'уборка',
  паре: 'пара', созвоне: 'созвон', созвона: 'созвон', обеде: 'обед', обеда: 'обед', ужине: 'ужин', ужина: 'ужин',
  отчёте: 'отчёт', отчете: 'отчет', отчёта: 'отчёт', дне: 'день', дня: 'день', приёме: 'приём', приеме: 'прием',
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
  let t = ` ${input.replace(/[«»"!?;]/g, ' ')} `;
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

const PART = '(?:\\s*(утра|дня|вечера|ночи))?';
const CLOCK = '(\\d{1,2})(?:[:.](\\d{2})|\\s(\\d{2})(?!\\d))?';

export function parseDurationText(text: string): number | undefined {
  const ctx: Ctx = { text: normalize(text), now: new Date() };
  return parseDuration(ctx, true);
}

function parseDuration(ctx: Ctx, bare = false): number | undefined {
  const pre = bare ? '(?:на\\s+)?' : 'на\\s+';
  if (take(ctx, rx(`${B}${pre}полчаса${E}`))) return 30;
  if (take(ctx, rx(`${B}${pre}полтора\\s+часа${E}`))) return 90;
  const m = take(ctx, rx(`${B}${pre}(\\d+(?:[.,]5)?)?\\s*(час(?:а|ов)?|ч|минут[уы]?|мин)${E}`));
  if (!m) return undefined;
  const n = m[1] ? Number(m[1].replace(',', '.')) : 1;
  return m[2].startsWith('ч') ? Math.round(n * 60) : n;
}

function parseTime(ctx: Ctx, isEvent: boolean): { start?: TimeStr; end?: TimeStr; date?: DateKey } {
  // "через 2 часа", "через 30 минут" — relative to now
  const rel = take(ctx, rx(`${B}через\\s+(\\d+)?\\s*(час(?:а|ов)?|минут[уы]?)${E}`));
  if (rel) {
    const n = rel[1] ? Number(rel[1]) : 1;
    const target = new Date(ctx.now.getTime() + (rel[2].startsWith('час') ? n * 60 : n) * 60_000);
    return { date: toKey(target), start: hhmm(target.getHours(), target.getMinutes()) };
  }

  // "с 10 до 11:30 [вечера]", "с 21 до 9" (overnight)
  const range = take(ctx, rx(`${B}(?:с|от)\\s+${CLOCK}${PART}\\s*(?:до|по|-|–)\\s*${CLOCK}(?:\\s*час(?:а|ов)?)?${PART}`));
  if (range) {
    const [, h1, m1a, m1b, p1, h2, m2a, m2b, p2] = range;
    let sh = applyDaypart(Number(h1), p1 ?? p2, isEvent);
    let eh = applyDaypart(Number(h2), p2 ?? p1, isEvent);
    if (eh < sh && eh + 12 < 24 && eh + 12 > sh) eh += 12;
    if (sh > eh && sh - 12 >= 0 && sh - 12 < eh && !p1) sh -= 12;
    return { start: hhmm(sh, Number(m1a ?? m1b ?? 0)), end: hhmm(eh, Number(m2a ?? m2b ?? 0)) };
  }

  if (take(ctx, rx(`${B}(?:в|к)?\\s*полдень${E}`))) return { start: '12:00' };
  if (take(ctx, rx(`${B}(?:в|к)?\\s*полночь${E}`))) return { start: '00:00' };

  let start: TimeStr | undefined;
  // "на 15:00" — only with minutes, so "на 3 человека" stays untouched
  const onClock = take(ctx, rx(`${B}на\\s+(\\d{1,2})[:.](\\d{2})${E}`));
  if (onClock) start = hhmm(Number(onClock[1]), Number(onClock[2]));

  // "в 15:00", "к 9 утра", "в 7 часов вечера", "в 15 30" (but not "к 5 числа")
  const notDate = '(?!\\s*(?:-?го\\s+)?(?:числа|январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр|недел|минут))';
  if (!start) {
    const single = take(ctx, rx(`${B}(?:в|к)\\s+${CLOCK}${notDate}(?:\\s*час(?:а|ов)?)?${PART}${E}`));
    if (single) {
      const [, h, ma, mb, p] = single;
      start = hhmm(applyDaypart(Number(h), p, isEvent), Number(ma ?? mb ?? 0));
    }
  }
  // "с 17 вечера", "с 9:30" — a start without an end
  if (!start) {
    const from = take(ctx, rx(`${B}(?:с|со|от)\\s+${CLOCK}${notDate}(?:\\s*час(?:а|ов)?)?${PART}${E}`));
    if (from) {
      const [, h, ma, mb, p] = from;
      start = hhmm(applyDaypart(Number(h), p, isEvent), Number(ma ?? mb ?? 0));
    }
  }
  if (!start) {
    const bare = take(ctx, /(?<![\d:.])(\d{1,2}):(\d{2})(?!\d)/u);
    if (bare) start = hhmm(Number(bare[1]), Number(bare[2]));
  }
  if (!start) {
    if (take(ctx, rx(`${B}утром${E}`))) start = '09:00';
    else if (take(ctx, rx(`${B}(?:днём|днем)${E}`))) start = '13:00';
    else if (take(ctx, rx(`${B}вечером${E}`))) start = '19:00';
  }

  // "… до 17" after a start time
  let end: TimeStr | undefined;
  if (start) {
    const until = take(ctx, rx(`${B}до\\s+${CLOCK}${notDate}(?:\\s*час(?:а|ов)?)?${PART}${E}`));
    if (until) {
      const [, h, ma, mb, p] = until;
      let eh = applyDaypart(Number(h), p, isEvent);
      if (eh * 60 < timeToMinutes(start) && eh + 12 < 24) eh += 12;
      end = hhmm(eh, Number(ma ?? mb ?? 0));
    }
  }
  return { start, end };
}

function parseDate(ctx: Ctx): DateKey | undefined {
  const today = toKey(ctx.now);
  const from = '(?:на|с|со|начиная\\s+с|начиная\\s+со)';

  if (take(ctx, rx(`${B}(?:${from}\\s+)?послезавтра${E}`))) return addDays(today, 2);
  if (take(ctx, rx(`${B}(?:${from}\\s+)?(?:завтра|завтрашнего\\s+дня)${E}`))) return addDays(today, 1);
  if (take(ctx, rx(`${B}(?:${from}\\s+)?(?:сегодня|сегодняшнего\\s+дня)${E}`))) return today;

  const after = take(ctx, rx(`${B}через\\s+(\\d+)?\\s*(день|дня|дней|недел[юяи]|недель|месяц)${E}`));
  if (after) {
    const n = after[1] ? Number(after[1]) : 1;
    if (after[2].startsWith('недел')) return addDays(today, n * 7);
    if (after[2].startsWith('месяц')) return addDays(today, n * 30);
    return addDays(today, n);
  }

  if (take(ctx, rx(`${B}(?:на\\s+)?следующей\\s+неделе${E}`))) return addDays(startOfWeek(today), 7);

  // "в пятницу", "в следующий вторник", "с понедельника", "начиная со среды"
  const wd = take(
    ctx,
    rx(`${B}(?:(?:в|во|на|с|со|к|ко|до|начиная\\s+с|начиная\\s+со)\\s+)?(следующ\\p{L}*\\s+)?(понедельник|понедельника|понедельнику|вторник|вторника|вторнику|среду|среда|среды|среде|четверг|четверга|четвергу|пятниц[уаые]|суббот[уаые]|воскресенье|воскресенья|воскресенью)${E}`),
  );
  if (wd) {
    const target = weekdayOf(wd[2])!;
    if (wd[1]) return addDays(startOfWeek(today), 7 + target);
    const diff = (target - weekdayMon(ctx.now) + 7) % 7 || 7;
    return addDays(today, diff);
  }

  const dm = take(ctx, rx(`${B}(?:${from}\\s+)?(\\d{1,2})(?:-?го)?\\s+(январ|феврал|март|апрел|ма|июн|июл|август|сентябр|октябр|ноябр|декабр)\\p{L}*${E}`));
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

  const dayOnly = take(ctx, rx(`${B}(?:${from}\\s+)?(\\d{1,2})(?:-?го)?\\s+числа${E}`));
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    let d = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), day);
    if (toKey(d) < today) d = new Date(ctx.now.getFullYear(), ctx.now.getMonth() + 1, day);
    return toKey(d);
  }
  return undefined;
}

/** Next date (today included) that falls on one of the given weekdays. */
function nextWeekday(now: Date, days: number[]): DateKey {
  const today = toKey(now);
  const wd = weekdayMon(now);
  const diff = Math.min(...days.map((d) => (d - wd + 7) % 7));
  return addDays(today, diff);
}

interface RepeatInfo {
  repeat?: Repeat;
  /** Suggested first date (e.g. the next Monday for "по понедельникам"). */
  firstDate?: DateKey;
  rota?: boolean;
  allDay?: boolean;
}

/**
 * Repeat rules: "каждый день", "по будням", "каждые 2 недели", "раз в месяц", "ежегодно",
 * "по понедельникам и средам", rotas "график 2/2", "2 через 2", "сутки через трое", "5/2".
 */
function parseRepeat(ctx: Ctx): RepeatInfo {
  const shiftContext = /смен|график|дежур|вахт|сутк|работ/iu.test(ctx.text);

  // Rotas.
  const sutki = take(ctx, rx(`${B}сутки\\s+через\\s+(\\d)${E}`));
  if (sutki) return { repeat: { freq: 'day', interval: 1, cycle: { on: 1, off: Number(sutki[1]) } }, rota: true, allDay: true };
  if (shiftContext) {
    const rota = take(ctx, rx(`${B}(?:(?:с|по)\\s+)?(?:график\\p{L}*\\s*)?(\\d)\\s*(?:[/\\\\]|через|на|-|x|х)\\s*(\\d)${E}(?:\\s*график\\p{L}*)?`));
    if (rota) {
      const on = Number(rota[1]);
      const off = Number(rota[2]);
      if (on === 5 && off === 2) {
        take(ctx, rx(`${B}(?:по\\s+)?график\\p{L}*${E}`));
        return { repeat: { freq: 'week', interval: 1, byWeekday: [0, 1, 2, 3, 4] }, firstDate: nextWeekday(ctx.now, [0, 1, 2, 3, 4]) };
      }
      return { repeat: { freq: 'day', interval: 1, cycle: { on, off } }, rota: true };
    }
  }

  if (take(ctx, rx(`${B}(?:по\\s+будням|в\\s+будни|в\\s+будние\\s+дни|по\\s+рабочим\\s+дням|каждый\\s+будний\\s+день)${E}`))) {
    const days = [0, 1, 2, 3, 4];
    return { repeat: { freq: 'week', interval: 1, byWeekday: days }, firstDate: nextWeekday(ctx.now, days) };
  }
  if (take(ctx, rx(`${B}(?:по\\s+выходным|каждые\\s+выходные)${E}`))) {
    const days = [5, 6];
    return { repeat: { freq: 'week', interval: 1, byWeekday: days }, firstDate: nextWeekday(ctx.now, days) };
  }

  const every = '(?:каждый|каждую|каждое|каждые|раз\\s+в)';
  if (take(ctx, rx(`${B}(?:${every}\\s+день|ежедневно)${E}`))) return { repeat: { freq: 'day', interval: 1 } };
  const nDays = take(ctx, rx(`${B}(?:каждые|раз\\s+в)\\s+(\\d+)\\s+(?:дня|дней)${E}`));
  if (nDays) return { repeat: { freq: 'day', interval: Number(nDays[1]) } };

  // Weekdays list: "каждый понедельник и среду", "по вторникам и четвергам", "по пн, ср, пт".
  const list = take(ctx, rx(`${B}(?:(?:каждые|раз\\s+в)\\s+(\\d+)\\s+недел\\p{L}*\\s+)?(?:каждый|каждую|каждое|по)\\s+(${WD_ANY}(?:\\s*(?:,|и)\\s*${WD_ANY})*)${E}`));
  if (list) {
    const days = [...new Set(list[2].split(/\s*(?:,|\s+и\s+)\s*/u).map(weekdayOf).filter((d): d is number => d !== undefined))].sort();
    const interval = list[1] ? Number(list[1]) : 1;
    if (days.length) {
      const firstDate = nextWeekday(ctx.now, days);
      return days.length === 1
        ? { repeat: { freq: 'week', interval }, firstDate }
        : { repeat: { freq: 'week', interval, byWeekday: days }, firstDate };
    }
  }

  const nWeeks = take(ctx, rx(`${B}(?:каждые|раз\\s+в)\\s+(\\d+)\\s+недел\\p{L}*`));
  if (nWeeks) return { repeat: { freq: 'week', interval: Number(nWeeks[1]) } };
  if (take(ctx, rx(`${B}(?:${every}\\s+неделю|еженедельно)${E}`))) return { repeat: { freq: 'week', interval: 1 } };
  const nMonths = take(ctx, rx(`${B}(?:каждые|раз\\s+в)\\s+(\\d+)\\s+месяц\\p{L}*`));
  if (nMonths) return { repeat: { freq: 'month', interval: Number(nMonths[1]) } };
  if (take(ctx, rx(`${B}(?:${every}\\s+месяц|ежемесячно)${E}`))) return { repeat: { freq: 'month', interval: 1 } };
  if (take(ctx, rx(`${B}(?:${every}\\s+год|ежегодно)${E}`))) return { repeat: { freq: 'year', interval: 1 } };
  return {};
}

function cleanTitle(text: string): string {
  let t = text
    .replace(
      rx(`^\\s*(?:пожалуйста\\s+)?(?:поставь(?:те)?|поставить|добавь(?:те)?|добавить|создай(?:те)?|создать|запланируй(?:те)?|запланировать|запиши|записать|напомни(?:те)?|напомнить|назначь|назначить|сделай|внеси|внести|занеси|отметь|отметить)${E}\\s*(?:мне${E})?\\s*(?:пожалуйста${E})?`),
      ' ',
    )
    .replace(rx(`^\\s*(?:мне\\s+)?(?:нужно|надо|не\\s+забыть|не\\s+забудь)${E}`), ' ')
    .replace(rx(`${B}(?:в\\s+)?(?:календарь|задачи|список\\s+задач|расписание)${E}`), ' ')
    .replace(rx(`${B}(?:новую\\s+|новое\\s+)?(?:задачу|задача|событие)${E}\\s*:?`), ' ')
    .replace(rx(`${B}(?:срочно|срочная|срочную|важно|важная|важную|пожалуйста|начиная|график\\p{L}*|по\\s+графику)${E}`), ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip prepositions left dangling at either end after removing date/time.
  const dangling = rx(`^(?:на|в|во|к|с|со|до|о|об|про|что|и|по)${E}\\s*|\\s*${B}(?:на|в|во|к|с|со|до|и|о|об|про|по|,)$`);
  for (let i = 0; i < 4; i++) t = t.replace(dangling, '').trim();

  t = t.replace(/^\p{L}+/u, (w) => NOUN_FIX[w.toLowerCase()] ?? w);
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

const REMIND_CANCEL_RE = rx(
  `^\\s*(?:пожалуйста\\s+)?(?:убери|удали|отмени|выключи|отключи|сними|не\\s+напоминай)(?:\\s+(?:все\\s+)?напоминани\\p{L}*)?${E}`,
);
const REMIND_RE = rx(
  `^\\s*(?:пожалуйста\\s+)?(?:напомни(?:те)?|напомнить|напоминай(?:те)?|(?:поставь|поставить|создай|добавь|включи|сделай)\\s+напоминани\\p{L}*)${E}\\s*(?:мне\\s+)?(?:пожалуйста\\s+)?`,
);

/** "за час", "за 15 минут", "за полчаса", "за сутки", "за 2 дня" → minutes. */
function parseRemindOffset(ctx: Ctx): number | undefined {
  if (take(ctx, rx(`${B}за\\s+полчаса${E}`))) return 30;
  if (take(ctx, rx(`${B}за\\s+сутки${E}`))) return 1440;
  const m = take(ctx, rx(`${B}за\\s+(\\d+(?:[.,]5)?)?\\s*(минут\\p{L}*|мин|час\\p{L}*|ч|день|дня|дней|сут\\p{L}*|недел\\p{L}*)${E}`));
  if (!m) return undefined;
  const n = m[1] ? Number(m[1].replace(',', '.')) : 1;
  const u = m[2].toLowerCase();
  return Math.round(u.startsWith('мин') ? n : u.startsWith('ч') ? n * 60 : u.startsWith('недел') ? n * 10080 : n * 1440);
}

const AGENDA_RE = rx(
  `^\\s*(?:а\\s+)?(?:что|какие|какой|покажи|расскажи|какое|есть\\s+ли)${E}.*(?:план|дел|задач|событи|расписани|у\\s+меня|запланирован|встреч)`,
);
const HELP_RE = rx(`^\\s*(?:что\\s+ты\\s+умеешь|что\\s+умеешь|помощь|help|помоги|как\\s+(?:тобой\\s+)?пользоваться|что\\s+ты\\s+можешь)`);
const SMALLTALK_RE = rx(
  `^\\s*(?:привет|здравствуй\\p{L}*|добр\\p{L}+\\s+(?:утро|день|вечер)|спасибо|благодарю|ок|окей|хорошо|понял\\p{L}*|ясно|пока|супер|отлично|класс|круто)${E}`,
);
const UNDO_RE = rx(`^\\s*(?:отмени|отменить|верни|вернуть|откати)(?:\\s+(?:последн\\p{L}*(?:\\s+действие)?|это|что\\s+сделал|как\\s+было|назад))?\\s*$`);
const DELETE_RE = rx(`^\\s*(?:пожалуйста\\s+)?(?:удали|удалить|убери|убрать|отмени|отменить|сотри|вычеркни|очисти|очистить)${E}(?:\\s+|\\s*$)`);
const MOVE_RE = rx(`^\\s*(?:пожалуйста\\s+)?(?:перенеси|перенести|передвинь|сдвинь|перемести|переставь)${E}(?:\\s+|\\s*$)`);
const COMPLETE_RE = rx(
  `^\\s*(?:(?:отметь|отметить)\\s+(.+?)\\s+(?:как\\s+)?(?:выполненн\\p{L}*|сделанн\\p{L}*|готов\\p{L}*)|(?:я\\s+)?(?:сделал|сделала|выполнил|выполнила|закончил|закончила|купил|купила)\\s+(.+)|(.+?)\\s+(?:готово|сделано|выполнено))\\s*$`,
);

function baseAnalysis(intent: Intent, title = ''): Analysis {
  return { intent, title, needsStart: false, eventHint: false, taskHint: false, priority: 'medium', category: 'other', all: false, bulk: false };
}

/** "на неделе", "на выходных", or a single date; undefined when nothing is said. */
function optionalRange(ctx: Ctx): Analysis['range'] {
  const before = ctx.text;
  const r = agendaRange(ctx);
  return ctx.text === before ? undefined : r;
}

function agendaRange(ctx: Ctx): Analysis['range'] {
  const today = toKey(ctx.now);
  const sunday = addDays(startOfWeek(today), 6);
  if (take(ctx, rx(`${B}(?:на\\s+)?следующей\\s+неделе${E}`))) {
    const mon = addDays(startOfWeek(today), 7);
    return { from: mon, to: addDays(mon, 6), label: 'на следующей неделе' };
  }
  if (take(ctx, rx(`${B}(?:на\\s+(?:этой\\s+)?неделе|до\\s+конца\\s+недели)${E}`))) return { from: today, to: sunday, label: 'на этой неделе' };
  if (take(ctx, rx(`${B}(?:на\\s+выходных|в\\s+выходные|на\\s+выходные)${E}`))) {
    const sat = addDays(startOfWeek(today), 5);
    const from = today > sat ? today : sat;
    return { from, to: addDays(startOfWeek(today), 6), label: 'на выходных' };
  }
  const d = parseDate(ctx) ?? today;
  return { from: d, to: d, label: '' };
}

export function analyze(input: string, now: Date = new Date()): Analysis {
  const ctx: Ctx = { text: normalize(input.trim()), now };
  const t = ctx.text;

  if (HELP_RE.test(t)) return baseAnalysis('help');
  if (UNDO_RE.test(t)) return baseAnalysis('undo');
  if (SMALLTALK_RE.test(t) && t.trim().split(/\s+/).length <= 4) return baseAnalysis('smalltalk', t.trim());
  if (AGENDA_RE.test(t)) return { ...baseAnalysis('agenda'), range: agendaRange(ctx) };

  // Reminders: "напомни о встрече за час", "напоминай за день до каждой смены",
  // "убери напоминание о тренировке", or "напомни купить хлеб в 10" (a new item with a reminder).
  const cancelRemind = REMIND_CANCEL_RE.test(t) && /напомин/iu.test(t);
  if (cancelRemind || REMIND_RE.test(t)) {
    take(ctx, cancelRemind ? REMIND_CANCEL_RE : REMIND_RE);
    const offset = cancelRemind ? undefined : parseRemindOffset(ctx);
    const about = rx(
      `^\\s*(?:о|об|обо|про|насч[её]т|для|до|на(?=\\s+(?!\\d|завтра|сегодня|послезавтра|понедельник|вторник|среду|четверг|пятниц|суббот|воскресень|следующ|эт[уо]|выходн|неделе|полчаса|час|сутки)))\\s+(?!\\d)`,
    );
    if (cancelRemind || about.test(ctx.text)) {
      take(ctx, about);
      take(ctx, rx(`${B}(?:каждой|каждого|каждую|каждый|всех|все|моей|моего|мою|моём|моем)${E}`));
      const duration = parseDuration(ctx);
      const time = parseTime(ctx, true);
      const date = parseDate(ctx) ?? time.date;
      return {
        ...baseAnalysis('remind', cleanTitle(ctx.text)),
        date,
        start: time.start,
        end: time.end ?? (time.start && duration ? minutesToTime(timeToMinutes(time.start) + duration) : undefined),
        duration,
        remindOffset: offset,
        remindCancel: cancelRemind,
        eventHint: EVENT_WORDS.test(t),
        taskHint: TASK_WORDS.test(ctx.text),
      };
    }
    const inner = analyze(ctx.text, now);
    if (inner.intent !== 'create') return inner;
    return { ...inner, remind: true, remindOffset: offset, taskHint: inner.eventHint ? inner.taskHint : true };
  }

  const done = t.match(COMPLETE_RE);
  if (done) return baseAnalysis('complete', cleanTitle(done[1] ?? done[2] ?? done[3] ?? ''));

  if (DELETE_RE.test(t) || MOVE_RE.test(t)) {
    const intent: Intent = MOVE_RE.test(t) ? 'move' : 'delete';
    take(ctx, intent === 'move' ? MOVE_RE : DELETE_RE);

    // "все события / все задачи / все дела", "всё на завтра", "очисти календарь" → bulk delete.
    let targetKind: Analysis['targetKind'];
    let bulk = false;
    const bulkKind = take(ctx, rx(`${B}(?:все|всё|всю)\\s+(?:мои\\s+)?(событи\\p{L}*|встреч\\p{L}*|мероприяти\\p{L}*|задач\\p{L}*|дела|планы|записи|расписание|календарь)${E}`));
    if (bulkKind) {
      bulk = intent === 'delete';
      targetKind = /задач/iu.test(bulkKind[1]) ? 'task' : /дела|планы|записи/iu.test(bulkKind[1]) ? 'any' : 'event';
    } else if (intent === 'delete' && take(ctx, rx(`^\\s*(?:всё|все)(?=\\s+(?:на|в|во|за|сегодня|завтра|послезавтра)${E}|\\s*$)`))) {
      bulk = true;
      targetKind = 'any';
    } else if (intent === 'delete' && take(ctx, rx(`^\\s*(?:календарь|расписание)${E}`))) {
      bulk = true;
      targetKind = 'event';
    } else {
      // "удали событие", "перенеси задачу" — no specific item named.
      const generic = take(ctx, rx(`^\\s*(?:это\\s+|одно\\s+|какое-нибудь\\s+|какую-нибудь\\s+)?(событие|задачу|задача|дело|запись)${E}`));
      if (generic) targetKind = /задач/iu.test(generic[1]) ? 'task' : generic[1].toLowerCase().startsWith('событ') ? 'event' : 'any';
    }
    if (bulk) {
      const range = optionalRange(ctx);
      return { ...baseAnalysis('delete'), bulk, targetKind, range, date: range?.from === range?.to ? range?.from : undefined };
    }
    const all = Boolean(take(ctx, rx(`${B}(?:все|всё|всю\\s+серию|все\\s+повторы|совсем|полностью)${E}`)));
    // "со среды на пятницу" — the first date is the occurrence being moved.
    let sourceDate: DateKey | undefined;
    if (intent === 'move') {
      const src = ctx.text.match(rx(`${B}(?:с|со)\\s+(?:понедельника|вторника|среды|четверга|пятницы|субботы|воскресенья|завтра|сегодня|\\d{1,2}\\s+\\p{L}+)`));
      if (src) {
        const sub: Ctx = { text: ` ${src[0].replace(/^(со|с)\s+/iu, 'на ')} `, now };
        sourceDate = parseDate(sub);
        take(ctx, rx(src[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
    }
    const duration = parseDuration(ctx);
    const time = parseTime(ctx, true);
    const date = parseDate(ctx) ?? time.date;
    return { ...baseAnalysis(intent, cleanTitle(ctx.text)), date, start: time.start, end: time.end, duration, sourceDate, all, targetKind };
  }

  // ---- create ----
  const kindWord: Analysis['kindWord'] = rx(`${B}(?:в\\s+календарь|событи\\p{L}*|в\\s+расписание)`).test(t)
    ? 'event'
    : rx(`${B}(?:задач\\p{L}*|в\\s+список|в\\s+задачи)${E}`).test(t)
      ? 'task'
      : undefined;
  const priority: Priority = /срочн|важн|asap|критичн/iu.test(t) ? 'high' : /не\s+срочно|когда-нибудь|потом/iu.test(t) ? 'low' : 'medium';
  const category = CATEGORY_RULES.find(([re]) => re.test(t))?.[1] ?? 'other';
  const eventHint = EVENT_WORDS.test(t);
  const taskHint = TASK_WORDS.test(t);

  const rep = parseRepeat(ctx);
  const duration = parseDuration(ctx);
  const time = parseTime(ctx, eventHint || Boolean(rep.repeat) || !taskHint);
  const explicitDate = parseDate(ctx);

  let date = explicitDate ?? rep.firstDate ?? time.date;
  // A plain repeat with no date ("ежедневно", "каждый месяц") starts today.
  if (!date && rep.repeat && !rep.rota) date = toKey(now);

  let { start, end } = time;
  if (rep.allDay && !start) {
    start = '08:00';
    end = '23:59';
  }
  if (!end && start && duration) end = minutesToTime(timeToMinutes(start) + duration);
  // Overnight ranges ("с 21 до 9") are clipped to midnight — events are single-day.
  if (start && end && timeToMinutes(end) <= timeToMinutes(start)) end = '23:59';

  let title = cleanTitle(ctx.text);
  if (!title && rep.rota) title = 'Смена';

  return {
    intent: 'create',
    title,
    date,
    start,
    end,
    duration,
    repeat: rep.repeat,
    needsStart: Boolean(rep.rota && !explicitDate),
    kindWord,
    eventHint: eventHint || Boolean(rep.rota),
    taskHint,
    priority,
    category: rep.rota ? 'work' : category,
    all: false,
    bulk: false,
  };
}

/**
 * Compact one-shot interpretation used by the quick-add field in Tasks
 * (no dialogue there): returns the cleaned title, date, time and priority.
 */
export function parseQuick(input: string, now: Date = new Date()) {
  const a = analyze(input, now);
  if (a.intent !== 'create') return undefined;
  return { title: a.title, date: a.date, start: a.start, priority: a.priority, category: a.category };
}

/**
 * Is the offline analysis trustworthy enough to act on without the model?
 * Used by the app and the server: confident phrases are handled instantly and for free;
 * the rest (several requests at once, leftovers the rules didn't understand) go to the model.
 */
export function isConfident(a: Analysis, text: string): boolean {
  const t = text.toLowerCase();
  if (/[;\n]/.test(text)) return false;
  // "… и напомни …", "… а ещё купи …" — several requests in one sentence.
  if (/\s(?:и|а\s+также|а\s+ещё|а\s+еще|потом|ещё|еще)\s+(?:напомни|купи|добавь|поставь|запиши|удали|перенеси|создай|сделай|отметь)/u.test(t)) return false;
  switch (a.intent) {
    case 'help':
    case 'undo':
    case 'smalltalk':
    case 'agenda':
      return true;
    case 'delete':
    case 'move':
    case 'complete':
    case 'remind':
      return Boolean(a.title || a.bulk || a.targetKind) && !/\d{3,}/.test(a.title);
    case 'create': {
      if (!a.title || a.title.split(/\s+/).length > 6) return false;
      // Date / time words left in the title mean the rules missed something.
      return !/\d|понедельник|вторник|сред[ауы]|четверг|пятниц|суббот|воскресень|январ|феврал|март|апрел|мая|июн|июл|август|сентябр|октябр|ноябр|декабр|утр[аом]|вечер|ночь|ночи|днём|днем|через|кажд|ежедн|еженед|неделе|недели|месяц|завтра|сегодня|послезавтра|полдень|полночь|час[аов]?(?![\p{L}])/iu.test(
        a.title,
      );
    }
  }
}

/**
 * Splits a message into separate requests: ";", new lines, sentences, and
 * "… и напомни …", "… а ещё купи …", "… потом перенеси …".
 */
export function splitRequests(text: string): string[] {
  return text
    .split(/\n+|;\s*|\.\s+(?=[А-ЯЁA-Z])|,?\s+(?:и|а\s+также|а\s+ещё|а\s+еще|потом|ещё|еще)\s+(?=(?:напомни|купи|добавь|поставь|запиши|удали|перенеси|создай|сделай|отметь|запланируй)(?![\p{L}]))/iu)
    .map((s) => s.trim())
    .filter(Boolean);
}
