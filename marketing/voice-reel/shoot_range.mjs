import puppeteer from 'puppeteer-core';
const [, , outDir, from, to] = process.argv;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars', '--force-device-scale-factor=1'] });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920 });
await page.goto('file://' + process.cwd() + '/reel.html', { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
for (let i = +from; i <= +to; i++) {
  await page.evaluate((t) => window.render(t), i / 30);
  await page.screenshot({ path: `${outDir}/f${String(i).padStart(4, '0')}.png` });
}
await browser.close();
