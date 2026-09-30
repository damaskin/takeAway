import { expect, test } from '@playwright/test';

import { installFakeApi, signIn } from './support/fake-api';

/**
 * The admin as an app: the top bar and the sidebar stay put while the page
 * under them scrolls, the sidebar is a drawer on a phone, and the browser
 * finds what it needs to install the cabinet.
 */

test.beforeEach(async ({ context }) => {
  await signIn(context);
  await installFakeApi(context);
});

test('the top bar and the full-height sidebar stay put while the page scrolls', async ({ page }) => {
  // Short enough that the staff page is taller than the window.
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'Сотрудники' })).toBeVisible();

  const main = page.locator('main.admin-main');
  const scrollable = await main.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrollable).toBe(true);

  await main.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  // Only <main> scrolls: the document itself is exactly one window tall.
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(520);

  const bar = await page.locator('.admin-topbar').boundingBox();
  expect(bar?.y).toBe(0);
  const aside = await page.locator('app-admin-sidebar aside').boundingBox();
  expect(aside?.y).toBe(0);
  expect(aside?.height).toBe(520);
  await page.screenshot({ path: test.info().outputPath('desktop-scrolled.png') });

  // A new page opens at its top, not wherever the last one was scrolled to.
  await page.locator('app-admin-sidebar').getByRole('link', { name: 'Меню' }).click();
  await expect(page).toHaveURL(/\/menu$/);
  expect(await main.evaluate((el) => el.scrollTop)).toBe(0);
});

test('on a phone the sidebar is a drawer behind the menu button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'Сотрудники' })).toBeVisible();

  const sidebar = page.locator('app-admin-sidebar');
  const burger = page.locator('.admin-burger');
  await expect(burger).toBeVisible();
  await expect(sidebar).toBeHidden();
  await expect(burger).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: test.info().outputPath('phone.png') });

  await burger.click();
  await expect(sidebar).toBeVisible();
  await expect(burger).toHaveAttribute('aria-expanded', 'true');
  // Let the slide-in finish so the screenshot shows the open drawer.
  await expect.poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().left)).toBe(0);
  await page.screenshot({ path: test.info().outputPath('phone-drawer.png') });

  // Following a link closes the drawer.
  await sidebar.getByRole('link', { name: 'Меню' }).click();
  await expect(page).toHaveURL(/\/menu$/);
  await expect(sidebar).toBeHidden();

  // So do the backdrop and Escape.
  await burger.click();
  await expect(sidebar).toBeVisible();
  await page.locator('.admin-backdrop').click({ position: { x: 370, y: 400 } });
  await expect(sidebar).toBeHidden();
  await burger.click();
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();

  // The top bar stays pinned on a phone as well.
  await page.locator('main.admin-main').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  expect((await page.locator('.admin-topbar').boundingBox())?.y).toBe(0);
});

test('the browser finds a manifest, icons and a service worker to install the cabinet', async ({ page, request }) => {
  await page.goto('/staff');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');

  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toMatch(/^\//);
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const icon of manifest.icons) {
    const res = await request.get(icon.src);
    expect(res.ok(), icon.src).toBe(true);
    expect(res.headers()['content-type']).toContain('image/png');
  }

  const worker = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.scriptURL ?? null;
  });
  expect(worker).toMatch(/\/sw\.js$/);
});
