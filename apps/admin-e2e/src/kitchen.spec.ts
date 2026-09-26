import { expect, test } from '@playwright/test';

import { STORE, installFakeApi, signIn } from './support/fake-api';

/**
 * The kitchen board inside the cabinet: the three columns of the old KDS
 * app, one button per ticket, and "Accept" going to the kitchen endpoint —
 * the one that charges a card held at checkout.
 */

const soon = () => new Date(Date.now() + 10 * 60_000).toISOString();

const ORDERS = [
  {
    id: 'order-new',
    orderCode: 'A12',
    status: 'PAID',
    pickupMode: 'ASAP',
    pickupAt: soon(),
    createdAt: new Date().toISOString(),
    customerName: 'Ира',
    notes: null,
    items: [
      {
        quantity: 2,
        productSnapshot: {
          name: 'Капучино',
          variations: [{ id: 'v1', name: '300 мл', priceDeltaCents: 0 }],
          modifiers: [],
          notes: 'без сахара',
        },
      },
    ],
  },
  {
    id: 'order-cooking',
    orderCode: 'B07',
    status: 'IN_PROGRESS',
    pickupMode: 'SCHEDULED',
    pickupAt: soon(),
    createdAt: new Date().toISOString(),
    customerName: null,
    notes: 'Позвонить у двери',
    items: [{ quantity: 1, productSnapshot: { name: 'Латте' } }],
  },
];

test.describe('kitchen board', () => {
  test('shows the columns and accepts through the kitchen endpoint', async ({ context, page }) => {
    await signIn(context);
    await installFakeApi(context);
    const accepted: string[] = [];
    await context.route('**/api/kds/orders**', async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'POST') {
        accepted.push(`${url.pathname}?${url.searchParams.toString()}`);
        return route.fulfill({ status: 201, contentType: 'application/json', body: '{"status":"ACCEPTED"}' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORDERS) });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/kitchen');

    await expect(page.getByRole('heading', { name: 'Кухня' })).toBeVisible();
    const newColumn = page.getByRole('region', { name: 'Новые' });
    await expect(newColumn.getByText('A12')).toBeVisible();
    await expect(newColumn.getByText('Капучино')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Готовятся' }).getByText('B07')).toBeVisible();

    // The sidebar counts the order nobody has accepted yet.
    await expect(page.locator('.admin-nav-badge-live')).toHaveText('1');

    await page.screenshot({ path: test.info().outputPath('kitchen-board.png'), fullPage: true });

    await newColumn.getByRole('button', { name: 'Принять' }).click();
    await expect.poll(() => accepted).toEqual([`/api/kds/orders/order-new/accept?storeId=${STORE.id}`]);
  });
});
