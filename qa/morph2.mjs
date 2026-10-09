// Simulates the keyboard: the viewport shrinks right after focus (like iOS), then grows back on blur.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
const vp = (h) => page.setViewport({ width: 390, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await page.evaluateOnNewDocument((t) => localStorage.setItem('planner:ui', JSON.stringify({ state: { themeOverride: t, hideDoneNextDay: true, digestPrompted: true }, version: 0 })), process.env.THEME || 'dark');
await page.goto('file://' + process.cwd().replace('/qa', '') + '/ios/Planner/Web/index.html', { waitUntil: 'load' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1500);
await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.innerText.trim().endsWith('Ассистент'))?.click());
await wait(900);
const shots = [];
const snap = async (n) => { await page.screenshot({ path: `shots/m2-${n}.png` }); shots.push(n); };
await page.focus('input[placeholder^="Или"]');
await wait(60); await vp(510); // keyboard 334 px
for (const t of [120, 260, 420, 700]) { await wait(t - (shots.length ? 0 : 60)); await snap('out' + t); }
await wait(900); await snap('typing');
await page.evaluate(() => document.activeElement.blur());
await wait(40); await vp(844);
for (const t of [120, 300, 500, 900]) { await wait(t > 120 ? 160 : 120); await snap('in' + t); }
await browser.close();
console.log(shots.join(' '));
