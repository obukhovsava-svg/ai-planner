import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'fs';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 402, height: 874, deviceScaleFactor: 3 });
await page.goto('about:blank');
await page.addScriptTag({ path: 'wp-bundle.js' });
const photo = 'data:image/jpeg;base64,' + readFileSync('/tmp/mac-blue.jpg').toString('base64');
for (const [name, usePhoto] of [['default', false], ['photo', true]]) {
  const data = await page.evaluate(async (usePhoto, photo) => {
    const now = Date.now(), tod = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const day = tod(new Date()), yest = tod(new Date(now - 86400000));
    const ev = (id, title, start, end, color) => ({ id, title, date: day, start, end, color, createdAt: now });
    const tk = (id, title, x = {}) => ({ id, title, done: false, priority: 'medium', category: 'personal', createdAt: now, date: day, ...x });
    const events = [ev('1', 'Планёрка', '09:30', '10:30', 'blue'), ev('2', 'Поездка за город', '12:00', '15:00', 'green'), ev('3', 'Созвон с командой', '17:00', '18:00', 'blue'), ev('4', 'Тренировка', '19:00', '20:30', 'red'), ev('5', 'Ужин с родителями', '21:00', '22:00', 'violet')];
    const tasks = [tk('a', 'Сдать отчёт', { date: yest, priority: 'high' }), tk('b', 'Оплатить интернет', { time: '18:00' }), tk('c', 'Купить продукты'), tk('d', 'Позвонить маме', { done: true }), tk('e', 'Забрать посылку', { time: '20:00' }), tk('f', 'Полить цветы'), tk('g', 'Записаться к врачу')];
    let img = null;
    if (usePhoto) { img = new Image(); img.src = photo; await img.decode(); }
    return window.drawWallpaper({ date: day, events, tasks }, img, { w: 1206, h: 2622 }).toDataURL('image/jpeg', 0.8);
  }, usePhoto, photo);
  writeFileSync(`shots/wp-${name}.jpg`, Buffer.from(data.split(',')[1], 'base64'));
}
await browser.close();
