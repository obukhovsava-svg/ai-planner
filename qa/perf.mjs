// Smoothness test: frame times during key interactions, CPU throttled ×4 (≈ a phone).
import puppeteer from 'puppeteer-core';
const now = Date.now(); const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tod = key(new Date()), tmr = key(new Date(now + 86400000)), yest = key(new Date(now - 86400000));
const tk = (i, extra = {}) => ({ id: 't' + i, title: ['Купить продукты', 'Оплатить интернет', 'Позвонить маме', 'Отправить отчёт', 'Записаться к врачу', 'Забрать посылку', 'Подготовить презентацию', 'Тренировка'][i % 8] + (i > 7 ? ' ' + i : ''), done: false, priority: 'medium', category: 'personal', createdAt: now - i, updatedAt: now, date: i % 3 ? tod : tmr, ...extra });
const tasks = Array.from({ length: 24 }, (_, i) => tk(i));
const events = Array.from({ length: 30 }, (_, i) => ({ id: 'e' + i, title: 'Событие ' + i, date: key(new Date(now + (i - 10) * 86400000)), start: '1' + (i % 9) + ':00', end: '1' + (i % 9) + ':45', color: ['blue', 'red', 'violet', 'green', 'amber'][i % 5], createdAt: now, updatedAt: now }));
const seed = {
  'planner:data': JSON.stringify({ state: { tasks, events, deleted: {} }, version: 2 }),
  'planner:ui': JSON.stringify({ state: { themeOverride: 'dark', hideDoneNextDay: true, digestPrompted: true }, version: 0 }),
};
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await page.evaluateOnNewDocument(() => { delete window.webkitSpeechRecognition; delete window.SpeechRecognition; });
await page.evaluateOnNewDocument((seed) => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, seed);
await page.goto('file://' + process.cwd().replace('/qa', '') + '/ios/Planner/Web/index.html', { waitUntil: 'load' });
const cdp = await page.createCDPSession();
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU || 4) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1500);
const tab = (l) => page.evaluate((l) => [...document.querySelectorAll('button')].find((x) => x.innerText.trim().endsWith(l))?.click(), l);

async function measure(name, action, ms = 1200) {
  await page.evaluate(() => {
    window.__f = []; let last = performance.now();
    const loop = (t) => { window.__f.push(t - last); last = t; if (window.__on) requestAnimationFrame(loop); };
    window.__on = true; requestAnimationFrame(loop);
  });
  await action();
  await wait(ms);
  const f = await page.evaluate(() => { window.__on = false; return window.__f.slice(1); });
  const total = f.reduce((a, b) => a + b, 0);
  const janky = f.filter((x) => x > 25).length;
  const worst = Math.max(...f);
  console.log(`${name.padEnd(34)} fps ${(1000 * f.length / total).toFixed(0).padStart(3)}  janky>25ms ${String(janky).padStart(3)}/${f.length}  worst ${worst.toFixed(0)}ms`);
}

await measure('tab → Ассистент', () => tab('Ассистент'));
await measure('keyboard up (focus input)', () => page.focus('input[placeholder^="Или"]'));
await measure('keyboard down (blur)', () => page.evaluate(() => document.activeElement.blur()));
await measure('mic: start listening', () => page.evaluate(() => document.querySelector('[aria-label="Начать голосовой ввод"]')?.click()), 1500);
await wait(4000);
await measure('tab → Задачи', () => tab('Задачи'));
await measure('task done → glide down', () => page.evaluate(() => document.querySelector('[data-flip-id] [role=checkbox]')?.click()), 1500);
await measure('scroll tasks', () => page.evaluate(() => { const s = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 50 && getComputedStyle(d).overflowY === 'auto'); s?.scrollBy({ top: 600, behavior: 'smooth' }); }));
await measure('open task sheet', () => page.evaluate(() => document.querySelector('[data-flip-id] button.text-left')?.click()));
await measure('close task sheet', () => page.evaluate(() => document.querySelector('[role=dialog] .bg-black\\/35')?.click()));
await measure('tab → План (month)', () => tab('План'));
await measure('scroll month', () => page.evaluate(() => { const s = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 200 && getComputedStyle(d).overflowY === 'auto'); s?.scrollBy({ top: 900, behavior: 'smooth' }); }));
await measure('open day', () => page.evaluate((d) => window.__plannerOpen('d:' + d), tod));
await browser.close();
