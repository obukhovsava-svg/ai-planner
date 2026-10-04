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
import { nthOfMonth } from './recurrence';

export type Intent = 'create' | 'agenda' | 'delete' | 'move' | 'complete' | 'remind' | 'note' | 'undo' | 'help' | 'smalltalk';

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
  /** move: "на час позже" (+60) / "на 30 минут раньше" (−30), "на день позже" (+1440). */
  shift?: number;
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
  /**
   * create: the new item's note ("…, заметка: взять документы").
   * note: the text to add / put; undefined when the target and the text weren't separable
   * (then `title` holds both and the assistant splits them by what exists).
   */
  note?: string;
  /** note: what to do with the item's note. */
  noteMode?: 'append' | 'replace' | 'clear' | 'read';
  /** remind: the exact moment, "YYYY-MM-DDTHH:MM" ("напомни о созвоне в 16:55", "… через 5 минут"). */
  remindAt?: string;
}

// Unicode-aware word boundaries (JS \b only understands ASCII).
const B = '(?<![\\p{L}\\d])';
const E = '(?![\\p{L}\\d])';
const rx = (src: string) => new RegExp(src, 'iu');

const NUMBER_WORDS: Record<string, number> = {
  один: 1, одну: 1, одного: 1, два: 2, две: 2, двух: 2, двое: 2, три: 3, трёх: 3, трех: 3, трое: 3,
  четыре: 4, четырёх: 4, четырех: 4, четверо: 4, пять: 5, пяти: 5, шесть: 6, шести: 6,
  семь: 7, семи: 7, восемь: 8, восьми: 8, девять: 9, девяти: 9, десять: 10, десяти: 10,
  одиннадцать: 11, одиннадцати: 11, двенадцать: 12, двенадцати: 12, тринадцать: 13, тринадцати: 13,
  четырнадцать: 14, четырнадцати: 14, пятнадцать: 15, пятнадцати: 15, шестнадцать: 16, шестнадцати: 16,
  семнадцать: 17, семнадцати: 17, восемнадцать: 18, восемнадцати: 18, девятнадцать: 19, девятнадцати: 19,
  двадцать: 20, двадцати: 20, тридцать: 30, тридцати: 30, сорок: 40, сорока: 40, пятьдесят: 50, пятидесяти: 50,
};

/** Day ordinals for dates: "пятнадцатого", "двадцать пятого октября". */
const DAY_ORD: Record<string, number> = {
  первого: 1, второго: 2, третьего: 3, четвёртого: 4, четвертого: 4, пятого: 5, шестого: 6, седьмого: 7, восьмого: 8,
  девятого: 9, десятого: 10, одиннадцатого: 11, двенадцатого: 12, тринадцатого: 13, четырнадцатого: 14, пятнадцатого: 15,
  шестнадцатого: 16, семнадцатого: 17, восемнадцатого: 18, девятнадцатого: 19, двадцатого: 20, тридцатого: 30,
};
const DAY_ORD_RE = Object.keys(DAY_ORD).join('|');

/** Spoken fillers at the start: "слушай", "ну короче", "эээ", "можешь", "хочу"… */
const FILLER_RE = new RegExp(
  `^\\s*(?:(?:слушай|слушайте|смотри|так|значит|вот|ну|короче|эм+|э+|ээ+|а+|ок|окей|okay|ok|хорошо|давай|давайте|алло|будь\\s+добр|будь\\s+любезен|пожалуйста|можешь|можете|можешь\\s+ли|не\\s+мог(?:ла)?\\s+бы\\s+ты|сможешь|хочу|хотел(?:а)?\\s+бы|я\\s+хочу|мне\\s+бы|бот|ассистент|планер|планировщик)(?![\\p{L}\\d])[\\s,.!:—-]*)+`,
  'iu',
);

/** "полвосьмого", "в половине десятого", "четверть восьмого": the hour is the next one. */
const ORD_GEN: Record<string, number> = {
  первого: 1, второго: 2, третьего: 3, четвёртого: 4, четвертого: 4, пятого: 5, шестого: 6, седьмого: 7,
  восьмого: 8, девятого: 9, десятого: 10, одиннадцатого: 11, двенадцатого: 12,
};
const ORD_GEN_RE = Object.keys(ORD_GEN).join('|');

/** Spoken imperatives → the to-do form ("купи хлеб" → "купить хлеб"). */
const IMPERATIVE: Record<string, string> = {
  купи: 'купить', позвони: 'позвонить', перезвони: 'перезвонить', напиши: 'написать', оплати: 'оплатить', заплати: 'заплатить',
  забери: 'забрать', отправь: 'отправить', закажи: 'заказать', подготовь: 'подготовить', проверь: 'проверить', запишись: 'записаться',
  сходи: 'сходить', приготовь: 'приготовить', прочитай: 'прочитать', прочти: 'прочитать', выучи: 'выучить', отнеси: 'отнести',
  принеси: 'принести', возьми: 'взять', спроси: 'спросить', узнай: 'узнать', найди: 'найти', почини: 'починить', постирай: 'постирать',
  помой: 'помыть', вынеси: 'вынести', ответь: 'ответить', скинь: 'скинуть', распечатай: 'распечатать', сдай: 'сдать', погуляй: 'погулять',
  съезди: 'съездить', отвези: 'отвезти', встреть: 'встретить', поздравь: 'поздравить', поменяй: 'поменять', продли: 'продлить',
};

const MONTHS: Record<string, number> = {
  январ: 0, феврал: 1, март: 2, апрел: 3, ма: 4, июн: 5,
  июл: 6, август: 7, сентябр: 8, октябр: 9, ноябр: 10, декабр: 11,
};

const WEEKDAYS: [RegExp, number][] = [
  [/^(понедельник|пн)/, 0], [/^(вторник|вт)/, 1], [/^(сред|ср)/, 2], [/^(четверг|чт)/, 3],
  [/^(пятниц|пт)/, 4], [/^(суббот|сб)/, 5], [/^(воскресень|вс)/, 6],
];
const monthOf = (word: string) => MONTHS[Object.keys(MONTHS).find((k) => word.toLowerCase().startsWith(k))!];
const weekdayOf = (word: string) => WEEKDAYS.find(([re]) => re.test(word.toLowerCase()))?.[1];

