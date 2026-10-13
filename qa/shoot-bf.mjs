import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 8200 });
await page.goto(`file://${new URL('../marketing/botfather/previews.html', import.meta.url).pathname}`);
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 600));
for (const i of [1, 2, 3, 4]) await (await page.$('#p' + i)).screenshot({ path: new URL(`../marketing/botfather/preview-${i}.png`, import.meta.url).pathname });
await browser.close();
