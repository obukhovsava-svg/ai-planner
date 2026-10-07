import puppeteer from 'puppeteer-core';
const ts = process.argv[2].split(',').map(Number);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920 });
await page.goto('file://' + process.cwd() + '/reel.html', { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
for (const [i, t] of ts.entries()) {
  await page.evaluate((t) => window.render(t), t);
  await page.evaluate(() => Promise.all([...document.images].map((im) => (im.complete && im.naturalWidth ? 0 : im.decode().catch(() => 0)))));
  await page.screenshot({ path: `pv/p${i}.png` });
}
await browser.close();
