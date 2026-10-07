// Real app screens with demo data (the bundled iOS web build), for the "how it worked" montage.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
mkdirSync('app', { recursive: true });
const today = '2026-10-08', tmr = '2026-10-09';
const now = Date.now();
const ev = (id, title, date, start, end, color, remind) => ({ id, title, date, start, end, color, createdAt: now, updatedAt: now, ...(remind != null ? { remind: { offset: remind } } : {}) });
const tk = (id, title, extra = {}) => ({ id, title, done: false, priority: 'medium', category: 'personal', createdAt: now, updatedAt: now, ...extra });
const events = [
  ev('e1', 'Созвон', tmr, '15:00', '16:00', 'blue', 60),
  ev('e2', 'Учёба', tmr, '10:00', '12:30', 'amber'),
  ev('e3', 'Тренировка', tmr, '19:00', '20:00', 'red', 30),
  ev('e4', 'Встреча с другом', today, '18:30', '20:00', 'violet'),
  ev('e5', 'Работа над проектом', today, '11:00', '14:00', 'blue'),
];
const tasks = [
  tk('t1', 'Купить продукты', { date: tmr, category: 'personal' }),
  tk('t2', 'Оплатить интернет', { date: tmr, time: '18:00', category: 'personal', remind: { offset: 0 } }),
  tk('t3', 'Отправить отчёт', { date: today, category: 'work', priority: 'high' }),
  tk('t4', 'Записаться к стоматологу', { category: 'health' }),
  tk('t5', 'Позвонить маме', { date: today, done: true, completedAt: now }),
];
const created = events[0];
const messages = [
  { id: 'm1', role: 'user', text: 'Созвон завтра с трёх до четырёх, напомни за час', createdAt: now - 60000 },
  { id: 'm2', role: 'assistant', text: 'Записал созвон на завтра, 15:00–16:00. Напомню за час.', attachment: { type: 'event', event: created }, createdAt: now - 58000 },
  { id: 'm3', role: 'user', text: 'Купить продукты завтра', createdAt: now - 30000 },
  { id: 'm4', role: 'assistant', text: 'Добавил задачу на завтра.', attachment: { type: 'task', task: tasks[0] }, createdAt: now - 28000 },
];
const seed = {
  'planner:data': JSON.stringify({ state: { tasks, events, deleted: {} }, version: 2 }),
  'planner:chat': JSON.stringify({ state: { messages, undo: [] }, version: 2 }),
  'planner:ui': JSON.stringify({ state: { themeOverride: 'dark', hideDoneNextDay: true, digestPrompted: true }, version: 0 }),
};
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
const page = await browser.newPage();
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await page.evaluateOnNewDocument((seed, fakeNow) => {
  for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  // freeze "today" at 8 Oct, 14:20
  const RealDate = Date; const off = fakeNow - RealDate.now();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [RealDate.now() + off])); } static now() { return RealDate.now() + off; } };
}, seed, new Date('2026-10-08T14:20:00').getTime());
const url = 'file://' + process.cwd().replace('/marketing/voice-reel', '') + '/ios/Planner/Web/index.html';
await page.goto(url, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1200));
const shot = async (name) => { await new Promise((r) => setTimeout(r, 900)); await page.screenshot({ path: `app/${name}.png` }); };
await shot('0-start');
await page.evaluate((d) => window.__plannerOpen && window.__plannerOpen('d:' + d), tmr); await shot('1-day');
await page.evaluate(() => { const el = [...document.querySelectorAll('button,div')].find((x) => x.children.length < 4 && /^Созвон/.test(x.innerText || '') && x.getBoundingClientRect().height > 30); el && el.click(); });
await shot('2-event');
await page.keyboard.press('Escape');
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Готово|Закрыть|Отмена/.test(x.innerText)); b && b.click(); });
await new Promise((r) => setTimeout(r, 700));
const tabs = async (label) => page.evaluate((label) => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim().endsWith(label)); b && b.click(); }, label);
await tabs('Задачи'); await shot('3-tasks');
await tabs('Ассистент'); await shot('4a-assistant');
await page.evaluate(() => { const el = document.querySelector('input[placeholder^="Или"], textarea'); el && el.focus(); });
await page.keyboard.type('Тренировка в субботу с 10 до 11 утра', { delay: 10 });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 3500));
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await shot('4-assistant');
await tabs('План'); await shot('5-plan');
await browser.close();
console.log('ok');
