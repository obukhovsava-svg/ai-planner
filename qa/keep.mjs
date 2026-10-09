import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await page.goto('file://' + process.cwd().replace('/qa', '') + '/ios/Planner/Web/index.html', { waitUntil: 'load' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = (l) => page.evaluate((l) => [...document.querySelectorAll('button')].find((x) => x.innerText.trim().endsWith(l))?.click(), l);
const scroller = () => page.evaluate(() => { const s = [...document.querySelectorAll('main[aria-hidden="false"] div')].find((d) => d.scrollHeight > d.clientHeight + 200 && getComputedStyle(d).overflowY === 'auto'); return s ? (s.dataset.k = 'x', s.scrollTop) : -1; });
await wait(1600);
const top0 = await scroller();
await page.evaluate(() => { const s = document.querySelector('[data-k="x"]'); s.scrollTop += 700; });
await wait(300);
const top1 = await page.evaluate(() => document.querySelector('[data-k="x"]').scrollTop);
await tab('Задачи'); await wait(700); await tab('Ассистент'); await wait(700); await tab('План'); await wait(700);
const top2 = await page.evaluate(() => document.querySelector('[data-k="x"]')?.scrollTop);
console.log(top1 === top2 ? 'PASS' : 'FAIL', ' calendar scroll kept across tabs', top0, top1, top2);
// typing in Tasks quick-add must not trigger the assistant's glow (other tab)
await tab('Задачи'); await wait(600);
await page.focus('main[aria-hidden="false"] input[placeholder^="Новая"]'); await wait(700);
const glow = await page.evaluate(() => [...document.querySelectorAll('div')].some((d) => d.className.includes('z-20') && getComputedStyle(d).opacity !== '0' && d.closest('main')?.getAttribute('aria-hidden') === 'false'));
console.log(!glow ? 'PASS' : 'FAIL', ' no glow outside the assistant');
// hidden tabs are inert (no focus / clicks)
const inert = await page.evaluate(() => [...document.querySelectorAll('main[aria-hidden="true"]')].every((m) => m.inert));
console.log(inert ? 'PASS' : 'FAIL', ' hidden tabs inert');
await browser.close();
