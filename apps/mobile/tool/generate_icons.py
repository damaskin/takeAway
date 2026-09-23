"""Renders the takeAway launcher icons and launch-screen logo.

The mark is a takeaway cup drawn from primitives, so the whole set can be
regenerated without a design tool:

    python tool/generate_icons.py

Writes Android mipmaps (legacy + adaptive + monochrome), the Android splash
logo and notification icon, the iOS AppIcon set and the iOS launch image.
Requires Pillow.
"""

from __future__ import annotations

import os
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SS = 4  # supersampling factor for anti-aliased edges

CARAMEL = (199, 125, 59)
CARAMEL_LIGHT = (214, 145, 82)
CARAMEL_DARK = (122, 69, 32)
CREAM = (248, 243, 235)
FOAM = (255, 255, 255)
ESPRESSO = (26, 20, 20)


def _cup(draw: ImageDraw.ImageDraw, scale: float, ox: float, oy: float, *, mono: bool = False,
         body=CREAM, lid=FOAM, sleeve=CARAMEL_DARK, steam=(255, 255, 255, 150)) -> None:
    """Draws the cup in a 1024-unit design space, scaled and offset."""

    def p(x: float, y: float) -> tuple[float, float]:
        return (ox + x * scale, oy + y * scale)

    def poly(points, fill):
        draw.polygon([p(x, y) for x, y in points], fill=fill)

    def rrect(x0, y0, x1, y1, r, fill):
        (ax, ay), (bx, by) = p(x0, y0), p(x1, y1)
        radius = max(0.0, min(r * scale, (by - ay) / 2 - 1, (bx - ax) / 2 - 1))
        draw.rounded_rectangle([(ax, ay), (bx, by)], radius=radius, fill=fill)

    white = (255, 255, 255, 255)
    if mono:
        body = lid = white
        sleeve = (0, 0, 0, 0)

    # Steam — two soft strokes above the lid.
    if not mono:
        for dx in (-62, 62):
            pts = []
            for i in range(0, 41):
                t = i / 40
                y = 206 - t * 104
                x = 512 + dx + 16 * math.sin(t * 1.6 * math.pi)
                pts.append(p(x, y))
            draw.line(pts, fill=steam, width=max(1, int(20 * scale)), joint='curve')

    # Body — a tapered cup with a slightly rounded base.
    poly([(318, 330), (706, 330), (650, 800), (374, 800)], body)
    rrect(372, 772, 652, 812, 20, body)

    # Sleeve band following the taper.
    if not mono:
        poly([(334, 480), (690, 480), (673, 628), (351, 628)], sleeve)

    # Lid — rim plus raised cap.
    rrect(290, 280, 734, 338, 26, lid)
    rrect(338, 236, 686, 292, 24, lid)
    if not mono:
        rrect(300, 322, 724, 338, 8, (230, 222, 210, 255))


