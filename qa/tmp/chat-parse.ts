import { analyze, splitRequests, isConfident } from '../../src/lib/parser';
import { execute } from '../../worker/src/exec';
for (const text of ['в 15 созвон', 'в 8 утра пробежка', 'встреча с Аней в пятницу', 'купить хлеб', 'тренировка по вторникам и четвергам в 19:00']) {
  const parts = splitRequests(text);
  const as = parts.map((p) => analyze(p, new Date()));
  const conf = as.map((a, i) => isConfident(a, parts[i]));
  const doc = { tasks: [], events: [], deleted: {} } as any;
  const res = execute(doc, as as any, { today: '2026-10-14', now: Date.now(), nowMinutes: 600, newId: () => Math.random().toString(36).slice(2) });
  console.log(JSON.stringify(text), '| parts', parts, '| conf', conf, '| lines', res.lines, '| unresolved', res.unresolved.map((u: any) => ({ intent: u.intent, title: u.title, start: u.start, end: u.end, needsStart: u.needsStart, eventHint: u.eventHint, taskHint: u.taskHint })));
}
