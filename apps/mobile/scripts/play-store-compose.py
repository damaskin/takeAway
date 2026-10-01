"""Captioned Google Play phone screenshots, in the App Store set's style.

    python apps/mobile/scripts/play-store-compose.py [SRC] [OUT]

SRC holds the raw emulator shots from play-store-screenshots.sh (default
build/play-store-screenshots), OUT gets 1080x1920 PNGs (default
build/play-store-screenshots/phone): Play takes phone screenshots only in 9:16
or 16:9. Needs Pillow; FONT points to a bold TTF with Cyrillic (Segoe UI Bold
on Windows by default).
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "build", "play-store-screenshots")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(SRC, "phone")
FONT = os.environ.get("FONT", r"C:\Windows\Fonts\segoeuib.ttf")

W, H = 1080, 1920
BG = (246, 239, 230)
INK = (28, 22, 18)
SHADOW = (120, 95, 70)
# The emulator status bar, cropped off: GMS keeps notification icons there
# even in demo mode. Pixel 9 Pro at 1280x2856.
STATUS_BAR = 140

# The App Store captions; the sign-in one without Apple, and the store map is
# left out — its tiles rarely finish loading before the shot.
SHOTS = [
    ("02_menu", "Закажите заранее —\nзаберите без очереди"),
    ("04_product", "Любимый напиток\nв пару касаний"),
    ("03_category", "Кофе, чаи, лимонады\nи завтраки"),
    ("05_sign_in", "Вход через Telegram\nили Google"),
]

os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith(".png"):
        os.remove(os.path.join(OUT, f))

font = ImageFont.truetype(FONT, 66)
for idx, (name, caption) in enumerate(SHOTS, 1):
    canvas = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(canvas)
    y = 92
    for line in caption.split("\n"):
        draw.text(((W - draw.textlength(line, font=font)) / 2, y), line, font=font, fill=INK)
        y += 84

    shot = Image.open(os.path.join(SRC, name + ".png")).convert("RGB")
    shot = shot.crop((0, STATUS_BAR, shot.width, shot.height))
    top = 330
    sh = H - top - 40
    sw = round(shot.width * sh / shot.height)
    shot = shot.resize((sw, sh), Image.LANCZOS)
    x = (W - sw) // 2
    radius = 44

    mask = Image.new("L", (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw - 1, sh - 1), radius=radius, fill=255)
    shadow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shadow).rounded_rectangle((x, top + 10, x + sw, top + sh + 10), radius=radius, fill=70)
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    canvas = Image.composite(Image.new("RGB", (W, H), SHADOW), canvas, shadow)
    canvas.paste(shot, (x, top), mask)

    path = os.path.join(OUT, "%02d_%s.png" % (idx, name))
    canvas.save(path, optimize=True)
    print(path)
