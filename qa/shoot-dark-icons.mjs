import puppeteer from 'puppeteer-core';
const dir = new URL('../marketing/logo-final/dark/', import.meta.url).pathname;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1024 });
for (const k of ['blue', 'sage', 'lime', 'mist', 'pink', 'red', 'yellow', 'milk']) { await page.goto(`file://${dir}icon-${k}-dark.svg`); await page.screenshot({ path: `${dir}icon-${k}-dark.png` }); }
await browser.close();
