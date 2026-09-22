import { expect, test } from '@playwright/test';

import { installFakeApi, signIn } from './support/fake-api';

/**
 * Every add/edit form in the admin, at the widths people actually run it.
 *
 * An admin editing a store reported that half of the form was missing: the
 * right-hand column — country, e-mail, longitude — was cut off by the edge
 * of the card it lived in. The cause was not that one form: an `<input>`
 * carries an intrinsic width of about 180px, and neither a grid track nor a
 * flex item shrinks below the width of what is inside it, so any two
 * controls side by side in a narrow container pushed the row wider than the
 * container rather than stacking. The same shape appeared wherever a form
 * sat in a card.
 *
 * So this suite does not assert on one layout. It opens every add/edit form
 * the admin has and asserts the same two things about all of them: no
 * control is clipped by something above it, and no container holds content
 * wider than itself. That is the user-visible property, and it is the one
 * that regressed.
 */

const PAGES = [
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

/**
 * 1440 is a laptop; 1100 is the same laptop with the window not maximised,
 * and it is where the menu page used to scroll its whole column sideways.
 */
const WIDTHS = [1440, 1100] as const;

/** Labels of the buttons that reveal a form. Matched against the RU bundle. */
const OPENS_A_FORM = /Добавить|Создать|Новый|Новая|Новое|Редактировать|Изменить|Пригласить|Выпустить/;

/** Controls hidden behind an ancestor that clips or scrolls its overflow. */
async function clippedControls(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll('form input, form select, form textarea, form button'))) {
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

/**
 * Clicks everything that opens a form, re-reading the page after each click:
 * revealing one form re-renders the tree and detaches every handle taken
 * before it.
 */
async function openEveryForm(page: import('@playwright/test').Page): Promise<void> {
  const clicked = new Set<string>();
  for (let pass = 0; pass < 8; pass++) {
    const buttons = await page.getByRole('button').all();
    let didClick = false;
    for (const button of buttons) {
      const label = ((await button.textContent().catch(() => '')) ?? '').trim();
      if (!label || clicked.has(label) || !OPENS_A_FORM.test(label)) continue;
      clicked.add(label);
      await button.click({ timeout: 2000 }).catch(() => undefined);
      didClick = true;
      await settled(page);
      break;
    }
    if (!didClick) return;
  }
}

for (const width of WIDTHS) {
  test.describe(`admin forms at ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } });

    for (const route of PAGES) {
      test(`${route} keeps every field inside its card`, async ({ page, context }) => {
        await signIn(context);
        await installFakeApi(context);

        await page.goto(`/${route}`);
        await settled(page);
        await openEveryForm(page);
        await settled(page);

        expect(await clippedControls(page)).toEqual([]);
        expect(await overflowingContainers(page)).toEqual([]);
      });
    }
  });
}
