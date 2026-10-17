// node shot.mjs — renders every slide of guide.html to wallpaper-N.png / voice-N.png (puppeteer from ../voice-reel)
import { createRequire } from 'module';
const puppeteer = createRequire(new URL('../voice-reel/package.json', import.meta.url))('puppeteer-core');
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage();
await p.setViewport({ width: 2400, height: 1200, deviceScaleFactor: 1 });
await p.goto('file://' + process.cwd() + '/guide.html', { waitUntil: 'networkidle0' });
await p.evaluate(() => document.fonts.ready);
const names = { w: 'wallpaper', v: 'voice' };
for (const id of await p.$$eval('section.slide', (s) => s.map((e) => e.id))) {
  const file = `${names[id[0]]}-${Number(id.slice(1)) + 1}.png`;
  await (await p.$('#' + id)).screenshot({ path: file });
  console.log(file);
}
await b.close();
