"""Widgets as editable SVG (drop into Figma: text stays text, shapes stay shapes).
Mirrors ios/PlannerWidget/PlannerWidget.swift: sizes, SF Pro type, colours, spacing."""
import math, pathlib
OUT = pathlib.Path(__file__).parent
SF, SFR = "SF Pro", "SF Pro Rounded"
T = {
  "light": dict(bg="#ffffff", text="#000000", sec="rgba(60,60,67,0.6)", ter="rgba(60,60,67,0.3)", fill="rgba(0,0,0,0.07)", hair="rgba(0,0,0,0.06)", glow=(0.22, 0.16), canvas="#e9e9ee"),
  "dark": dict(bg="#15141c", text="#ffffff", sec="rgba(235,235,245,0.6)", ter="rgba(235,235,245,0.3)", fill="rgba(255,255,255,0.09)", hair="rgba(255,255,255,0.08)", glow=(0.34, 0.24), canvas="#000000"),
}
BLUE, RED, LATE = "#007aff", "#ff3b30", "#ff3b30"

def esc(s): return s.replace("&", "&amp;").replace("<", "&lt;")

class W:
  def __init__(s, name, w, h, theme, x, y):
    s.name, s.w, s.h, s.t, s.x, s.y, s.out = name, w, h, T[theme], x, y, []
    uid = f"{name.split()[0]}{theme}"
    s.uid = uid
    s.out.append(f'<g id="{esc(name)}" transform="translate({x},{y})">')
    s.out.append(f'<defs><clipPath id="clip{uid}"><rect width="{w}" height="{h}" rx="24"/></clipPath>'
                 f'<radialGradient id="ga{uid}" cx="{w}" cy="0" r="230" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#a48bfa" stop-opacity="{s.t["glow"][0]}"/><stop offset="1" stop-color="#a48bfa" stop-opacity="0"/></radialGradient>'
                 f'<radialGradient id="gb{uid}" cx="0" cy="{h}" r="210" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7a9dfe" stop-opacity="{s.t["glow"][1]}"/><stop offset="1" stop-color="#7a9dfe" stop-opacity="0"/></radialGradient></defs>')
    s.out.append(f'<g clip-path="url(#clip{uid})"><rect id="background" width="{w}" height="{h}" fill="{s.t["bg"]}"/><rect id="glow" width="{w}" height="{h}" fill="url(#ga{uid})"/><rect id="glow 2" width="{w}" height="{h}" fill="url(#gb{uid})"/>')

  def text(s, x, y, txt, size, weight=400, fill=None, family=SF, deco=None, anchor="start", name=None, ls=0):
    fill = fill or s.t["text"]
    d = f' text-decoration="{deco}"' if deco else ""
    s.out.append(f'<text id="{esc(name or txt)}" x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" fill="{fill}" letter-spacing="{ls}" text-anchor="{anchor}"{d}>{esc(txt)}</text>')

  def header(s, compact, done=1, total=3):
    s.text(16, 16 + 11, "ВТОРНИК", 11, 700, fill=f"url(#brand)", name="weekday")
    s.text(16, 16 + 11 + (21 if compact else 24), "14 окт" if compact else "14 октября", 18 if compact else 21, 700, family=SFR, name="date")
    r = 15 if compact else 18
    s.ring(s.w - 16 - r, 16 + (20 if compact else 22), r, done, total)
    return 16 + (44 if compact else 50)

  def ring(s, cx, cy, r, done, total):
    sw = r * 2 * 0.12; rr = r - sw / 2
    s.out.append(f'<g id="Progress Ring"><circle cx="{cx}" cy="{cy}" r="{rr}" fill="none" stroke="{s.t["fill"]}" stroke-width="{sw}"/>')
    a = 2 * math.pi * done / total
    x1, y1 = cx, cy - rr; x2, y2 = cx + rr * math.sin(a), cy - rr * math.cos(a)
    s.out.append(f'<path d="M{x1:.2f} {y1:.2f} A{rr:.2f} {rr:.2f} 0 {1 if a > math.pi else 0} 1 {x2:.2f} {y2:.2f}" fill="none" stroke="url(#brand)" stroke-width="{sw}" stroke-linecap="round"/>')
    s.text(cx, cy + r * 0.28 * 0.36, f"{done}/{total}", r * 2 * 0.28, 600, family=SFR, anchor="middle", name="value")
    s.out.append('</g>')

  def section(s, x, y, title, count, icon):
    s.out.append(f'<g id="Section/{title}">')
    ic = {"cal": '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>', "list": '<path d="m3 7 2 2 4-4M3 17l2 2 4-4M13 6h8M13 12h8M13 18h8"/>'}[icon]
    s.out.append(f'<g transform="translate({x},{y - 9}) scale(0.4583)" fill="none" stroke="{s.t["sec"]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">{ic}</g>')
    s.text(x + 15, y, title.upper(), 10, 700, fill=s.t["sec"], ls=0.4)
    bx = x + 15 + len(title) * 7.1 + 4
    s.out.append(f'<rect x="{bx}" y="{y - 10}" width="16" height="13" rx="6.5" fill="{s.t["fill"]}"/>')
    s.text(bx + 8, y, str(count), 10, 700, fill=s.t["sec"], anchor="middle", name="count")
    s.out.append('</g>')

  def plan(s, x, y, w, title, start, end, color, now=False, compact=False):
    s.out.append(f'<g id="Plan Row/{"now" if now else "compact" if compact else "default"}">')
    if now:
      s.out.append(f'<rect x="{x - 5}" y="{y - 3}" width="{w + 10}" height="33" rx="8" fill="{color}" fill-opacity="0.13"/>')
    tx = x
    if not compact:
      s.text(x, y + 12, start, 12, 600, fill=color if now else s.t["sec"], family=SFR, name="time"); tx = x + 44
    s.out.append(f'<rect x="{tx}" y="{y + 1}" width="3.5" height="25" rx="1.75" fill="{color}"/>')
    s.text(tx + 10.5, y + 12, title, 13, 600, name="title")
    sub = f"сейчас · до {end}" if now else f"{start}–{end}" if compact else f"до {end}"
    s.text(tx + 10.5, y + 25, sub, 10, 600 if now else 500 if compact else 400, fill=color if now else s.t["sec"], name="subtitle")
    s.out.append('</g>'); return y + 27

  def todo(s, x, y, w, title, state="open", detail=None):
    s.out.append(f'<g id="Todo Row/{state}">')
    cx, cy = x + 7.5, y + 7.5
    if state == "done":
      s.out.append(f'<circle cx="{cx}" cy="{cy}" r="7.5" fill="url(#brand)"/><path d="M{x + 4.6} {y + 7.7} l2 1.9 3.8-4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>')
    else:
      s.out.append(f'<circle cx="{cx}" cy="{cy}" r="6.7" fill="none" stroke="{LATE if state == "late" else "url(#brand)"}" stroke-width="1.6"/>')
    s.text(x + 22, y + 12, title, 13, 400, fill=s.t["sec"] if state == "done" else s.t["text"], deco="line-through" if state == "done" else None, name="title")
    if detail: s.text(x + w, y + 11.5, detail, 10, 500, fill=LATE if state == "late" else s.t["sec"], anchor="end", name="detail")
    s.out.append('</g>'); return y + 15

  def more(s, x, y, n): s.text(x, y, f"ещё {n}", 10, 500, fill=s.t["ter"], name="more")
  def end(s): s.out.append('</g></g>'); return "\n".join(s.out)

