import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await page.evaluateOnNewDocument((t) => localStorage.setItem('planner:ui', JSON.stringify({ state: { themeOverride: t, hideDoneNextDay: true, digestPrompted: true }, version: 0 })), process.env.THEME || 'dark');
await page.goto('file://' + process.cwd().replace('/qa', '') + '/ios/Planner/Web/index.html', { waitUntil: 'load' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1500);
await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.innerText.trim().endsWith('Ассистент'))?.click());
await wait(900);
// pause all animations at chosen times by sampling with the animation timeline
const snap = async (n) => page.screenshot({ path: `shots/morph-${n}.png`, clip: { x: 0, y: 0, width: 390, height: 600 } });
await page.focus('input[placeholder^="Или"]');
for (const [i, t] of [80, 200, 330, 500, 750, 1300].entries()) { await page.evaluate((t) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t; }), t); await snap('out' + i); }
await page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
await wait(1500);
await page.evaluate(() => document.activeElement.blur());
for (const [i, t] of [60, 180, 320, 450, 620].entries()) { await page.evaluate((t) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t; }), t); await snap('in' + i); }
await page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
await wait(900); await snap('in-end');
await browser.close();
