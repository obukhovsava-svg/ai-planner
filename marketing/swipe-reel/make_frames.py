"""Frames for a "someone swipes the carousel" Reel (1080×1920, 30 fps).

usage: python3 make_frames.py <marketing dir> <frames out dir>
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

M = Path(sys.argv[1])
OUT = Path(sys.argv[2])
W, H, FPS = 1080, 1920, 30
CW, CH = 900, 1125            # card (4:5)
CX, CY = (W - CW) // 2, 360   # card position: clear of Reels' top bar and bottom captions
HOLD, LAST_HOLD, SWIPE, PRE = int(2.4 * FPS), int(3.2 * FPS), 16, 10


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype('/System/Library/Fonts/SFNS.ttf', size)


slides = [Image.open(M / 'carousel' / f'slide-{i}.png').convert('RGB').resize((CW, CH), Image.LANCZOS) for i in range(1, 8)]
mask = Image.new('L', (CW, CH), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, CW - 1, CH - 1), 44, fill=255)

# background: black with soft brand glows
glow = Image.new('RGB', (W, H), (0, 0, 0))
g = ImageDraw.Draw(glow)
g.ellipse((560, -260, 1460, 640), fill=(60, 92, 190))
g.ellipse((-380, 1250, 520, 2150), fill=(150, 70, 95))
g.ellipse((300, 700, 1000, 1400), fill=(80, 60, 140))
bg = Image.blend(Image.new('RGB', (W, H), (0, 0, 0)), glow.filter(ImageFilter.GaussianBlur(180)), 0.55)

# post header (avatar + name), like an Instagram post
avatar = Image.open(M / 'logo' / 'instagram-avatar-1080.png').convert('RGB').resize((74, 74), Image.LANCZOS)
am = Image.new('L', (74, 74), 0)
ImageDraw.Draw(am).ellipse((0, 0, 73, 73), fill=255)
bg.paste(avatar, (CX, CY - 104), am)
d = ImageDraw.Draw(bg)
d.text((CX + 92, CY - 100), 'myliveplaners_bot', font=font(32), fill=(255, 255, 255))
d.text((CX + 92, CY - 60), 'AI-планер в Telegram', font=font(26), fill=(170, 170, 180))


def ease(t: float) -> float:
    return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def frame(pos: float, finger) -> Image.Image:
    """pos: fractional slide index (2.4 = 40% of the way from slide 3 to slide 4)."""
    im = bg.copy()
    # Slides move inside the post's frame, like a real carousel (nothing peeks out at the sides).
    strip = Image.new('RGB', (CW, CH), (0, 0, 0))
    i = int(math.floor(pos))
    for k in (i, i + 1):
        if 0 <= k < len(slides):
            x = round((k - pos) * CW)
            if -CW < x < CW:
                strip.paste(slides[k], (x, 0))
    im.paste(strip, (CX, CY), mask)
    d = ImageDraw.Draw(im)
    # carousel dots
    n, r, step = len(slides), 7, 26
    x0, y = W // 2 - (n - 1) * step // 2, CY + CH + 44
    for k in range(n):
        d.ellipse((x0 + k * step - r, y - r, x0 + k * step + r, y + r), fill=(10, 132, 255) if k == round(pos) else (90, 90, 96))
    if finger:
        fx, fy, a = finger
        layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.ellipse((fx - 46, fy - 46, fx + 46, fy + 46), fill=(255, 255, 255, int(70 * a)))
        ld.ellipse((fx - 32, fy - 32, fx + 32, fy + 32), fill=(255, 255, 255, int(215 * a)))
        im = Image.alpha_composite(im.convert('RGBA'), layer).convert('RGB')
    return im


frames = []
fy = CY + CH // 2 + 120
for s in range(len(slides)):
    last = s == len(slides) - 1
    hold = LAST_HOLD if last else HOLD
    for t in range(hold):
        finger = None
        if not last and t >= hold - PRE:  # the finger lands on the right, then swipes
            finger = (CX + CW - 130, fy, (t - (hold - PRE)) / PRE)
        frames.append((s, finger))
    if not last:
        for t in range(1, SWIPE + 1):
            e = ease(t / SWIPE)
            frames.append((s + e, (CX + CW - 130 - e * 520, fy, 1 - max(0.0, (t / SWIPE - 0.75) * 4))))

for n, (pos, finger) in enumerate(frames):
    frame(pos, finger).save(OUT / f'f{n:04d}.png', compress_level=1)
print(len(frames), 'frames,', round(len(frames) / FPS, 1), 's')