const WD_WORD = '(?:понедельник|вторник|сред|четверг|пятниц|суббот|воскресень)\\p{L}*';
const WD_ANY = `(?:${WD_WORD}|пн|вт|ср|чт|пт|сб|вс)`;

const EVENT_WORDS =
  /(?:^|\s)к\s+(?:врачу|доктору|стоматологу|терапевту|парикмахеру|мастеру)|приём\s+у|прием\s+у|встреч|встрет|созвон|звонок|совещани|митинг|планёрк|планерк|обед|ужин|завтрак|тренировк|при[её]м|урок|лекци|занят|презентаци|собеседовани|консультаци|вебинар|концерт|кино|театр|свидани|день рождени|праздник|вечеринк|смен|дежурств|вахт|сутки|пар[аыу](?!\p{L})|экзамен|матч|игр[аы]|репетици|массаж|стрижк|маникюр/iu;
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
  врачу: 'врач', доктору: 'доктор', стоматологу: 'стоматолог', терапевту: 'терапевт', парикмахеру: 'парикмахер', мастеру: 'мастер',
  стоматолога: 'стоматолог', врача: 'врач', стрижку: 'стрижка', йогу: 'йога', работу: 'работа',
  созвону: 'созвон', обеду: 'обед', ужину: 'ужин', уроку: 'урок', экзамену: 'экзамен', собранию: 'собрание', совещанию: 'совещание',
  вебинару: 'вебинар', массажу: 'массаж', концерту: 'концерт', приёму: 'приём', приему: 'прием', встречам: 'встреча',
  стоматологе: 'стоматолог', враче: 'врач', совещания: 'совещание', совещании: 'совещание', собрании: 'собрание', собрания: 'собрание',
  вебинаре: 'вебинар', вебинара: 'вебинар', экзамене: 'экзамен', экзамена: 'экзамен', уроке: 'урок', урока: 'урок', 
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
  // Dictation adds a full stop at the end; "7.30" and "20.10" stay intact.
  let t = ` ${input.replace(/[«»"!?;]/g, ' ').replace(/\.(?=\s|$)/g, ' ')} `;
  for (let i = 0; i < 3; i++) t = t.replace(FILLER_RE, ' ');
  // "двадцать пятого октября", "пятнадцатого" → "25-го", "15-го"
  t = t.replace(rx(`${B}(двадцать|тридцать)\\s+(${DAY_ORD_RE})${E}`), (_, tens, w) => ` ${(tens.toLowerCase() === 'двадцать' ? 20 : 30) + DAY_ORD[w.toLowerCase()]}-го `);
  t = t.replace(rx(`${B}в час(?=\\s+(дня|ночи))`), 'в 1');
  // "полвосьмого", "в половине десятого" → 7:30 / 9:30; "четверть восьмого" → 7:15
  t = t.replace(rx(`${B}(?:в\\s+)?(?:пол-?|половин[аеуы]\\s+)(${ORD_GEN_RE})${E}`), (_, w) => ` в ${(ORD_GEN[w.toLowerCase()] + 11) % 12 || 12}:30 `);
  t = t.replace(rx(`${B}(?:в\\s+)?четверть\\s+(${ORD_GEN_RE})${E}`), (_, w) => ` в ${(ORD_GEN[w.toLowerCase()] + 11) % 12 || 12}:15 `);
  for (const [word, n] of Object.entries(NUMBER_WORDS)) {
    t = t.replace(new RegExp(`${B}${word}${E}`, 'giu'), String(n));
  }
  t = t.replace(rx(`${B}(${DAY_ORD_RE})${E}`), (_, w) => ` ${DAY_ORD[w.toLowerCase()]}-го `);
  // "семнадцать ноль ноль" → 17:00, "девять ноль пять" → 9:05, "двадцать пять" → 25
  t = t.replace(/(\d{1,2})\s+ноль\s+ноль(?![\p{L}\d])/giu, '$1:00').replace(/(\d{1,2})\s+ноль\s+(\d)(?![\p{L}\d])/giu, '$1:0$2');
  t = t.replace(/(?<![\d:.])(20|30|40|50)\s+([1-9])(?![\d:.]|\s*(?:-?го|числа|час|мин))/gu, (_, a, b) => String(Number(a) + Number(b)));
  // "без пятнадцати 7", "без четверти 9", "без 10 минут 8" → 6:45, 8:45, 7:50
  t = t.replace(rx(`${B}(?:в\\s+)?без\\s+(четверти|\\d{1,2})(?:\\s+минут\\p{L}*)?\\s+(\\d{1,2})${E}`), (_, m, h) => {
    const min = m.toLowerCase() === 'четверти' ? 15 : Number(m);
    const hour = Number(h) - 1;
    return min > 0 && min < 60 && hour >= 0 ? ` в ${hour || 12}:${String(60 - min).padStart(2, '0')} ` : _;
  });
  // "на 3 часа дня", "на 8 вечера" — a time, not a duration
  t = t.replace(rx(`${B}на\\s+(\\d{1,2}(?::\\d{2})?)\\s*(?:час(?:а|ов)?\\s+)?(утра|дня|вечера|ночи)${E}`), ' в $1 $2 ');
  // "купи" → "купить"
  t = t.replace(/[\p{L}]+/gu, (w) => IMPERATIVE[w.toLowerCase()] ?? w);
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
/** Not a clock time: "5 числа", "10-е", "3 октября", "2 недели"… */
const notDate = '(?!\\s*(?:-?го\\s+|-?е\\s+)?(?:числ|январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр|недел|минут)|-?(?:го|е)(?![\\p{L}\\d]))';

export function parseDurationText(text: string): number | undefined {
  const ctx: Ctx = { text: normalize(text), now: new Date() };
  return parseDuration(ctx, true);
}

