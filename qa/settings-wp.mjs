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
    return q.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: url.pathname === '/shortcut/token' ? JSON.stringify({ token: 'a'.repeat(32), url: 'https://plan-relay.containerapps.ru/shortcut?key=' + 'a'.repeat(32) }) : url.pathname === '/sync' || url.pathname === '/state' ? '{}' : '{"ok":true,"items":[]}' });
  }
  q.continue();
});
await page.goto('http://localhost:5199/');
await new Promise((r) => setTimeout(r, 2500));
const opened = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /настройк/i.test(x.getAttribute('aria-label') ?? '') || /настройк/i.test(x.title ?? ''));
  b?.click();
  return !!b;
});
await new Promise((r) => setTimeout(r, 1200));
// close the digest offer if it popped up
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Не нужно')?.click());
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'shots/settings-row.png' });
const row = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Добавить обои')); b?.click(); return !!b; });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: 'shots/wallpaper-sheet.png' });
console.log('row:', row, 'sheet buttons:', await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /Скопировать|Установить|Выбрать фото/.test(t))));
await browser.close();
srv.close();
