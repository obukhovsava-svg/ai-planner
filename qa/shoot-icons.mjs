import puppeteer from 'puppeteer-core';
const dir = new URL('../marketing/logo-final/', import.meta.url).pathname;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1024, deviceScaleFactor: 1 });
for (const n of ['icon-light', 'icon-dark', 'avatar-light', 'avatar-dark', 'logo-mark-green', 'logo-mark-lime']) {
  await page.goto(`file://${dir}${n}.svg`);
  await page.screenshot({ path: `${dir}${n}.png`, omitBackground: n.startsWith('logo-mark') });
}
await browser.close();