/** A typed / spoken answer, cleaned like a request: "До семи." → "до 7", "Ну давай в шесть вечера" → "в 6 вечера". */
export function normalizeAnswer(text: string): string {
  return normalize(text)
    .replace(/(?<![\p{L}])(?:давай(?:те)?|лучше|тогда|ну|пусть|пожалуй|наверное|наверно|можно|наверн\p{L}*)(?![\p{L}])/giu, ' ')
    .replace(/[\s,.!?…]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "за 10 минут", "10 минут", "час", "за день", "вовремя" → minutes before. */
export function parseOffsetText(text: string): number | undefined {
  const t = normalizeAnswer(text).toLowerCase();
  if (/^(?:вовремя|в\s+момент|в\s+самое\s+время|ровно|в\s+начале|когда\s+начн\p{L}*)$/u.test(t)) return 0;
  const ctx: Ctx = { text: ` ${/^за\s/u.test(t) ? t : `за ${t.replace(/^на\s+/u, '')}`} `, now: new Date() };
  const off = parseRemindOffset(ctx);
  return off !== undefined && !ctx.text.trim() ? off : undefined;
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
  const rel = take(ctx, rx(`${B}через\\s+(?:(\\d+)\\s*)?(час(?:а|ов)?|минут[уы]?|полчаса|полтора\\s+часа)${E}`));
  if (rel) {
    const n = rel[1] ? Number(rel[1]) : 1;
    const unit = rel[2].toLowerCase();
    const mins = unit === 'полчаса' ? 30 : unit.startsWith('полтора') ? 90 : unit.startsWith('час') ? n * 60 : n;
    const target = new Date(ctx.now.getTime() + mins * 60_000);
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
  // "в обед", "к обеду", "в обеденный перерыв"
  if (take(ctx, rx(`${B}(?:в|к|во\\s+время)\\s+(?:обед|обеду|обеденный\\s+перерыв|обеда)${E}`))) return { start: '13:00' };
  // "до вечера", "к вечеру" — a deadline later today; "до обеда" — before lunch
  if (take(ctx, rx(`${B}(?:до|к)\\s+(?:вечера|вечеру)${E}`))) return { start: '18:00' };
  if (take(ctx, rx(`${B}до\\s+обеда${E}`))) return { start: '12:00' };
  if (take(ctx, rx(`${B}(?:в|к)?\\s*полночь${E}`))) return { start: '00:00' };

  let start: TimeStr | undefined;
  // "на 15:00" — only with minutes, so "на 3 человека" stays untouched
  const onClock = take(ctx, rx(`${B}на\\s+(\\d{1,2})[:.](\\d{2})${E}`));
  if (onClock) start = hhmm(Number(onClock[1]), Number(onClock[2]));

  // "в 15:00", "к 9 утра", "в 7 часов вечера", "в 15 30" (but not "к 5 числа")
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

  // "в среду на следующей неделе", "на следующей неделе в пятницу"
  const nextWeek = rx(`${B}(?:на\\s+)?следующей\\s+неделе${E}`);
  if (nextWeek.test(ctx.text)) {
    const wdIn = ctx.text.match(rx(`${B}(?:(?:в|во|на)\\s+)?(${WD_WORD})${E}`));
    take(ctx, nextWeek);
    if (wdIn && weekdayOf(wdIn[1]) !== undefined) {
      take(ctx, rx(wdIn[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return addDays(startOfWeek(today), 7 + weekdayOf(wdIn[1])!);
    }
    return addDays(startOfWeek(today), 7);
  }

  // weekends
  const sat = addDays(startOfWeek(today), 5);
  if (take(ctx, rx(`${B}(?:на|в)\\s+следующи[хе]\\s+выходны[хе]${E}`))) return addDays(sat, 7);
  if (take(ctx, rx(`${B}(?:на\\s+(?:этих\\s+)?выходных|в\\s+(?:эти\\s+)?выходные|на\\s+выходные)${E}`))) return today >= sat ? today : sat;

  // "в конце / начале / середине месяца|ноября|недели", "до конца месяца", "в течение недели"
  const monthEdge = take(
    ctx,
    rx(`${B}(?:в|до|к)\\s+(конц[ае]|начал[ае]|середин[еуы])\\s+(?:(этого|следующего)\\s+)?(месяца|недели|январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр)\\p{L}*${E}`),
  );
  if (monthEdge) {
    const edge = monthEdge[1].toLowerCase();
    const unit = monthEdge[3].toLowerCase();
    if (unit.startsWith('недел')) {
      const fri = addDays(startOfWeek(today), monthEdge[2]?.toLowerCase() === 'следующего' ? 11 : 4);
      return edge.startsWith('нач') ? addDays(startOfWeek(today), 7) : fri < today ? addDays(fri, 7) : fri;
    }
    let y = ctx.now.getFullYear();
    const m = unit.startsWith('месяц') ? ctx.now.getMonth() + (monthEdge[2]?.toLowerCase() === 'следующего' ? 1 : 0) : monthOf(unit);
    if (!unit.startsWith('месяц') && m < ctx.now.getMonth()) y += 1;
    const day = edge.startsWith('нач') ? 1 : edge.startsWith('сер') ? 15 : new Date(y, m + 1, 0).getDate();
    let d = toKey(new Date(y, m, day));
    if (d < today) d = today;
    return d;
  }
  if (take(ctx, rx(`${B}(?:в\\s+течение|за)\\s+(?:этой\\s+)?недели${E}`))) return addDays(today, 6);
  if (take(ctx, rx(`${B}(?:до\\s+конца|к\\s+концу)\\s+(?:этой\\s+)?недели${E}`))) return addDays(startOfWeek(today), 6);

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

  const dayOnly = take(ctx, rx(`${B}(?:${from}\\s+|к\\s+)?(\\d{1,2})(?:(?:-?го|-?е)?\\s+(?:числа|число)|-?(?:го|е))${E}`));
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
  /** "с 1 по 10 ноября" — a multi-day stretch (all day, every day). */
  span?: boolean;
}

/**
 * Repeat rules: "каждый день", "по будням", "каждые 2 недели", "раз в месяц", "ежегодно",
 * "по понедельникам и средам", rotas "график 2/2", "2 через 2", "сутки через трое", "5/2".
 */
function parseRepeat(ctx: Ctx): RepeatInfo {
  // "отпуск с 1 по 10 ноября", "командировка с 12 по 15 октября" — every day of the range, all day
  const MON = '(январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр)\\p{L}*';
  const span = take(ctx, rx(`${B}(?:с|со)\\s+(\\d{1,2})(?:-?го)?(?:\\s+${MON})?\\s+(?:по|до)\\s+(\\d{1,2})(?:-?е|-?го)?\\s+${MON}${E}`));
  if (span) {
    const m2 = monthOf(span[4]);
    const m1 = span[2] ? monthOf(span[2]) : m2;
    let y = ctx.now.getFullYear();
    if (m2 < ctx.now.getMonth()) y += 1;
    const from = toKey(new Date(m1 > m2 ? y - 1 : y, m1, Number(span[1])));
    const to = toKey(new Date(y, m2, Number(span[3])));
    if (to >= from) return { repeat: { freq: 'day', interval: 1, until: to }, firstDate: from, allDay: true, span: true };
  }

  // "каждое 1 число", "каждого 5-го числа", "5 числа каждого месяца"
  const monthly = take(ctx, rx(`${B}(?:(?:каждое|каждого|ежемесячно)\\s+(\\d{1,2})(?:-?е|-?го)?(?:\\s+числ\\p{L}*)?|(\\d{1,2})(?:-?го)?\\s+числа\\s+каждого\\s+месяца)${E}`));
  if (monthly) {
    const day = Number(monthly[1] ?? monthly[2]);
    let d = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), day);
    if (toKey(d) < toKey(ctx.now)) d = new Date(ctx.now.getFullYear(), ctx.now.getMonth() + 1, day);
    if (day >= 1 && day <= 31) return { repeat: { freq: 'month', interval: 1 }, firstDate: toKey(d) };
  }

  // "каждый второй вторник", "каждую последнюю пятницу месяца", "в последний день каждого месяца"
  const NTH: Record<string, number> = { перв: 1, втор: 2, трет: 3, четв: 4, пят: 5, послед: -1 };
  const nthOf = (w: string) => NTH[Object.keys(NTH).find((k) => w.toLowerCase().startsWith(k))!];
  const firstNth = (nth: number, wd?: number) => {
    const today = toKey(ctx.now);
    for (let k = 0; k < 14; k++) {
      const d = nthOfMonth(ctx.now.getFullYear(), ctx.now.getMonth() + k, nth, wd);
      if (d && d >= today) return d;
    }
    return undefined;
  };
  const nthWd = take(
    ctx,
    rx(`${B}(?:каждый|каждую|каждое|по|в)\\s+(перв|втор|трет|четв[её]рт|последн)\\p{L}*\\s+(${WD_WORD})(?:\\s+(?:каждого\\s+)?месяца)?${E}`),
  );
  if (nthWd) {
    const nth = nthOf(nthWd[1]);
    const wd = weekdayOf(nthWd[2])!;
    return { repeat: { freq: 'month', interval: 1, nth, byWeekday: [wd] }, firstDate: firstNth(nth, wd) };
  }
  if (take(ctx, rx(`${B}(?:(?:каждый|в)\\s+последний\\s+день\\s+(?:каждого\\s+)?месяца|последнего\\s+числа\\s+каждого\\s+месяца|в\\s+конце\\s+каждого\\s+месяца)${E}`)))
    return { repeat: { freq: 'month', interval: 1, nth: -1 }, firstDate: firstNth(-1) };

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
  const list = take(ctx, rx(`${B}(?:(?:каждые|раз\\s+в)\\s+(\\d+)\\s+недел\\p{L}*\\s+)?(?:каждый|каждую|каждое|по)\\s+(${WD_ANY}(?:(?:\\s*,\\s*|\\s+и\\s+|\\s+)${WD_ANY})*)${E}`));
  if (list) {
    const days = [...new Set(list[2].split(/\s*,\s*|\s+и\s+|\s+/u).map(weekdayOf).filter((d): d is number => d !== undefined))].sort();
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
    .replace(rx(`^\\s*(?:о\\s+том,?\\s+)?что${E}`), ' ')
    .replace(rx(`${B}(?:в\\s+)?(?:календарь|задачи|список\\s+задач|расписание)${E}`), ' ')
    .replace(rx(`${B}(?:новую\\s+|новое\\s+)?(?:задачу|задача|событие)${E}\\s*:?`), ' ')
    .replace(rx(`${B}(?:срочно|срочная|срочную|важно|важная|важную|пожалуйста|начиная|график\\p{L}*|по\\s+графику)${E}`), ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip prepositions left dangling at either end after removing date/time.
  const dangling = rx(`^(?:на|в|во|к|с|со|до|о|об|про|что|и|по)${E}\\s*|\\s*${B}(?:на|в|во|к|с|со|до|и|о|об|про|по|,)$`);
  for (let i = 0; i < 4; i++) t = t.replace(dangling, '').trim();

  t = t.replace(/^[\s,.;:—–-]+|[\s,.;:—–-]+$/gu, '');
  t = t.replace(/^\p{L}+/u, (w) => NOUN_FIX[w.toLowerCase()] ?? w);
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

const REMIND_CANCEL_RE = rx(
  `^\\s*(?:пожалуйста\\s+)?(?:убери|удали|отмени|выключи|отключи|сними|не\\s+напоминай)(?:\\s+(?:все\\s+)?напоминани\\p{L}*)?${E}`,
);
const REMIND_RE = rx(
  `^\\s*(?:пожалуйста\\s+)?(?:напомни(?:те)?|напомнить|напоминай(?:те)?|(?:поставь|поставить|создай|добавь|включи|сделай)\\s+напоминани\\p{L}*)${E}\\s*,?\\s*(?:мне\\s+)?(?:пожалуйста\\s+)?`,
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
  `^\\s*(?:а\\s+)?(?:(?:что|какие|какой|покажи|расскажи|какое|есть\\s+ли)${E}.*(?:план|дел|задач|событи|расписани|у\\s+меня|запланирован|встреч)|что\\s+(?:на|в|во)\\s+(?:выходн|завтра|сегодня|послезавтра|неделе|эт\\p{L}+\\s+неделе|следующ|понедельник|вторник|среду|четверг|пятниц|суббот|воскресень|\\d))`,
);
const HELP_RE = rx(`^\\s*(?:что\\s+ты\\s+умеешь|что\\s+умеешь|помощь|help|помоги|как\\s+(?:тобой\\s+)?пользоваться|что\\s+ты\\s+можешь)`);
const SMALLTALK_RE = rx(
  `^\\s*(?:привет|здравствуй\\p{L}*|добр\\p{L}+\\s+(?:утро|день|вечер)|спасибо|благодарю|ок|окей|хорошо|понял\\p{L}*|ясно|пока|супер|отлично|класс|круто)${E}`,
);
const UNDO_RE = rx(`^\\s*(?:отмени|отменить|верни|вернуть|откати)(?:\\s+(?:последн\\p{L}*(?:\\s+действие)?|это|что\\s+сделал|как\\s+было|назад))?\\s*$`);
const DELETE_RE = rx(`^\\s*(?:пожалуйста\\s+)?(?:удали|удалить|убери|убрать|отмени|отменить|сотри|вычеркни|очисти|очистить)${E}(?:\\s+|\\s*$)`);
const MOVE_RE = rx(`^\\s*(?:пожалуйста\\s+)?(?:перенеси|перенести|передвинь|сдвинь|перемести|переставь)${E}(?:\\s+|\\s*$)`);
const COMPLETE_RE = rx(
  `^\\s*(?:(?:отметь|отметить)\\s+(.+?)\\s+(?:как\\s+)?(?:выполненн\\p{L}*|сделанн\\p{L}*|готов\\p{L}*)|(?:я\\s+)?(?:сделал|сделала|выполнил|выполнила|закончил|закончила|купил|купила)\\s+(.+)|(.+?)\\s+(?:готово|сделано|выполнено)|(?:готово|сделано|выполнено)\\s*[:,—-]?\\s+(.+))\\s*$`,
);

const NOTE_WORD = '(?:заметк\\p{L}*|примечани\\p{L}*|комментари\\p{L}*|описани\\p{L}*)';
const NOTE_READ_RE = rx(`^\\s*(?:а\\s+)?(?:что|какая|какие|какой|покажи|прочитай|прочти|открой|напомни|скажи)${E}.*${B}${NOTE_WORD}${E}`);
const NOTE_CLEAR_RE = rx(`^\\s*(?:пожалуйста\\s+)?(?:очисти|удали|убери|сотри|стери)\\s+(?:все\\s+|всю\\s+)?${NOTE_WORD}${E}`);
const NOTE_REPLACE_RE = rx(`^\\s*(?:пожалуйста\\s+)?(?:замени|перепиши|поменяй|измени|исправь)\\s+${NOTE_WORD}${E}`);
const NOTE_ADD_RE = rx(
  `(?:^\\s*(?:пожалуйста\\s+)?(?:добавь|допиши|дописать|добавить|запиши|записать|внеси|сохрани|напиши|оставь|прикрепи|сделай|создай)\\s+(?:в\\s+|во\\s+)?${NOTE_WORD}${E}|^\\s*(?:в|во)\\s+${NOTE_WORD}\\s+.*${B}(?:добавь|допиши|запиши|внеси|напиши)${E}|^\\s*(?:к|для)\\s+.+?${B}(?:добавь|допиши|запиши|внеси|напиши)\\s+(?:в\\s+)?${NOTE_WORD}${E}|^\\s*допиши\\s+(?:к|в)${E})`,
);

/**
 * Notes of existing items: "добавь в заметку к встрече с Анной: взять документы",
 * "к созвону добавь заметку обсудить бюджет", "что в заметке к тренировке", "очисти заметку к созвону".
 */
function parseNote(ctx: Ctx, mode: NonNullable<Analysis['noteMode']>): Analysis {
  let t = ctx.text;
  // Drop the command words, keep "к <что> : <текст>".
  t = t
    .replace(rx(`^\\s*(?:пожалуйста\\s+)?(?:а\\s+)?(?:что|какая|какие|какой|покажи|прочитай|прочти|открой|напомни|скажи|очисти|удали|убери|сотри|стери|замени|перепиши|поменяй|измени|исправь|добавь|допиши|дописать|добавить|запиши|записать|внеси|сохрани|напиши|оставь|прикрепи|сделай|создай)${E}`), ' ')
    // "в заметку к X добавь Y" — the verb in the middle separates the target from the text
    .replace(rx(`${B}(?:добавь|допиши|запиши|внеси|напиши)${E}`), ' : ')
    .replace(rx(`${B}(?:в\\s+|во\\s+)?(?:все\\s+|всю\\s+)?${NOTE_WORD}${E}`), ' ')
    .replace(rx(`^\\s*(?:у\\s+меня\\s+)?(?:есть\\s+)?(?:в|во|у)?\\s*`), ' ');
  let targetKind: Analysis['targetKind'];
  const kindWord = t.match(rx(`${B}(?:к|для|у|в|о)?\\s*(задач\\p{L}*|событи\\p{L}*)${E}`));
  if (kindWord) {
    targetKind = /задач/iu.test(kindWord[1]) ? 'task' : 'event';
    t = t.replace(kindWord[0], ' ');
  }
  let target = t;
  let text: string | undefined;
  const sep = mode === 'replace' ? t.match(/^(.*?)(?:\s*[:—–]\s*|\s+-\s+|\s+на\s+(?:текст\s+)?)(.+)$/u) : t.match(/^(.*?)(?:\s*[:—–]\s*|\s+-\s+|\s+(?:текст|что)\s+)(.+)$/u);
  if (sep && (mode === 'append' || mode === 'replace')) {
    target = sep[1];
    text = sep[2].replace(/^[\s:—–-]+/u, '').trim() || undefined;
  } else target = t.replace(/[:—–]/gu, ' ');
  const sub: Ctx = { text: ` ${target} `, now: ctx.now };
  const adj = take(sub, rx(`${B}(сегодняшн|завтрашн|послезавтрашн)\\p{L}*${E}`));
  const date = adj ? addDays(toKey(ctx.now), adj[1].startsWith('сегодн') ? 0 : adj[1].startsWith('завтр') ? 1 : 2) : parseDate(sub);
  const title = cleanTitle(sub.text.replace(rx(`^\\s*(?:к|ко|для|у|в|во|о|об|про)${E}`), ' '));
  const note = text ? text.charAt(0).toUpperCase() + text.slice(1) : undefined;
  return { ...baseAnalysis('note', title), noteMode: mode, note, date, targetKind };
}

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
  if (take(ctx, rx(`${B}(?:на\\s+(?:этой\\s+)?неделе|до\\s+конца\\s+недели|на\\s+эту\\s+неделю)${E}`))) return { from: today, to: sunday, label: 'на этой неделе' };
  if (take(ctx, rx(`${B}(?:на\\s+неделю|на\\s+7\\s+дней|на\\s+ближайшие\\s+дни)${E}`))) return { from: today, to: addDays(today, 6), label: 'на неделю' };
  if (take(ctx, rx(`${B}(?:на\\s+выходных|в\\s+выходные|на\\s+выходные)${E}`))) {
    const sat = addDays(startOfWeek(today), 5);
    const from = today > sat ? today : sat;
    return { from, to: addDays(startOfWeek(today), 6), label: 'на выходных' };
  }
  const d = parseDate(ctx) ?? today;
  return { from: d, to: d, label: '' };
}

/**
 * Reminder phrasing → "напомни …" at the front: "предупреди меня", "не забудь напомнить",
 * "за 5 минут напомни о созвоне", "созвон в 17 напомни за 5 минут", "… с напоминанием за 10 минут".
 */
function reminderFirst(t: string): string {
  // "напоминание: оплатить интернет завтра", "напоминалка завтра в 10 …"
  t = t.replace(rx(`^\\s*(?:напоминание|напоминалка|напоминалку|напоминалочка)\\s*[:—-]?\\s+(?!(?:о|об|про|для|на|с)\\s)`), ' напомни ');
  t = t.replace(rx(`^\\s*(?:пожалуйста\\s+)?(?:предупреди(?:те)?(?:\\s+меня)?|не\\s+забудь(?:те)?\\s+(?:мне\\s+)?напомнить|не\\s+дай\\s+(?:мне\\s+)?забыть)${E}`), ' напомни ');
  t = t.replace(rx(`${B}(поставь|поставить|создай|добавь|включи|сделай)\\s+напоминалк\\p{L}*${E}`), '$1 напоминание');
  if (/^\s*(?:пожалуйста\s+)?(?:напомни|напоминай|напомнить|не\s+напоминай|(?:поставь|поставить|создай|добавь|включи|сделай|убери|удали|отмени|выключи|отключи|сними)\s+(?:все\s+)?напоминани)/iu.test(t)) return t;
  // "… с напоминанием за 10 минут", "… и напомни за час" — a new thing with a reminder
  const tail = t.match(
    rx(
      `(?:,\\s*)?(?:${B}(?:с|и|а)\\s+)?(?:(?:поставь|поставить|сделай|добавь|включи)\\s+)?(?:напоминани\\p{L}*|напомни(?:те)?(?:\\s+мне)?)((?:\\s+(?:за\\s+\\S+(?:\\s+(?:минут\\p{L}*|мин|час\\p{L}*|ч|дн\\p{L}*|день|сут\\p{L}*|недел\\p{L}*))?|заранее|вовремя|в\\s+\\d{1,2}(?:[:.]\\d{2})?(?:\\s+(?:утра|дня|вечера|ночи))?|утром|днём|днем|вечером|ночью|через\\s+\\S+(?:\\s+(?:минут\\p{L}*|час\\p{L}*))?))*)\\s*$`,
    ),
  );
  if (tail && tail.index! > 0) return ` напомни ${t.slice(0, tail.index)} ${tail[1]} `;
  // "за 5 минут напомни о созвоне"
  const mid = t.match(rx(`^(.*?)${B}(напомни(?:те)?(?:\\s+мне)?)${E}(.*)$`));
  if (mid && mid[1].trim()) return ` напомни ${mid[1]} ${mid[3]} `;
  return t;
}

export function analyze(input: string, now: Date = new Date()): Analysis {
  const ctx: Ctx = { text: reminderFirst(normalize(input.trim())), now };
  const t = ctx.text;

  if (HELP_RE.test(t)) return baseAnalysis('help');
  if (UNDO_RE.test(t)) return baseAnalysis('undo');
  if (SMALLTALK_RE.test(t) && t.trim().split(/\s+/).length <= 4) return baseAnalysis('smalltalk', t.trim());
  // "к тренировке запиши взять полотенце" — a note for an existing thing (not "к понедельнику добавь задачу …")
  const toThing = t.match(
    rx(`^\\s*(?:к|ко|для)\\s+(?!\\d|понедельник|вторник|сред|четверг|пятниц|суббот|воскресень|завтр|сегодн|послезавтр|вечеру|утру|обеду|концу|началу|выходн|следующ|эт\\p{L}+\\s)(.+?)\\s+(?:запиши|добавь|допиши|внеси)\\s+(?!(?:задач|событи|встреч|в\\s+календарь|напоминани)\\p{L}*)(.+)$`),
  );
  if (toThing && !rx(`${B}${NOTE_WORD}${E}`).test(t)) {
    const a = parseNote({ text: ` к ${toThing[1]} : ${toThing[2]} `, now }, 'append');
    if (a.title && a.note) return a;
  }
  if (rx(`${B}${NOTE_WORD}${E}`).test(t) || /^\s*допиши\s/iu.test(t)) {
    if (NOTE_CLEAR_RE.test(t)) return parseNote(ctx, 'clear');
    if (NOTE_REPLACE_RE.test(t)) return parseNote(ctx, 'replace');
    if (NOTE_READ_RE.test(t)) return parseNote(ctx, 'read');
    if (NOTE_ADD_RE.test(t)) return parseNote(ctx, 'append');
  }
  if (AGENDA_RE.test(t)) return { ...baseAnalysis('agenda'), range: agendaRange(ctx) };

  // Reminders: "напомни о встрече за час", "напоминай за день до каждой смены",
  // "убери напоминание о тренировке", or "напомни купить хлеб в 10" (a new item with a reminder).
  const cancelRemind = REMIND_CANCEL_RE.test(t) && /напомин/iu.test(t);
  if (cancelRemind || REMIND_RE.test(t)) {
    take(ctx, cancelRemind ? REMIND_CANCEL_RE : REMIND_RE);
    const early = take(ctx, rx(`${B}заранее${E}`));
    const onTime = take(ctx, rx(`${B}вовремя${E}`));
    const offset = cancelRemind ? undefined : (parseRemindOffset(ctx) ?? (onTime ? 0 : early ? 30 : undefined));
    // "напомни, что завтра в 10 встреча с юристом" — the thing itself, with a reminder
    ctx.text = ctx.text.replace(rx(`^\\s*,?\\s*(?:о\\s+том,?\\s+)?что${E}`), ' ');
    const about = rx(
      `^\\s*(?:о|об|обо|про|насч[её]т|для|до|на(?=\\s+(?!\\d|завтра|сегодня|послезавтра|понедельник|вторник|среду|четверг|пятниц|суббот|воскресень|следующ|эт[уо]|выходн|неделе|полчаса|час|сутки)))\\s+(?!\\d)`,
    );
    if (cancelRemind || about.test(ctx.text)) {
      take(ctx, about);
      take(ctx, rx(`${B}(?:каждой|каждого|каждую|каждый|всех|все|моей|моего|мою|моём|моем)${E}`));
      const duration = parseDuration(ctx);
      const time = parseTime(ctx, true);
      const explicit = parseDate(ctx);
      const date = explicit ?? time.date;
      // No "за …" but a time: that's when to remind ("о созвоне в 16:55", "про созвон через 5 минут").
      const remindAt = !cancelRemind && offset === undefined && time.start ? `${date ?? toKey(now)}T${time.start}` : undefined;
      return {
        ...baseAnalysis('remind', cleanTitle(ctx.text)),
        all: cancelRemind && rx(`${B}(?:все|всех|всё)\\s+напоминани`).test(t),
        date: remindAt ? explicit : date,
        remindAt,
        start: remindAt ? undefined : time.start,
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
    // "напомни через 5 минут" — nothing named, but a moment: a plain reminder
    const title = inner.title || (inner.date || inner.start ? 'Напоминание' : '');
    return { ...inner, title, remind: true, remindOffset: offset, taskHint: inner.eventHint ? inner.taskHint : true };
  }

  const done = t.match(COMPLETE_RE);
  if (done) return baseAnalysis('complete', cleanTitle(done[1] ?? done[2] ?? done[3] ?? done[4] ?? ''));

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
    let srcPM = false;
    if (intent === 'move') {
      // "завтрашнюю тренировку", "сегодняшнюю встречу"
      const adj = take(ctx, rx(`${B}(сегодняшн|завтрашн|послезавтрашн)\\p{L}*${E}`));
      if (adj) sourceDate = addDays(toKey(now), adj[1].startsWith('сегодн') ? 0 : adj[1].startsWith('завтр') ? 1 : 2);
      // "с завтра на 10 число", "со среды на пятницу", "с 5 октября на 7"
      const src = ctx.text.match(
        rx(
          `${B}(?:с|со)\\s+(?:понедельника|вторника|среды|четверга|пятницы|субботы|воскресенья|послезавтра|завтра|сегодня|\\d{1,2}(?:-?го)?\\s+(?:числа|январ\\p{L}*|феврал\\p{L}*|март\\p{L}*|апрел\\p{L}*|ма[яй]|июн\\p{L}*|июл\\p{L}*|август\\p{L}*|сентябр\\p{L}*|октябр\\p{L}*|ноябр\\p{L}*|декабр\\p{L}*)|\\d{1,2}-?(?:го|е)|\\d{1,2}[./]\\d{1,2})${E}`,
        ),
      );
      if (src) {
        const sub: Ctx = { text: ` ${src[0].replace(/^(со|с)\s+/iu, 'на ')} `, now };
        sourceDate = parseDate(sub) ?? sourceDate;
        take(ctx, rx(src[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
      // "с 10 вечера на 8 вечера до 10", "с 15 на 16": the first time is the old one
      const st = take(ctx, rx(`${B}(?:с|со)\\s+${CLOCK}${notDate}(?:\\s*час(?:а|ов)?)?${PART}(?=\\s+(?:на|в)\\s+\\d)`));
      if (st) {
        srcPM = applyDaypart(Number(st[1]), st[4], true) >= 12;
        // the new time: "на 8 вечера" → "в 8 вечера"
        ctx.text = ctx.text.replace(rx(`${B}на\\s+(?=${CLOCK}${notDate})`), 'в ');
      }
    }
    let shift: number | undefined;
    if (intent === 'move') {
      // "на час позже", "на 30 минут раньше", "на полчаса вперёд", "на 2 дня позже"
      const sh = take(
        ctx,
        rx(`${B}(?:на\\s+)?(?:(\\d+(?:[.,]5)?)\\s*)?(полчаса|полтора\\s+часа|час\\p{L}*|ч|минут\\p{L}*|мин|день|дня|дней|недел\\p{L}*)\\s+(позже|попозже|вперёд|вперед|раньше|пораньше|назад)${E}`),
      );
      if (sh) {
        const n = sh[1] ? Number(sh[1].replace(',', '.')) : 1;
        const u = sh[2].toLowerCase();
        const mins = u === 'полчаса' ? 30 : u.startsWith('полтора') ? 90 : u.startsWith('мин') ? n : u.startsWith('ч') ? n * 60 : u.startsWith('недел') ? n * 10080 : n * 1440;
        shift = Math.round(/раньше|пораньше|назад/iu.test(sh[3]) ? -mins : mins);
      }
      // "передвинь ужин на 21" — a bare hour
      ctx.text = ctx.text.replace(rx(`${B}на\\s+(?=\\d{1,2}${notDate}(?:\\s|$))`), 'в ');
    }
    const duration = parseDuration(ctx);
    const time = parseTime(ctx, true);
    // "с 10 вечера на 8" — the new time stays in the evening
    if (srcPM && time.start && timeToMinutes(time.start) < 12 * 60 && !/утра/iu.test(t)) {
      time.start = minutesToTime(timeToMinutes(time.start) + 12 * 60);
      if (time.end && timeToMinutes(time.end) < timeToMinutes(time.start)) time.end = minutesToTime(Math.min(timeToMinutes(time.end) + 12 * 60, 23 * 60 + 59));
    }
    const date = parseDate(ctx) ?? time.date;
    return { ...baseAnalysis(intent, cleanTitle(ctx.text)), date, start: time.start, end: time.end, duration, sourceDate, shift, all, targetKind };
  }

  // ---- create ----
  // "…, заметка: взять документы", "… с заметкой взять паспорт"
  const noteTail = take(ctx, rx(`(?:,\\s*)?(?:${B}(?:с|и)\\s+)?${B}(?:заметк\\p{L}*|примечани\\p{L}*|комментари\\p{L}*)\\s*[:—–-]?\\s*(.+)$`));
  const createNote = noteTail?.[1]?.trim() ? noteTail[1].trim().charAt(0).toUpperCase() + noteTail[1].trim().slice(1) : undefined;
  const kindWord: Analysis['kindWord'] = rx(`${B}(?:в\\s+календарь|событи\\p{L}*|в\\s+расписание)`).test(t)
    ? 'event'
    : rx(`${B}(?:задач\\p{L}*|в\\s+список|в\\s+задачи)${E}`).test(t)
      ? 'task'
      : undefined;
  const priority: Priority = /срочн|важн|asap|критичн/iu.test(t) ? 'high' : /не\s+срочно|когда-нибудь|потом/iu.test(t) ? 'low' : 'medium';
  const category = CATEGORY_RULES.find(([re]) => re.test(t))?.[1] ?? 'other';
  // "записаться к врачу / на стрижку" is a to-do, not the appointment itself
  const eventHint = EVENT_WORDS.test(t) && !rx(`${B}записат\\p{L}*\\s+(?:к|на)${E}`).test(t);
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
    start = rep.span ? '00:00' : '08:00';
    end = '23:59';
  }
  // "весь день", "на целый день"; birthdays, holidays, vacations with a day but no time
  const wholeDay = take(ctx, rx(`${B}(?:на\\s+)?(?:весь|целый)\\s+день${E}`));
  if (!start && (wholeDay || (date && /день\s+рождени|годовщин|праздник|отпуск|выходной|командировк/iu.test(t)))) {
    start = '00:00';
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
    note: createNote,
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

/** Date / time words left in a title mean the rules missed something. */
const LEFTOVER =
  /(?:^|\s)(?:добавь|запиши|поставь|допиши|создай|внеси)(?![\p{L}])|\d(?![\d.:]*\s+(?!час|мин|числ|утр|вечер|дня|ночи|недел|месяц|январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр)\p{L})|понедельник|вторник|сред[ауы]|четверг|пятниц|суббот|воскресень|январ|феврал|март|апрел|мая|июн|июл|август|сентябр|октябр|ноябр|декабр|утр[аом]|вечер|ночь|ночи|днём|днем|через|кажд|ежедн|еженед|неделе|недели|месяц|завтра|сегодня|послезавтра|полдень|полночь|числ|час[аов]?(?![\p{L}])/iu;

/**
 * The model sometimes says "replace"/"clear" for "добавь в заметку …" — only the user's own words
 * may wipe a note. Applied to model answers in the app and on the server.
 */
export function guardNoteMode<T extends { intent: string; noteMode?: string }>(a: T, text: string): T {
  if (a.intent !== 'note') return a;
  if (a.noteMode === 'replace' && !/замени|перепиши|поменяй|измени|исправь/iu.test(text)) return { ...a, noteMode: 'append' };
  if (a.noteMode === 'clear' && !/очисти|удали|убери|сотри|стери/iu.test(text)) return { ...a, noteMode: 'append' };
  return a;
}

/**
 * Is the offline analysis trustworthy enough to act on without the model?
 * Used by the app and the server: confident phrases are handled instantly and for free;
 * the rest (several requests at once, leftovers the rules didn't understand) go to the model.
 */
export function isConfident(a: Analysis, text: string): boolean {
  if (/[;\n]/.test(text)) return false;
  // "… и напомни …", "… а ещё купи …" — several requests in one sentence.
  if (splitRequests(text).length > 1) return false;
  switch (a.intent) {
    case 'help':
    case 'undo':
    case 'smalltalk':
    case 'agenda':
      return true;
    case 'move':
      return Boolean(a.title || a.targetKind) && !LEFTOVER.test(a.title);
    case 'note':
      // Without a separator the target and the text are mixed — the model splits them better.
      return Boolean(a.title) && (a.noteMode === 'read' || a.noteMode === 'clear' || Boolean(a.note)) && a.title.split(/\s+/).length <= 5;
    case 'remind':
      return Boolean(a.title || a.remindCancel) && !/\d{3,}/.test(a.title);
    case 'delete':
    case 'complete':
      return Boolean(a.title || a.bulk || a.targetKind) && !/\d{3,}/.test(a.title);
    case 'create': {
      if (!a.title || a.title.split(/\s+/).length > 6) return false;
      // Date / time words left in the title mean the rules missed something.
      return !LEFTOVER.test(a.title);
    }
  }
}

/**
 * Splits a message into separate requests: ";", new lines, sentences, and
 * "… и напомни …", "… а ещё купи …", "… потом перенеси …".
 */
const REMIND_ONLY_RE =
  /^(?:и\s+|а\s+)?(?:напомни(?:те)?|(?:поставь|поставить|сделай|добавь|включи)\s+напоминани\p{L}*)(?:\s+мне)?(?:\s+пожалуйста)?((?:\s+(?:за\s+\S+(?:\s+(?:минут\p{L}*|мин|час\p{L}*|ч|дн\p{L}*|день|сут\p{L}*|недел\p{L}*))?|заранее|вовремя|в\s+\d{1,2}(?:[:.]\d{2})?(?:\s+(?:утра|дня|вечера|ночи))?|утром|днём|днем|вечером|ночью|через\s+\S+(?:\s+(?:минут\p{L}*|час\p{L}*))?))*)\s*$/iu;
const BARE_COMMAND_RE = /^(?:(?:создай|добавь|поставь|запиши|сделай|заведи)\s+(?:новую\s+)?(?:задачу|событие|напоминание|встречу)|напомни(?:те)?(?:\s+мне)?)$/iu;

export function splitRequests(text: string): string[] {
  // Dictation punctuation ("… и напомни в 18.") must not hide a reminder-only tail.
  const parts = rawSplit(text).map((p) => p.replace(/[\s.!?,…]+$/u, '').trim()).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    // "… и напомни в 18", "… и поставь напоминание за 15 минут" — the reminder of the previous request
    const rem = p.match(REMIND_ONLY_RE);
    if (rem && out.length) {
      out[out.length - 1] += ` с напоминанием${rem[1]}`;
      continue;
    }
    // "создай задачу и напомни купить хлеб", "напомни и создай задачу …" — one request
    if (BARE_COMMAND_RE.test(p.trim()) && i + 1 < parts.length) {
      parts[i + 1] = `${p} ${parts[i + 1]}`;
      continue;
    }
    out.push(p);
  }
  return out;
}

function rawSplit(text: string): string[] {
  return text
    .split(/\n+|;\s*|\.\s+(?=[А-ЯЁA-Z])|,?\s+(?:и|а\s+также|а\s+ещё|а\s+еще|потом|ещё|еще)\s+(?=(?:напомни|купи|добавь|поставь|запиши|удали|перенеси|создай|сделай|отметь|запланируй)(?![\p{L}]))|(?<=^\s*(?:напомни(?:те)?(?:\s+мне)?))\s+и\s+(?=(?:создай|добавь|поставь|запиши|сделай)(?![\p{L}]))/iu)
    .map((s) => s.trim())
    .filter(Boolean);
}
