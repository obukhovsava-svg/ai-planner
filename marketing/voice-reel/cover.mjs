import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920 });
await page.goto('file://' + process.cwd() + '/cover.html', { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'plan-cover.png' });
await browser.close();
