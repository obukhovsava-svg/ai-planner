/**
 * The lock-screen wallpaper for Telegram users, drawn on a canvas: today's plans on the left,
 * tasks on the right, over the user's photo (or the brand background). Same layout as the iOS
 * app's native renderer (ios/Planner/Wallpaper.swift) — 402-pt-wide design scaled to the screen.
 */
import type { CalendarEvent, DateKey, Task } from '@/types';
import { occursOn } from './recurrence';

const EVENT: Record<string, string> = { blue: '#0a84ff', red: '#ff453a', violet: '#bf5af2', green: '#30d158', amber: '#ff9f0a' };
const FONT = '-apple-system, "SF Pro Text", system-ui, sans-serif';
const MAX_PLANS = 7;
const MAX_TASKS = 9;

export interface WallpaperData {
  date: DateKey;
  events: CalendarEvent[];
  tasks: Task[];
}

/** Pixel size of this phone's screen (portrait). */
export function screenPixels() {
  const dpr = Math.min(3, Math.max(2, window.devicePixelRatio || 3));
  const w = Math.min(screen.width, screen.height) || 402;
  const h = Math.max(screen.width, screen.height) || 874;
  return { w: Math.round(w * dpr), h: Math.round(h * dpr) };
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function lateLabel(key: string, day: string) {
  const d = new Date(`${key}T12:00`), ref = new Date(`${day}T12:00`);
  if (Math.round((ref.getTime() - d.getTime()) / 86_400_000) === 1) return 'вчера';
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

/** Fits text into width with an ellipsis. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= width) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

/** A soft blur that works in every WebView: shrink, then let smoothing spread it back. */
function blurred(photo: CanvasImageSource, pw: number, ph: number, w: number, h: number) {
  let src: CanvasImageSource = photo, sw = pw, sh = ph;
  // aspect-fill crop first
  const s = Math.max(w / pw, h / ph);
  const cw = w / s, chh = h / s;
  const base = document.createElement('canvas');
  base.width = Math.round(w / 4);
  base.height = Math.round(h / 4);
  base.getContext('2d')!.drawImage(src, (sw - cw) / 2, (sh - chh) / 2, cw, chh, 0, 0, base.width, base.height);
  src = base;
  sw = base.width;
  sh = base.height;
  for (const f of [4, 4]) {
    const c = document.createElement('canvas');
    c.width = Math.max(4, Math.round(sw / f));
    c.height = Math.max(4, Math.round(sh / f));
    const x = c.getContext('2d')!;
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, c.width, c.height);
    src = c;
    sw = c.width;
    sh = c.height;
  }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const o = out.getContext('2d')!;
  o.imageSmoothingQuality = 'high';
  o.drawImage(src, 0, 0, w, h);
  return out;
}

export function drawWallpaper(data: WallpaperData, photo: HTMLImageElement | ImageBitmap | null, size = screenPixels()): HTMLCanvasElement {
  const { w: W, h: H } = size;
  const k = W / 402;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  // background
  const pw = photo ? ('naturalWidth' in photo ? photo.naturalWidth : photo.width) : 0;
  const ph = photo ? ('naturalHeight' in photo ? photo.naturalHeight : photo.height) : 0;
  if (photo && pw && ph) {
    const s = Math.max(W / pw, H / ph);
    ctx.drawImage(photo, (W - pw * s) / 2, (H - ph * s) / 2, pw * s, ph * s);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d1025');
    g.addColorStop(0.55, '#141433');
    g.addColorStop(1, '#1d1230');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (const [x, y, r, col] of [
      [0.8 * W, 0, H * 0.55, '#3b3a8f'],
      [0, H, H * 0.45, '#7a3d6e'],
    ] as const) {
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, col);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }
  }
  const glass = photo && pw ? blurred(photo, pw, ph, W, H) : null;

  const top = 262 * k, cw = 182 * k, chh = 428 * k, gap = 10 * k, side = 14 * k;
  const cards = [side, side + cw + gap];
  for (const x of cards) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, top, cw, chh, 22 * k);
    ctx.clip();
    if (glass) {
      ctx.drawImage(glass, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.48)';
    } else ctx.fillStyle = 'rgba(18,18,26,0.62)';
    ctx.fillRect(x, top, cw, chh);
    ctx.restore();
    ctx.beginPath();
    ctx.roundRect(x + 0.5 * k, top + 0.5 * k, cw - k, chh - k, 22 * k);
    ctx.lineWidth = 0.75 * k;
    ctx.strokeStyle = glass ? 'rgba(255,255,255,0.16)' : 'rgba(164,139,250,0.4)';
    ctx.stroke();
  }

  const font = (size: number, weight = 500) => `${weight} ${size * k}px ${FONT}`;
  ctx.textBaseline = 'middle';

  const header = (x: number, icon: 'cal' | 'check', title: string, count: string) => {
    const y = top + 24 * k;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.7 * k;
    ctx.beginPath();
    if (icon === 'cal') {
      ctx.roundRect(x + 12 * k, y - 6 * k, 13 * k, 12 * k, 3 * k);
      ctx.moveTo(x + 12 * k, y - 2 * k);
      ctx.lineTo(x + 25 * k, y - 2 * k);
    } else {
      ctx.roundRect(x + 12 * k, y - 6.5 * k, 13 * k, 13 * k, 3.5 * k);
      ctx.moveTo(x + 15.5 * k, y);
      ctx.lineTo(x + 17.8 * k, y + 2.4 * k);
      ctx.lineTo(x + 21.8 * k, y - 2.6 * k);
    }
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = font(14, 700);
    ctx.fillText(title, x + 31 * k, y);
    ctx.font = font(12, 700);
    const tw = ctx.measureText(count).width;
    const bw = tw + 16 * k, bx = x + cw - 10 * k - bw;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.roundRect(bx, y - 10 * k, bw, 20 * k, 10 * k);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(count, bx + 8 * k, y);
  };

  // left — plans of the day
  const plans = data.events.filter((e) => occursOn(e, data.date)).sort((a, b) => a.start.localeCompare(b.start));
  header(cards[0], 'cal', 'Планы', String(plans.length));
  let y = top + 46 * k;
  if (!plans.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = font(13.5, 600);
    ctx.fillText('Свободный день', cards[0] + 12 * k, y + 10 * k);
  }
  for (const e of plans.slice(0, MAX_PLANS)) {
    const col = EVENT[e.color] ?? EVENT.blue;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.roundRect(cards[0] + 12 * k, y + 5 * k, 3.5 * k, 30 * k, 2 * k);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = font(13.5, 600);
    ctx.fillText(fit(ctx, e.title, cw - 36 * k), cards[0] + 22.5 * k, y + 13 * k);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = font(11, 500);
    ctx.fillText(`${e.start} – ${e.end}`, cards[0] + 22.5 * k, y + 28 * k);
    y += 44 * k;
  }
  if (plans.length > MAX_PLANS) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = font(12, 600);
    ctx.fillText(`+${plans.length - MAX_PLANS} ещё`, cards[0] + 12 * k, y + 8 * k);
  }

  // right — tasks: overdue first, then the day's, done ones last
  const late = data.tasks.filter((t) => !t.done && t.date && t.date < data.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const day = data.tasks.filter((t) => t.date === data.date);
  const open = day.filter((t) => !t.done).sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));
  const done = day.filter((t) => t.done);
  const rows = [
    ...late.map((t) => ({ t, detail: lateLabel(t.date!, data.date), late: true })),
    ...open.map((t) => ({ t, detail: t.time ?? '', late: false })),
    ...done.map((t) => ({ t, detail: '', late: false })),
  ];
  header(cards[1], 'check', 'Задачи', `${done.length}/${rows.length}`);
  y = top + 46 * k;
  const x0 = cards[1] + 12 * k;
  if (!rows.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = font(13.5, 600);
    ctx.fillText('Задач нет', x0, y + 10 * k);
  }
  rows.slice(0, MAX_TASKS).forEach(({ t, detail, late: isLate }, i, arr) => {
    const cy = y + 20 * k;
    ctx.globalAlpha = t.done ? 0.45 : 1;
    ctx.beginPath();
    ctx.arc(x0 + 8 * k, cy, 7.1 * k, 0, Math.PI * 2);
    if (t.done) {
      ctx.fillStyle = glass ? '#fff' : '#a48bfa';
      ctx.fill();
      ctx.strokeStyle = glass ? '#000' : '#fff';
      ctx.lineWidth = 1.8 * k;
      ctx.beginPath();
      ctx.moveTo(x0 + 5 * k, cy);
      ctx.lineTo(x0 + 7.3 * k, cy + 2.4 * k);
      ctx.lineTo(x0 + 11.2 * k, cy - 2.6 * k);
      ctx.stroke();
    } else {
      ctx.strokeStyle = isLate ? '#ff453a' : 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.8 * k;
      ctx.stroke();
    }
    ctx.font = font(11.5, 600);
    const dw = detail ? ctx.measureText(detail).width + 6 * k : 0;
    if (detail) {
      ctx.fillStyle = isLate ? '#ff453a' : 'rgba(255,255,255,0.6)';
      ctx.fillText(detail, cards[1] + cw - 10 * k - dw + 6 * k, cy);
    }
    let tx = x0 + 23 * k;
    ctx.font = font(13.5, 700);
    if (t.priority === 'high' && !t.done) {
      ctx.fillStyle = '#ff453a';
      ctx.fillText('!', tx, cy);
      tx += ctx.measureText('! ').width;
    }
    ctx.fillStyle = '#fff';
    ctx.font = font(13.5, 500);
    const title = fit(ctx, t.title, cards[1] + cw - 10 * k - dw - tx);
    ctx.fillText(title, tx, cy);
    if (t.done) {
      const tw = ctx.measureText(title).width;
      ctx.fillRect(tx, cy, tw, 1.2 * k);
    }
    ctx.globalAlpha = 1;
    if (i < arr.length - 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(x0, y + 40 * k - 0.5 * k, cw - 22 * k, 0.5 * k);
    }
    y += 40 * k;
  });
  if (rows.length > MAX_TASKS) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = font(12, 600);
    ctx.fillText(`+${rows.length - MAX_TASKS} ещё`, x0, y + 10 * k);
  }

  // stamp
  const now = new Date();
  ctx.font = font(9, 600);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 3 * k;
  const stamp = `ПЛАН · обновлено ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  ctx.fillText(stamp, W - 20 * k - ctx.measureText(stamp).width, top + chh + 10 * k);
  ctx.shadowBlur = 0;
  return c;
}