def small(theme, x, y):
  w = W("Small 170×170 · " + theme, 170, 170, theme, x, y); cw = 138
  yy = w.header(True) + 8
  yy = w.plan(16, yy, cw, "Созвон с командой", "15:00", "16:00", BLUE, compact=True) + 8
  yy = w.todo(16, yy, cw, "Сдать отчёт", "late", "12 окт") + 8
  w.todo(16, yy, cw, "Купить продукты")
  w.more(16, 170 - 16, 3); return w.end()

def medium(theme, x, y):
  w = W("Medium 364×170 · " + theme, 364, 170, theme, x, y); cw = (364 - 32 - 12) / 2
  top = w.header(True) + 9 + 10
  w.section(16, top, "Планы", 2, "cal")
  yy = w.plan(16, top + 9, cw, "Созвон", "15:00", "16:00", BLUE, now=True) + 6
  w.plan(16, yy, cw, "Тренировка", "19:00", "20:00", RED)
  x2 = 16 + cw + 12
  w.section(x2, top, "Задачи", 3, "list")
  yy = w.todo(x2, top + 9, cw, "Сдать отчёт", "late", "12 окт") + 6
  yy = w.todo(x2, yy, cw, "Оплатить интернет", "open", "18:00") + 6
  w.todo(x2, yy, cw, "Купить продукты"); return w.end()

