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
    if (url.pathname === '/wallpaper/pending') log.push({ t: Date.now(), day: 'PENDING' });
    if (url.pathname === '/wallpaper') log.push({ t: Date.now(), day: url.searchParams.get('day'), today: url.searchParams.get('today'), kb: Math.round((q.postData()?.length ?? 0) / 1024) });
    return q.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: url.pathname === '/sync' || url.pathname === '/state' ? '{}' : '{"ok":true,"items":[]}' });
  }
  q.continue();
});
const shots = [];
for (const [accent, theme] of [['lime', 'light'], ['lime', 'dark']]) {
  await page.evaluateOnNewDocument((accent, theme) => {
    localStorage.setItem('planner:ui', JSON.stringify({ state: { accent, themeOverride: theme, digestPrompted: true, tab: 'tasks' }, version: 0 }));
    localStorage.setItem('planner:next-step', '1');
  }, accent, theme);
  await page.goto('http://localhost:5199/');
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: `shots/accent-${accent}-${theme}-tasks.png` });
  await page.evaluate(() => document.querySelector('[aria-label="Настройки"]')?.click());
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(() => document.querySelector('[aria-label="Синий"]')?.scrollIntoView({ block: 'center' }));
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: `shots/accent-${accent}-${theme}-settings.png` });
  shots.push(accent);
}
console.log(shots.join(' '));
await browser.close();
srv.close();
