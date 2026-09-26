import { expect, test } from '@playwright/test';

import { CATEGORY, PRODUCT, STORE, installFakeApi, signIn } from './support/fake-api';

/**
 * Every add/edit screen in the admin, at the widths people actually run it.
 *
 * An admin editing a store reported that half of the form was missing: the
 * right-hand column — country, e-mail, longitude — was cut off by the edge
 * of the card it lived in. The cause was not that one form: an `<input>`
 * carries an intrinsic width of about 180px, and neither a grid track nor a
 * flex item shrinks below the width of what is inside it, so any two
 * controls side by side in a narrow container pushed the row wider than the
 * container rather than stacking. The same shape appeared wherever a form
 * sat in a card — which, at the time, was everywhere.
 *
 * Those forms now live on routes of their own, so the suite walks the
 * routes. It asserts the same two things about each of them: no control is
 * clipped by something above it, and no container holds content wider than
 * itself. That is the user-visible property, and it is the one that
 * regressed.
 */

/** Pages that list something. */
const LIST_ROUTES = [
  'dashboard',
  'menu',
  'stores',
  'orders',
  'dispatch',
  'riders',
  'staff',
  'promo',
  'gift-cards',
  'campaigns',
  'analytics',
  'brands',
  'settings',
  'integrations',
] as const;

/** Pages that are a form. */
const FORM_ROUTES = [
  'stores/new',
  `stores/${STORE.id}`,
  `stores/${STORE.id}?tab=hours`,
  `stores/${STORE.id}?tab=photos`,
  `stores/${STORE.id}?tab=kitchen`,
  'menu/categories/new',
  `menu/categories/${CATEGORY.id}`,
  'menu/products/new',
  `menu/products/${PRODUCT.id}`,
  `menu/products/${PRODUCT.id}/options`,
  'promo/new',
  'gift-cards/new',
  'campaigns/new',
  'brands/new',
  'staff/add',
  'staff/owner',
  'riders/add',
] as const;

/**
 * 1440 is a laptop; 1100 is the same laptop with the window not maximised,
 * and it is where the menu page used to scroll its whole column sideways.
 */
const WIDTHS = [1440, 1100] as const;

/** Controls hidden behind an ancestor that clips or scrolls its overflow. */
async function clippedControls(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector =
      'form input, form select, form textarea, form button, app-form-page > section > div:last-of-type > *';
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      const name =
        el.getAttribute('formcontrolname') ??
        el.getAttribute('placeholder') ??
        (el.textContent ?? '').trim().slice(0, 16);
      const label = `${el.tagName.toLowerCase()}[${name}]`;
      if (box.right > window.innerWidth + 1 || box.left < -1) {
        bad.push(`${label} runs off the window`);
        continue;
      }
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const parentBox = parent.getBoundingClientRect();
        if (box.right > parentBox.right + 1 || box.left < parentBox.left - 1) {
          bad.push(`${label} is cut off by <${parent.tagName.toLowerCase()}>`);
          break;
        }
      }
    }
    return Array.from(new Set(bad));
  });
}

/**
 * Containers holding content wider than themselves. Anything that opts into
 * scrolling is excluded — a wide table in its own scroller is a choice, a
 * card whose fields spill over its border is not.
 */
async function overflowingContainers(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    const selector = 'form, .form-row, [class*="grid"], article, section, aside, div[style*="grid-template-columns"]';
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const style = getComputedStyle(el);
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
        bad.push(`<${el.tagName.toLowerCase()}> holds ${el.scrollWidth}px of content in ${el.clientWidth}px`);
      }
    }
    return Array.from(new Set(bad));
  });
}

/**
 * Waits until the page stops growing controls. The fake API answers
 * instantly, so two identical readings in a row mean the render that its
 * answers triggered has landed.
 */
async function settled(page: import('@playwright/test').Page): Promise<void> {
  let previous = -1;
  await expect
    .poll(
      async () => {
        const count = await page.locator('input, select, textarea, button').count();
        const stable = count === previous;
        previous = count;
        return stable;
      },
      { timeout: 15_000, intervals: [200, 200, 200] },
    )
    .toBe(true);
}

for (const width of WIDTHS) {
  test.describe(`admin at ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } });

    for (const route of [...LIST_ROUTES, ...FORM_ROUTES]) {
      test(`${route} keeps every field inside its card`, async ({ page, context }) => {
        await signIn(context);
        await installFakeApi(context);

        await page.goto(`/${route}`);
        await settled(page);

        expect(await clippedControls(page)).toEqual([]);
        expect(await overflowingContainers(page)).toEqual([]);
      });
    }
  });
}

test.describe('forms are reachable from the lists that own them', () => {
  test.use({ viewport: { width: 1100, height: 1000 } });

  const LINKS: Array<[list: string, form: string]> = [
    ['stores', '/stores/new'],
    ['menu', '/menu/categories/new'],
    ['menu', '/menu/products/new'],
    ['promo', '/promo/new'],
    ['gift-cards', '/gift-cards/new'],
    ['campaigns', '/campaigns/new'],
    ['brands', '/brands/new'],
  ];

  for (const [list, form] of LINKS) {
    test(`${list} links to ${form}`, async ({ page, context }) => {
      await signIn(context);
      await installFakeApi(context);

      await page.goto(`/${list}`);
      await settled(page);

      await expect(page.locator(`a[href^="${form}"]`).first()).toBeVisible();
    });
  }
});
