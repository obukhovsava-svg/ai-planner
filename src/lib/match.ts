/**
 * Fuzzy matching of what the user says against item titles, across Russian word forms:
 * "перенеси учёбу" ≈ «Учеба», "встречу с Анной" ≈ «Встреча с Анной», "подарка" ≈ «Подарок».
 * Shared by the app's assistant and the server (iPhone Shortcut).
 */

/** Words that say *what kind* of thing it is, not *which* one. */
const STOP_WORDS = new Set([
  'событие', 'события', 'событию', 'событием', 'задача', 'задачу', 'задачи', 'задаче', 'задачей', 'дело', 'дела',
  'мою', 'мой', 'моё', 'мое', 'мои', 'моих', 'мне', 'для', 'это', 'эту', 'этот', 'все', 'всё', 'всю', 'мероприятие',
]);

// Longest first: inflection endings of nouns / adjectives / verbs.
const ENDINGS = [
  'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'иях', 'ией', 'ией', 'ию', 'ия', 'ие', 'ии', 'ий', 'ой', 'ей',
  'ую', 'юю', 'ая', 'яя', 'ое', 'ее', 'ые', 'ых', 'их', 'ым', 'им', 'ом', 'ем', 'ам', 'ям', 'ах', 'ях', 'ов', 'ев', 'ь',
  'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'й',
];

/** "учёбу" → "учеб", "тренировки" → "тренировк", "подарка" → "подарк". */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/ё/g, 'е');
  w = IRREGULAR[w] ?? w;
  if (w.length <= 3 || /\d/.test(w)) return w;
  for (const end of ENDINGS) {
    if (w.endsWith(end) && w.length - end.length >= 3) return w.slice(0, -end.length);
  }
  return w;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^\p{L}\d]+/u)
    .filter((w) => w && (w.length >= 3 || /\d/.test(w)) && !STOP_WORDS.has(w));
}

const TAILS = new Set(['', 'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь', 'й', 'ов', 'ев', 'ий', 'ой', 'ей', 'ом', 'ем', 'ам', 'ах', 'к', 'ок', 'ек', 'ик', 'н', 'н']);
/** Fleeting vowels the stemmer can't see: "сон"/"сна", "день"/"дня", "лев"/"льва". */
const IRREGULAR: Record<string, string> = { сна: 'сон', сну: 'сон', сном: 'сон', дня: 'день', дню: 'день', днем: 'день', дне: 'день', дни: 'день', дней: 'день' };

/** Same word in different forms? Also fleeting vowels: "подарок"/"подарк", "отчет"/"отчета". */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  // the longer one only has a leftover ending / suffix ("учеб"/"учеба", "подарк"/"подарок")
  if (s.length >= 3 && l.startsWith(s) && TAILS.has(l.slice(s.length))) return true;
  let p = 0;
  while (p < s.length && s[p] === l[p]) p++;
  return p >= 4 && p >= s.length - 1;
}

/** Share of the query's words found in the title (0…1). */
export function matchScore(query: string, title: string): number {
  const q = words(query).map(stem);
  if (!q.length) return 0;
  const t = words(title).map(stem);
  return q.filter((s) => t.some((w) => sameWord(s, w))).length / q.length;
}