def render_icon(size: int, *, full_bleed: bool, rounded: bool) -> Image.Image:
    """Full icon: caramel field with the cup centred."""
    big = size * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))

    field = Image.new('RGBA', (big, big), CARAMEL + (255,))
    glow_mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(glow_mask).ellipse([big * 0.12, big * 0.04, big * 0.88, big * 0.8], fill=150)
    glow_mask = glow_mask.filter(ImageFilter.GaussianBlur(big * 0.14))
    field.paste(Image.new('RGBA', (big, big), CARAMEL_LIGHT + (255,)), (0, 0), glow_mask)

    if rounded:
        mask = Image.new('L', (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.22, fill=255)
        img.paste(field, (0, 0), mask)
    else:
        img = field

    draw = ImageDraw.Draw(img)
    inset = 0.0 if full_bleed else 0.08
    scale = big * (1 - 2 * inset) / 1024 * 0.86
    ox = big * inset + (big * (1 - 2 * inset) - 1024 * scale) / 2
    oy = big * inset + (big * (1 - 2 * inset) - 1024 * scale) / 2 + big * 0.02
    _cup(draw, scale, ox, oy)
    return img.resize((size, size), Image.LANCZOS)


def render_foreground(size: int, *, mono: bool = False) -> Image.Image:
    """Adaptive-icon foreground: the cup inside the 66 % safe zone, transparent field."""
    big = size * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    safe = big * 0.62
    scale = safe / 1024
    ox = (big - 1024 * scale) / 2
    oy = (big - 1024 * scale) / 2 + big * 0.015
    _cup(draw, scale, ox, oy, mono=mono)
    return img.resize((size, size), Image.LANCZOS)


def render_status_icon(size: int) -> Image.Image:
    """Notification small icon: white silhouette, Android tints it."""
    big = size * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    scale = big * 0.92 / 1024
    ox = (big - 1024 * scale) / 2
    oy = (big - 1024 * scale) / 2 - big * 0.06
    _cup(draw, scale, ox, oy, mono=True)
    return img.resize((size, size), Image.LANCZOS)


def render_logo(size: int) -> Image.Image:
    """Launch-screen mark: caramel cup on transparent."""
    big = size * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    scale = big / 1024
    _cup(draw, scale, 0, 0, body=CARAMEL + (255,), lid=CARAMEL_DARK + (255,), sleeve=(90, 52, 24, 255),
         steam=CARAMEL + (140,))
    return img.resize((size, size), Image.LANCZOS)


def save(img: Image.Image, path: Path, *, rgb: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if rgb:
        background = Image.new('RGB', img.size, CARAMEL)
        background.paste(img, mask=img.split()[3])
        img = background
    img.save(path, optimize=True)
    print('wrote', path.relative_to(ROOT))


def main() -> None:
    res = ROOT / 'android' / 'app' / 'src' / 'main' / 'res'
    densities = {'mdpi': 1.0, 'hdpi': 1.5, 'xhdpi': 2.0, 'xxhdpi': 3.0, 'xxxhdpi': 4.0}
    for name, factor in densities.items():
        folder = res / f'mipmap-{name}'
        save(render_icon(round(48 * factor), full_bleed=False, rounded=True), folder / 'ic_launcher.png')
        save(render_foreground(round(108 * factor)), folder / 'ic_launcher_foreground.png')
        save(render_foreground(round(108 * factor), mono=True), folder / 'ic_launcher_monochrome.png')
        save(render_logo(round(120 * factor)), res / f'drawable-{name}' / 'splash_logo.png')
        save(render_status_icon(round(24 * factor)), res / f'drawable-{name}' / 'ic_stat_takeaway.png')

    ios = ROOT / 'ios' / 'Runner' / 'Assets.xcassets'
    icon_sizes = {
        'Icon-App-20x20@1x.png': 20, 'Icon-App-20x20@2x.png': 40, 'Icon-App-20x20@3x.png': 60,
        'Icon-App-29x29@1x.png': 29, 'Icon-App-29x29@2x.png': 58, 'Icon-App-29x29@3x.png': 87,
        'Icon-App-40x40@1x.png': 40, 'Icon-App-40x40@2x.png': 80, 'Icon-App-40x40@3x.png': 120,
        'Icon-App-60x60@2x.png': 120, 'Icon-App-60x60@3x.png': 180,
        'Icon-App-76x76@1x.png': 76, 'Icon-App-76x76@2x.png': 152,
        'Icon-App-83.5x83.5@2x.png': 167, 'Icon-App-1024x1024@1x.png': 1024,
    }
    for filename, px in icon_sizes.items():
        # App Store rejects icons with an alpha channel; iOS applies its own mask.
        save(render_icon(px, full_bleed=True, rounded=False), ios / 'AppIcon.appiconset' / filename, rgb=True)

    for filename, px in {'LaunchImage.png': 120, 'LaunchImage@2x.png': 240, 'LaunchImage@3x.png': 360}.items():
        save(render_logo(px), ios / 'LaunchImage.imageset' / filename)


if __name__ == '__main__':
    os.chdir(ROOT)
    main()
