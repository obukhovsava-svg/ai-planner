// End-to-end checks of the planner UI in a phone-sized Chrome (the same bundle the iOS app ships).
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
mkdirSync('shots', { recursive: true });
const today = new Date(); const key = (d) => d.toISOString().slice(0, 10);
const yest = key(new Date(Date.now() - 86400000)), tmr = key(new Date(Date.now() + 86400000)), tod = key(today);
const now = Date.now();
const tk = (id, title, extra = {}) => ({ id, title, done: false, priority: 'medium', category: 'personal', createdAt: now, updatedAt: now, ...extra });
const seed = {
  'planner:data': JSON.stringify({ state: { tasks: [
    tk('t1', 'Просроченная задача', { date: yest }),
    tk('t2', 'Задача на сегодня', { date: tod }),
    tk('t3', 'Задача на завтра', { date: tmr, time: '18:00' }),
    tk('t4', 'Без даты'),
    tk('t5', 'Длинное название задачи которое должно аккуратно обрезаться и не ломать вёрстку строки', { date: tod }),
  ], events: [{ id: 'e1', title: 'Созвон', date: tod, start: '15:00', end: '16:00', color: 'blue', createdAt: now, updatedAt: now }], deleted: {} }, version: 2 }),
  'planner:ui': JSON.stringify({ state: { themeOverride: process.env.THEME || 'light', hideDoneNextDay: true, digestPrompted: true }, version: 0 }),
};
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars=false'] });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
// no Web Speech in headless Chrome → the app's demo recording, so the listening state can be seen
await page.evaluateOnNewDocument(() => { delete window.webkitSpeechRecognition; delete window.SpeechRecognition; });
await page.evaluateOnNewDocument((seed) => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, seed);
await page.goto('file://' + process.cwd().replace('/qa', '') + '/ios/Planner/Web/index.html', { waitUntil: 'load' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (n) => page.screenshot({ path: `shots/${process.env.THEME || 'light'}-${n}.png` });
const tab = (label) => page.evaluate((l) => [...document.querySelectorAll('button')].find((x) => x.innerText.trim().endsWith(l))?.click(), label);
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('planner:data')).state);
const report = [];
const ok = (name, cond, extra = '') => report.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
const overflowX = () => page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1) && getComputedStyle(e).position !== 'fixed' && !e.closest('.no-scrollbar, [class*="overflow-x"]'); }).slice(0, 5).map((e) => e.tagName + '.' + (e.className?.baseVal ?? e.className).toString().slice(0, 60)));
await wait(1200);

// ---- Tasks
await tab('Задачи'); await wait(600); await shot('tasks');
ok('tasks: no horizontal overflow', (await overflowX()).length === 0, JSON.stringify(await overflowX()));
// edit + autosave by tapping the backdrop
await page.evaluate(() => [...document.querySelectorAll('[data-flip-id]')].find((r) => r.innerText.includes('Без даты'))?.querySelector('button.text-left')?.click());
await wait(700); await shot('task-sheet');
const hasSave = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].some((b) => /Сохранить/.test(b.innerText)));
ok('task sheet: no «Сохранить» button', !hasSave);
await page.evaluate(() => { const i = document.querySelector('[role=dialog] input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Без даты — изменено'); i.dispatchEvent(new Event('input', { bubbles: true })); });
await page.evaluate(() => document.querySelector('[role=dialog] .bg-black\\/35')?.click());
await wait(800);
ok('task sheet: autosaves on close', (await state()).tasks.some((t) => t.title === 'Без даты — изменено'));
// complete an ordinary task → stays, moves down
await page.evaluate(() => [...document.querySelectorAll('[data-flip-id]')].find((r) => r.innerText.includes('Задача на сегодня'))?.querySelector('[role=checkbox]')?.click());
await wait(1500); await shot('tasks-after-done');
const order = await page.evaluate(() => [...document.querySelectorAll('[data-flip-id]')].map((r) => r.innerText.split('\n')[0]));
ok('done task sinks to the bottom', /Задача на сегодня/.test(order.at(-1) ?? ''), order.join(' | '));
// complete the overdue one → removed with undo toast
await page.evaluate(() => [...document.querySelectorAll('[data-flip-id]')].find((r) => r.innerText.includes('Просроченная'))?.querySelector('[role=checkbox]')?.click());
await wait(700); await shot('overdue-gliding');
await wait(1300); await shot('overdue-removed');
const st = await state();
ok('overdue done task removed', !st.tasks.some((t) => t.id === 't1'));
const toast = await page.evaluate(() => document.body.innerText.includes('Просроченная задача выполнена'));
ok('undo toast shown', toast);

// ---- Events: new without a title → nothing; with a title → created; end before start → +1h
await tab('План'); await wait(800);
const plus = () => page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.querySelector('svg.lucide-plus'))?.click());
const before = (await state()).events.length;
await plus(); await wait(700); await shot('event-new');
ok('event sheet: «Готово» instead of ✕', await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].some((b) => b.innerText.trim() === 'Готово')));
await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => b.innerText.trim() === 'Готово')?.click()); await wait(700);
ok('new event without a title is not created', (await state()).events.length === before);
await plus(); await wait(700);
await page.evaluate(() => {
  const d = document.querySelector('[role=dialog]');
  const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  set(d.querySelector('input:not([type])') ?? d.querySelector('input'), 'Тест автосохранения');
  const times = d.querySelectorAll('input[type=time]'); set(times[0], '14:00'); set(times[1], '13:00');
});
await wait(300); await shot('event-end-before-start');
await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => b.innerText.trim() === 'Готово')?.click()); await wait(800);
const ev = (await state()).events.find((e) => e.title === 'Тест автосохранения');
ok('new event saved on close', Boolean(ev));
ok('end before start → start + 1 h', ev?.start === '14:00' && ev?.end === '15:00', JSON.stringify(ev && { start: ev.start, end: ev.end }));
ok('plan: no horizontal overflow', (await overflowX()).length === 0, JSON.stringify(await overflowX()));

// ---- Assistant: the record button
await tab('Ассистент'); await wait(900); await shot('assistant-idle');
const orb = await page.evaluate(() => { const b = document.querySelector('[aria-label="Начать голосовой ввод"]'); if (!b) return null; const cs = getComputedStyle(b); return { bg: cs.backgroundColor, color: cs.color, w: b.offsetWidth }; });
ok('record button: solid one colour, glyph in background colour', Boolean(orb), JSON.stringify(orb));
await page.evaluate(() => document.querySelector('[aria-label="Начать голосовой ввод"]')?.click());
await wait(120); await shot('assistant-listen-start');
await wait(700); await shot('assistant-listening');
await wait(500); await shot('assistant-listening2');
await wait(2600); await shot('assistant-after');
// keyboard up → the button steps aside (shrinks + fades), then comes back
await page.focus('input[placeholder^="Или"]'); await wait(150); await shot('assistant-typing-mid');
await wait(600); await shot('assistant-typing');
await page.evaluate(() => document.activeElement.blur()); await wait(200); await shot('assistant-back-mid'); await wait(700); await shot('assistant-back');
ok('assistant: no horizontal overflow', (await overflowX()).length === 0, JSON.stringify(await overflowX()));

ok('no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));
console.log(report.join('\n'));
await browser.close();