def large(theme, x, y):
  w = W("Large 364×382 · " + theme, 364, 382, theme, x, y); cw = 332
  top = w.header(False) + 8 + 10
  w.section(16, top, "Планы", 2, "cal")
  yy = w.plan(16, top + 9, cw, "Созвон с командой", "15:00", "16:00", BLUE, now=True) + 6
  yy = w.plan(16, yy, cw, "Тренировка", "19:00", "20:00", RED) + 8
  w.out.append(f'<rect id="divider" x="16" y="{yy}" width="{cw}" height="1" fill="{w.t["hair"]}"/>'); yy += 9 + 10
  w.section(16, yy, "Задачи", 3, "list"); yy += 9
  for t, st, d in [("Сдать отчёт", "late", "12 окт"), ("Оплатить интернет", "open", "18:00"), ("Купить продукты", "open", None), ("Позвонить врачу", "done", None)]:
    yy = w.todo(16, yy, cw, t, st, d) + 6
  w.out.append(f'<g id="Завтра"><rect x="16" y="{382 - 16 - 26}" width="{cw}" height="26" rx="13" fill="{w.t["text"]}" fill-opacity="0.05"/>')
  w.text(26, 382 - 16 - 9, "Завтра", 11, 700, fill="url(#brand)")
  w.text(72, 382 - 16 - 9, "09:30 Планёрка", 11, 500)
  w.text(156, 382 - 16 - 9, "+1", 11, 400, fill=w.t["sec"]); w.out.append('</g>')
  return w.end()

