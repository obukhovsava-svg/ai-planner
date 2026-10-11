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
await page.setViewport({ width: 402, height: 874, deviceScaleFactor: 3 });
const log = [];
await page.setRequestInterception(true);
page.on('request', (q) => {
  const u = q.url();
  if (u.includes('telegram-web-app.js')) return q.respond({ status: 200, contentType: 'text/javascript', body: `window.Telegram={WebApp:{initData:'user=%7B%22id%22%3A1%7D&hash=x',initDataUnsafe:{},version:'8.0',platform:'ios',colorScheme:'dark',isExpanded:true,ready(){},expand(){},isVersionAtLeast(){return true},setHeaderColor(){},setBackgroundColor(){},onEvent(){},offEvent(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}},HapticFeedback:{impactOccurred(){},notificationOccurred(){},selectionChanged(){}}}}` });
  if (u.startsWith('https://ai-planner-brain') || u.startsWith('https://plan-relay')) {
    const url = new URL(u);
    if (q.method() === 'OPTIONS') return q.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    if (url.pathname === '/wallpaper') log.push({ t: Date.now(), day: url.searchParams.get('day'), today: url.searchParams.get('today'), kb: Math.round((q.postData()?.length ?? 0) / 1024) });
    return q.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: url.pathname === '/sync' || url.pathname === '/state' ? '{}' : '{"ok":true,"items":[]}' });
  }
  q.continue();
});
await page.evaluateOnNewDocument(() => localStorage.setItem('planner:wallpaper-on', '1'));
const t0 = Date.now();
await page.goto('http://localhost:5199/');
await new Promise((r) => setTimeout(r, 8000));
const first = log.splice(0).map((x) => ({ ...x, t: x.t - t0 }));
console.log('on open:', JSON.stringify(first));
// nothing changed → reopening sends nothing
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await new Promise((r) => setTimeout(r, 7000));
console.log('no change:', JSON.stringify(log.splice(0)));
// a change while away (new task in storage) → reload: today first, the rest a few seconds later
await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('planner:data') ?? 'null') ?? { state: { tasks: [], events: [], deleted: {} }, version: 2 };
  const k = new Date(), day = `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, '0')}-${String(k.getDate()).padStart(2, '0')}`;
  d.state.tasks.push({ id: 'qa1', title: 'QA задача', done: false, priority: 'medium', category: 'personal', createdAt: Date.now(), date: day });
  localStorage.setItem('planner:data', JSON.stringify(d));
});
const t1 = Date.now();
await page.reload();
await new Promise((r) => setTimeout(r, 9000));
console.log('after change:', JSON.stringify(log.splice(0).map((x) => ({ ...x, t: x.t - t1 }))));
console.log('sent map:', await page.evaluate(() => localStorage.getItem('planner:wallpaper-sent')));
// leaving the app flushes right away
await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('planner:data'));
  return d.state.tasks.length;
});
await browser.close();
srv.close();
