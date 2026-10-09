import puppeteer from 'puppeteer-core';
const now = Date.now(); const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tod = key(new Date()), tmr = key(new Date(now + 86400000));
const tk = (id, title, extra = {}) => ({ id, title, done: false, priority: 'medium', category: 'personal', createdAt: now, updatedAt: now, ...extra });
const ev = (id, title, date, start, end, color, extra = {}) => ({ id, title, date, start, end, color, createdAt: now, updatedAt: now, ...extra });
const seed = {
  'planner:data': JSON.stringify({ state: { tasks: [tk('t1', 'Купить продукты', { date: tod }), tk('t2', 'Оплатить интернет', { date: tod, time: '18:00', remind: { offset: 0 } })],
    events: [ev('e1', 'Созвон с командой', tod, '15:00', '16:00', 'blue', { remind: { offset: 60 } }), ev('e2', 'Тренировка', tod, '19:00', '20:30', 'red', { repeat: { freq: 'week', interval: 1 } }), ev('e3', 'Очень длинное название события, которое не помещается', tmr, '10:00', '10:30', 'violet')], deleted: {} }, version: 2 }),
  'planner:ui': JSON.stringify({ state: { themeOverride: process.env.THEME || 'light', hideDoneNextDay: true, digestPrompted: true }, version: 0 }),
};
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await page.evaluateOnNewDocument((seed) => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, seed);
await page.goto('file://' + process.cwd().replace('/qa', '') + '/ios/Planner/Web/index.html', { waitUntil: 'load' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const T = process.env.THEME || 'light';
const shot = (n) => page.screenshot({ path: `shots/${T}-2-${n}.png` });
const clickText = (sel, re) => page.evaluate((sel, re) => { const el = [...document.querySelectorAll(sel)].find((x) => new RegExp(re).test(x.innerText)); el?.click(); return Boolean(el); }, sel, re);
await wait(1200); await shot('a-month');
await page.evaluate((d) => window.__plannerOpen('d:' + d), tod); await wait(900); await shot('b-day');
await clickText('button, [role=button], div', '^Созвон с командой'); await wait(800); await shot('c-event');
await page.keyboard.press('Escape'); await wait(600);
await clickText('button', 'Тренировка'); await wait(800); await shot('d-event-repeat');
await clickText('[role=dialog] button', 'Удалить событие'); await wait(500); await shot('e-delete-repeat');
await clickText('[role=dialog] button', '^Отмена$'); await wait(300); await page.keyboard.press('Escape'); await wait(600);
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.querySelector('svg.lucide-settings, svg.lucide-cog, svg.lucide-settings-2'))?.click()); await wait(800); await shot('f-settings');
await page.keyboard.press('Escape'); await wait(600);
await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.innerText.trim().endsWith('Задачи'))?.click()); await wait(700);
await page.focus('input[placeholder^="Новая"]'); await page.keyboard.type('Позвонить маме завтра в 10', { delay: 5 }); await wait(400); await shot('g-quickadd');
await page.keyboard.press('Enter'); await wait(1200); await shot('h-after-add');
await page.evaluate(() => [...document.querySelectorAll('[data-flip-id] button.text-left')].find((b) => b.innerText.includes('Купить'))?.click()); await wait(700);
await clickText('[role=dialog] button', 'Дата'); await wait(700); await shot('i-datepicker');
console.log('errors:', errors.length ? errors.join(' || ') : 'none');
const ov = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && !e.closest('.no-scrollbar'); }).length);
console.log('overflow elements:', ov);
await browser.close();
