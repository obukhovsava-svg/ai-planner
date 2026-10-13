import { analyze, splitRequests } from '../../src/lib/parser';
for (const p of ['создай встречу завтра в 15:00 с Иваном и задачу купить продукты', 'встреча с клиентом в пятницу в 12 и задача подготовить презентацию к четвергу', 'завтра в 10 врач, в 19 тренировка']) {
  for (const part of splitRequests(p)) { const a: any = analyze(part, new Date()); console.log(JSON.stringify(part), '→', JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length))))); }
}