def lock(x, y):
  o = [f'<g id="Экран блокировки" transform="translate({x},{y})">',
       '<defs><linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f4f73"/><stop offset="0.55" stop-color="#5b7aa0"/><stop offset="1" stop-color="#3b2a2a"/></linearGradient></defs>',
       '<rect id="wallpaper" width="420" height="230" rx="28" fill="url(#wall)"/>']
  def t(x, y, s, size, wt=400, op=1, fam=SF, name=None):
    o.append(f'<text id="{esc(name or s)}" x="{x}" y="{y}" font-family="{fam}" font-size="{size}" font-weight="{wt}" fill="#fff" fill-opacity="{op}">{esc(s)}</text>')
  # «Сегодня» rectangular: plans
  o.append('<g id="Lock/Планы 172×76" transform="translate(20,24)"><rect width="172" height="76" rx="14" fill="#fff" fill-opacity="0.12"/>')
  t(10, 17, "ПЛАНЫ · 2", 11, 700, 0.75)
  for i, (tm, title, bold) in enumerate([("15:00", "Созвон", True), ("19:00", "Тренировка", False)]):
    yy = 38 + i * 19
    t(10, yy, tm, 13, 600, 1, SFR); o.append(f'<rect x="50" y="{yy - 11}" width="3" height="13" rx="1.5" fill="#fff" fill-opacity="{1 if bold else 0.5}"/>')
    t(58, yy, title, 14, 700 if bold else 400)
  o.append('</g>')
  # «Задачи» rectangular: ring + tasks
  o.append('<g id="Lock/Задачи 172×76" transform="translate(220,24)"><rect width="172" height="76" rx="14" fill="#fff" fill-opacity="0.12"/>')
  cx, cy, r = 29, 38, 19; sw = 38 * 0.11; rr = r - sw / 2; a = 2 * math.pi / 3
  o.append(f'<circle cx="{cx}" cy="{cy}" r="{rr}" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="{sw}"/>')
  o.append(f'<path d="M{cx} {cy - rr} A{rr} {rr} 0 0 1 {cx + rr * math.sin(a):.2f} {cy - rr * math.cos(a):.2f}" fill="none" stroke="#fff" stroke-width="{sw}" stroke-linecap="round"/>')
  o.append(f'<text x="{cx}" y="{cy + 3.6}" text-anchor="middle" font-family="{SFR}" font-size="10.3" font-weight="700" fill="#fff">1/3</text>')
  for i, (s, late) in enumerate([("Сдать отчёт", True), ("Купить продукты", False), ("Полить цветы", False)]):
    yy = 22 + i * 19
    o.append(f'<circle cx="62" cy="{yy - 4}" r="4.3" fill="none" stroke="#fff" stroke-width="1.4"/>' + (f'<path d="M62 {yy - 6.2}v2.4" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>' if late else ""))
    t(71, yy, s, 13)
  o.append('</g>')
  # circular ring + inline
  o.append('<g id="Lock/Кольцо 76×76" transform="translate(20,128)"><circle cx="38" cy="38" r="38" fill="#fff" fill-opacity="0.12"/>')
  r2 = 26; sw2 = 52 * 0.11; rr2 = r2 - sw2 / 2
  o.append(f'<circle cx="38" cy="38" r="{rr2}" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="{sw2}"/><path d="M38 {38 - rr2} A{rr2} {rr2} 0 0 1 {38 + rr2 * math.sin(a):.2f} {38 - rr2 * math.cos(a):.2f}" fill="none" stroke="#fff" stroke-width="{sw2}" stroke-linecap="round"/>')
  o.append(f'<text x="38" y="43" text-anchor="middle" font-family="{SFR}" font-size="14" font-weight="700" fill="#fff">1/3</text></g>')
  o.append('<g id="Lock/Строка" transform="translate(120,150)">'); t(0, 16, "15:00 Созвон с командой", 15, 500); o.append('</g>')
  o.append('</g>'); return "\n".join(o)

defs = '<defs><linearGradient id="brand" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7a9dfe"/><stop offset="0.52" stop-color="#a48bfa"/><stop offset="1" stop-color="#f48eae"/></linearGradient></defs>'
parts = []
for row, theme in enumerate(["light", "dark"]):
  y = 40 + row * 462
  parts.append(f'<rect id="{"Светлая" if theme == "light" else "Тёмная"} тема · фон" x="0" y="{y - 40}" width="1040" height="462" fill="{T[theme]["canvas"]}"/>')
  parts += [small(theme, 40, y), medium(theme, 250, y), large(theme, 630, y)]
parts.append(lock(40, 964))
svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="1234" viewBox="0 0 1040 1234">{defs}{"".join(parts)}</svg>'
(OUT / "widgets.svg").write_text(svg, encoding="utf-8")
# preview only: Chrome has no SF Pro, so the system font stands in
(OUT / ".preview.svg").write_text(svg.replace('font-family="SF Pro Rounded"', 'font-family="ui-rounded, -apple-system"').replace('font-family="SF Pro"', 'font-family="-apple-system"'), encoding="utf-8")
print(OUT / "widgets.svg")
