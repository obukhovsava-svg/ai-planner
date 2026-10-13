import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1.5 });
await page.goto(`file://${new URL('../marketing/logo-ink/logos.html', import.meta.url).pathname}`);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: new URL('../marketing/logo-ink/logo-concepts.png', import.meta.url).pathname, fullPage: true });
await browser.close();
