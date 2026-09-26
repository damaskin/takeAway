"""Regenerates every launcher icon, splash mark and notification icon of the
app from one image of the brand mark.

    python tool/generate_icons.py [path/to/mark.png]

The source is the square logo artwork: the caramel mark on a light
background (default: tool/brand/mark-source.jpg; the full logo with the
wordmark is next to it, tool/brand/logo-full.jpg). The mark is lifted out by
colour — caramel against cream — so paper texture and JPEG noise stay behind,
its edges are redrawn smooth, and it is painted in the brand colours below
rather than the artwork's own, which are a shade off.

Needs Pillow and numpy. Writes into ios/ and android/ in place; review the
diff and commit the result together with any change to the source.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
APP = HERE.parent
IOS_ICONS = APP / 'ios/Runner/Assets.xcassets/AppIcon.appiconset'
IOS_LAUNCH = APP / 'ios/Runner/Assets.xcassets/LaunchImage.imageset'
RES = APP / 'android/app/src/main/res'

CARAMEL = (0xC7, 0x7D, 0x3B)  # brand_caramel
CREAM = (0xF8, 0xF3, 0xEB)  # brand_cream
WHITE = (0xFF, 0xFF, 0xFF)

DENSITIES = {'mdpi': 1.0, 'hdpi': 1.5, 'xhdpi': 2.0, 'xxhdpi': 3.0, 'xxxhdpi': 4.0}


def extract_mark(source: Path) -> Image.Image:
    """The mark as an 8-bit alpha mask, cropped to its bounds."""
    rgb = np.asarray(Image.open(source).convert('RGB')).astype(np.float32)
    # Caramel and cream differ most in red minus blue (≈133 vs ≈18); texture
    # and JPEG noise move it by a few units, so a band either side of the
    # midpoint turns it into coverage without picking the noise up.
    rb = rgb[..., 0] - rgb[..., 2]
    lo, hi = np.percentile(rb, 20), np.percentile(rb, 99)
    span = hi - lo
    alpha = np.clip((rb - (lo + 0.25 * span)) / (0.5 * span), 0.0, 1.0)

    # Redraw the edges: at twice the size, soften, then cut again with a
    # narrow ramp — smooth, anti-aliased contours instead of JPEG steps.
    mask = Image.fromarray((alpha * 255).astype(np.uint8), 'L')
    big = mask.resize((mask.width * 2, mask.height * 2), Image.BICUBIC).filter(ImageFilter.GaussianBlur(3))
    a = np.asarray(big).astype(np.float32) / 255.0
    a = np.clip((a - 0.42) / 0.16, 0.0, 1.0)
    a = a * a * (3 - 2 * a)
    clean = Image.fromarray((a * 255).astype(np.uint8), 'L').resize(mask.size, Image.LANCZOS)

    bbox = clean.point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox is None:
        raise SystemExit(f'No mark found in {source}')
    return clean.crop(bbox)


def painted(mask: Image.Image, color: tuple[int, int, int]) -> Image.Image:
    layer = Image.new('RGBA', mask.size, color + (0,))
    layer.putalpha(mask)
    return layer


def mark_on_canvas(mask: Image.Image, size: int, height_ratio: float, color, background=None) -> Image.Image:
    """The mark centred on a square canvas, `height_ratio` of it tall."""
    h = round(size * height_ratio)
    w = round(h * mask.width / mask.height)
    mark = painted(mask.resize((w, h), Image.LANCZOS), color)
    canvas = Image.new('RGBA', (size, size), (background or color) + ((255,) if background else (0,)))
    canvas.alpha_composite(mark, ((size - w) // 2, (size - h) // 2))
    return canvas


def rounded_square(size: int, radius_ratio: float) -> Image.Image:
    """Mask of a rounded square, drawn big and scaled down for a smooth edge."""
    big = size * 4
    m = Image.new('L', (big, big), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, big - 1, big - 1), radius=round(big * radius_ratio), fill=255)
    return m.resize((size, size), Image.LANCZOS)


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'brand' / 'mark-source.jpg'
    mask = extract_mark(source)

    # iOS: the store and home-screen icon has no transparency — cream field,
    # caramel mark. 58% of the height reads at 60 pt without crowding.
    master = mark_on_canvas(mask, 1024, 0.58, CARAMEL, CREAM).convert('RGB')
    contents = json.loads((IOS_ICONS / 'Contents.json').read_text(encoding='utf-8'))
    for image in contents['images']:
        points = float(image['size'].split('x')[0])
        px = round(points * int(image['scale'].rstrip('x')))
        master.resize((px, px), Image.LANCZOS).save(IOS_ICONS / image['filename'], optimize=True)

    # iOS launch screen: the mark alone, on the storyboard's cream.
    for scale, name in ((1, 'LaunchImage.png'), (2, 'LaunchImage@2x.png'), (3, 'LaunchImage@3x.png')):
        mark_on_canvas(mask, 120 * scale, 0.8, CARAMEL).save(IOS_LAUNCH / name, optimize=True)

    for density, k in DENSITIES.items():
        folder = RES / f'mipmap-{density}'
        # Adaptive icon (API 26+): the cream background is a colour resource;
        # the mark sits inside the 66 dp safe circle of the 108 dp layer.
        layer = round(108 * k)
        mark_on_canvas(mask, layer, 0.48, CARAMEL).save(folder / 'ic_launcher_foreground.png', optimize=True)
        # Themed icon (Android 13): one colour, the launcher tints it.
        mark_on_canvas(mask, layer, 0.48, WHITE).save(folder / 'ic_launcher_monochrome.png', optimize=True)
        # Legacy launchers get the whole icon, shape included.
        size = round(48 * k)
        legacy = mark_on_canvas(mask, size, 0.58, CARAMEL, CREAM)
        legacy.putalpha(rounded_square(size, 0.22))
        legacy.save(folder / 'ic_launcher.png', optimize=True)

        drawables = RES / f'drawable-{density}'
        # Pre-Android 12 splash: the mark on the launch background.
        mark_on_canvas(mask, round(120 * k), 0.8, CARAMEL).save(drawables / 'splash_logo.png', optimize=True)
        # Status bar: a white silhouette; the system colours it.
        mark_on_canvas(mask, round(24 * k), 0.84, WHITE).save(drawables / 'ic_stat_takeaway.png', optimize=True)

    print(f'mark {mask.width}x{mask.height} from {source.name}: iOS icons, launch image, Android icons and splash written')


if __name__ == '__main__':
    main()
