// The keyboard slides (viewport shrinks/grows over ~300 ms, like iOS); records where the orb /
// its ghost is every frame and checks the motion is one smooth move (no stop-and-reverse).
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await page.goto('file://' + process.cwd().replace('/qa', '') + '/ios/Planner/Web/index.html', { waitUntil: 'load' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1500);
await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.innerText.trim().endsWith('Ассистент'))?.click());
await wait(900);
const slide = async (from, to) => { for (let i = 1; i <= 10; i++) { const h = Math.round(from + (to - from) * (1 - Math.pow(1 - i / 10, 3))); await page.setViewport({ width: 390, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await wait(30); } };
const track = () => page.evaluate(() => {
  window.__trk = [];
  const t0 = performance.now();
  const loop = () => {
    const ghost = document.querySelector('.z-30.will-change-transform');
    const orb = document.querySelector('[aria-label="Начать голосовой ввод"]');
    const gOp = ghost ? Number(getComputedStyle(ghost).opacity) : 0;
    const oWrap = orb?.closest('.items-center');
    const oVis = orb && !orb.closest('[aria-hidden="true"]') && Number(getComputedStyle(oWrap).opacity) > 0.5;
    const el = gOp > 0.3 ? ghost : oVis ? orb : null;
    const r = el?.getBoundingClientRect();
    const field = document.querySelector('input[placeholder^="Или"]')?.getBoundingClientRect();
    window.__trk.push({ t: Math.round(performance.now() - t0), who: el === ghost ? 'ghost' : el ? 'orb' : '-', y: r ? Math.round(r.top + r.height / 2) : null, bottom: r ? Math.round(r.bottom) : null, field: field ? Math.round(field.bottom) : null, vh: Math.round(window.visualViewport?.height ?? innerHeight) });
    if (window.__trkOn) requestAnimationFrame(loop);
  };
  window.__trkOn = true; requestAnimationFrame(loop);
});
const stop = () => page.evaluate(() => { window.__trkOn = false; return window.__trk; });
const analyse = (name, trk, expect) => {
  const ys = trk.filter((p) => p.y != null);
  let reversals = 0, dir = 0, jumps = 0;
  for (let i = 1; i < ys.length; i++) {
    const d = ys[i].y - ys[i - 1].y;
    if (Math.abs(d) > 80) jumps++;
    if (Math.abs(d) < 3) continue;
    const s = Math.sign(d);
    if (dir && s !== dir) reversals++;
    dir = s;
  }
  const over = ys.filter((p) => p.bottom > p.vh + 2).length; // drawn below the visible screen = over the keyboard
  console.log(`   over the keyboard: ${over} frames ${over ? 'FAIL' : 'PASS'}`);
  console.log(`${name}: frames ${trk.length}, visible ${ys.length}, direction changes ${reversals}, jumps>80px ${jumps}  ${reversals <= expect ? 'PASS' : 'FAIL'}`);
  console.log('   ', ys.filter((_, i) => i % 3 === 0).map((p) => `${p.who[0]}${p.y}`).join(' '));
};
// open: focus, keyboard slides up
await track();
await page.focus('input[placeholder^="Или"]');
await slide(844, 510);
await wait(1100);
analyse('open ', await stop(), 1);
// close: blur, keyboard slides down, tab bar returns
await track();
await page.evaluate(() => document.activeElement.blur());
await slide(510, 844);
await wait(1600);
analyse('close', await stop(), 1);
await browser.close();
