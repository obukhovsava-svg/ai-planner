// Frames of the open (melt) animation, sampled through the real rAF loop.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await page.evaluateOnNewDocument(() => localStorage.setItem('planner:ui', JSON.stringify({ state: { themeOverride: 'dark', hideDoneNextDay: true, digestPrompted: true }, version: 0 })));
await page.goto('file://' + process.cwd().replace('/qa', '') + '/ios/Planner/Web/index.html', { waitUntil: 'load' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1500);
await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.innerText.trim().endsWith('Ассистент'))?.click());
await wait(900);
await page.focus('input[placeholder^="Или"]');
const t0 = Date.now();
for (const t of [40, 120, 200, 290, 380, 470, 560, 700]) { const d = t - (Date.now() - t0); if (d > 0) await wait(d); await page.screenshot({ path: `shots/melt-${t}.png`, clip: { x: 0, y: 150, width: 390, height: 694 } }); }
await browser.close();
