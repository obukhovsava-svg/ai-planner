import { analyze, splitRequests, isConfident } from '../../src/lib/parser';
const phrases = [
  'создай встречу завтра в 15:00 с Иваном и задачу купить продукты',
  'завтра в 10 врач, в 19 тренировка',
  'встреча с клиентом в пятницу в 12 и задача подготовить презентацию к четвергу',
  'запланируй созвон в 14:00 и добавь задачу позвонить маме и купить хлеб',
  'купить хлеб и молоко',
  'обсудить проект и задачи команды завтра в 11',
  'встреча с Петей завтра в 18:30',
  'созвон в 16, задача отправить отчёт',
];
const d = new Date();
for (const p of phrases) {
  const parts = splitRequests(p);
  console.log('\n>>', p);
  for (const part of parts) { const a: any = analyze(part, d); console.log('  ·', JSON.stringify(part), '→', a.intent, a.kind ?? '', a.title ?? '', a.date ?? '', a.start ?? a.time ?? '', 'confident:', isConfident(a, part)); }
}
