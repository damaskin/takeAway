/**
 * Regenerates every favicon, PWA icon and SVG logo of the web, TMA and admin
 * apps from the single source mark in `tools/brand/mark.svg`.
 *
 *   pnpm brand:icons        (CHROMIUM_PATH=... to use a system Chromium)
 *
 * Rasterises with Playwright's Chromium (already a dev dependency for e2e),
 * so no image library is needed. Output is committed; re-run only when the
 * mark or the colours change.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mark = readFileSync(join(root, 'tools/brand/mark.svg'), 'utf8');

const CARAMEL = '#C77D3B';
const CREAM = '#F8F3EB';
const ESPRESSO = '#1A1414';

/** The mark's own viewBox is 75 × 100; place it centred on a square canvas. */
function markOnSquare({ background, color, markHeight, radius = 0 }) {
  const h = markHeight;
  const w = (h * 75) / 100;
  const inner = mark
    .replace(/<svg[^>]*>/, '')
    .replace('</svg>', '')
    .trim();
  const bg = background ? `<rect width="100" height="100" rx="${radius}" fill="${background}" />` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  ${bg}
  <svg x="${(100 - w) / 2}" y="${(100 - h) / 2}" width="${w}" height="${h}" viewBox="0 0 75 100" fill="${color}" stroke="${color}" stroke-width="2.9" stroke-linejoin="round">
    ${inner.replace(/\n\s*/g, '\n    ')}
  </svg>
</svg>
`;
}

const recolor = (svg, color) => svg.replaceAll(CARAMEL, color);

/**
 * Per app: the tile colours for installed icons. Customer apps sit on cream,
 * the business cabinet on espresso so the two are told apart on a home screen.
 */
const apps = {
  web: { background: CREAM, color: CARAMEL, pwa: true },
  tma: { background: CREAM, color: CARAMEL, pwa: false },
  admin: { background: ESPRESSO, color: CARAMEL, pwa: true },
};

/** A .ico holding PNG images (supported by every browser since IE Vista). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();

async function png(svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">
      <img style="display:block;width:${size}px;height:${size}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">
    </body></html>`,
  );
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

function write(path, data) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  console.log('wrote', path);
}

// Favicon: the bare mark on a transparent tile, filling as much as it can.
const favicon = markOnSquare({ color: CARAMEL, markHeight: 96 });

for (const [app, { background, color, pwa }] of Object.entries(apps)) {
  const pub = `apps/${app}/public`;
  write(`${pub}/logo.svg`, recolor(mark, color));
  write(`${pub}/favicon.svg`, favicon);
  write(
    `${pub}/favicon.ico`,
    ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(favicon, size) })))),
  );
  if (!pwa) continue;
  const any = markOnSquare({ background, color, markHeight: 62 });
  // Maskable icons get cropped to as little as a circle of 80% diameter.
  const maskable = markOnSquare({ background, color, markHeight: 48 });
  write(`${pub}/icons/icon-192.png`, await png(any, 192));
  write(`${pub}/icons/icon-512.png`, await png(any, 512));
  write(`${pub}/icons/apple-touch-icon.png`, await png(any, 180));
  write(`${pub}/icons/maskable-192.png`, await png(maskable, 192));
  write(`${pub}/icons/maskable-512.png`, await png(maskable, 512));
}

// Square avatar for the Telegram bot (set by hand in @BotFather).
write(
  'tools/brand/telegram-avatar.png',
  await png(markOnSquare({ background: CREAM, color: CARAMEL, markHeight: 56 }), 640),
);

await browser.close();
