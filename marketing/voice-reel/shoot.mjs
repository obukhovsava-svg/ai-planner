// node shoot.mjs <outdir> <t1,t2,…> | --all <fps> <dur> [workers]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
const [, , outDir, spec, fpsArg, durArg, wArg] = process.argv;
mkdirSync(outDir, { recursive: true });
const html = 'file://' + process.cwd() + '/reel.html';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files'] });
let jobs;
if (spec === '--all') { const fps = +fpsArg, n = Math.round(+durArg * fps); jobs = Array.from({ length: n }, (_, i) => [i, i / fps]); }
else jobs = spec.split(',').map((t, i) => [i, +t]);
const workers = +(wArg || 1);
let next = 0;
async function worker() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920 });
  await page.goto(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  while (next < jobs.length) {
    const [i, t] = jobs[next++];
    await page.evaluate((t) => window.render(t), t);
    await page.evaluate(() => Promise.all([...document.images].map((im) => (im.complete && im.naturalWidth ? 0 : im.decode().catch(() => 0)))));
    await page.screenshot({ path: `${outDir}/f${String(i).padStart(4, '0')}.png`, type: 'png' });
    if (i % 100 === 0) console.log('frame', i);
  }
}
await Promise.all(Array.from({ length: workers }, worker));
await browser.close();
