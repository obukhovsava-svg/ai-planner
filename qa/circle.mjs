// Telegram wallpaper sync: today goes right away, days ahead later, unchanged days are skipped.
import puppeteer from 'puppeteer-core';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
const dist = new URL('../dist/', import.meta.url).pathname;
const srv = createServer((q, r) => {
  let p = join(dist, decodeURIComponent(q.url.split('?')[0]));
  if (!existsSync(p) || p.endsWith('/')) p = join(dist, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[extname(p)] ?? 'application/octet-stream' });
  r.end(readFileSync(p));
}).listen(5199);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 780, deviceScaleFactor: 2 });
const log = [];
await page.setRequestInterception(true);
page.on('request', (q) => {
  const u = q.url();
  if (u.includes('telegram-web-app.js')) return q.respond({ status: 200, contentType: 'text/javascript', body: `window.Telegram={WebApp:{initData:'user=%7B%22id%22%3A1%7D&hash=x',initDataUnsafe:{},version:'8.0',platform:'ios',colorScheme:'dark',isExpanded:true,ready(){},expand(){},isVersionAtLeast(){return true},setHeaderColor(){},setBackgroundColor(){},onEvent(){},offEvent(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}},HapticFeedback:{impactOccurred(){},notificationOccurred(){},selectionChanged(){}}}}` });
  if (u.startsWith('https://ai-planner-brain') || u.startsWith('https://plan-relay')) {
    const url = new URL(u);
    if (q.method() === 'OPTIONS') return q.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    if (url.pathname === '/analyze') return q.respond({ status: 500, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' });
    if (url.pathname === '/wallpaper/pending') log.push({ t: Date.now(), day: 'PENDING' });
    if (url.pathname === '/wallpaper') log.push({ t: Date.now(), day: url.searchParams.get('day'), today: url.searchParams.get('today'), kb: Math.round((q.postData()?.length ?? 0) / 1024) });
    return q.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: url.pathname === '/sync' || url.pathname === '/state' ? '{}' : '{"ok":true,"items":[]}' });
  }
  q.continue();
});
const k = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => k(new Date(Date.now() + n * 86400000));
const now = Date.now();
const ev = (id, title, d, start, end, color, extra = {}) => ({ id, title, date: day(d), start, end, color, createdAt: now - 9e5, remind: 60, ...extra });
const tk = (id, title, extra = {}) => ({ id, title, done: false, priority: 'medium', category: 'personal', createdAt: now - 9e5, ...extra });
const data = { state: {
  events: [ev('a', 'Планёрка', 0, '09:30', '10:00', 'blue'), ev('b', 'Созвон с командой', 0, '15:00', '16:00', 'violet'), ev('c', 'Тренировка', 0, '19:00', '20:00', 'green'),
    ev('d', 'Врач', 1, '10:00', '11:00', 'red'), ev('e', 'Ужин с родителями', 2, '19:30', '21:00', 'amber'), ev('f', 'Йога', 3, '08:00', '09:00', 'green')],
  tasks: [tk('1', 'Сдать отчёт', { date: day(0), priority: 'high', category: 'work' }), tk('2', 'Оплатить интернет', { date: day(0), time: '18:00' }), tk('3', 'Купить продукты'),
    tk('4', 'Записаться к стоматологу', { category: 'health' }), tk('5', 'Позвонить маме', { date: day(0), done: true, completedAt: now - 3e5 }), tk('6', 'Подготовить презентацию', { date: day(3), category: 'work' })],
  deleted: {} }, version: 2 };
const chat = { state: { messages: [] }, version: 0 };
await page.evaluateOnNewDocument((data) => {
  localStorage.setItem('planner:data', JSON.stringify(data));
  localStorage.setItem('planner:ui', JSON.stringify({ state: { accent: 'mist', themeOverride: 'light', digestPrompted: true, tab: 'calendar', dayOpen: false }, version: 0 }));
  localStorage.setItem('planner:next-step', '1');
}, data);
await page.goto('http://localhost:5199/');
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => { document.documentElement.dataset.tint = ''; });
const rect = await page.evaluate(() => { const b = [...document.querySelectorAll('button[aria-label]')].find((x) => x.querySelector('.bg-today')); const r = b.querySelector('.bg-today').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
console.log(JSON.stringify(rect));
await page.screenshot({ path: 'shots/circle-crop.png', clip: { x: rect.x - 4, y: rect.y - 4, width: rect.w + 8, height: rect.h + 8 } });
await browser.close(); srv.close();
