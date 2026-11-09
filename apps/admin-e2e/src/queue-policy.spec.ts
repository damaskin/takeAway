import { expect, test } from '@playwright/test';

import { STORE, installFakeApi, signIn } from './support/fake-api';

/**
 * The order queue policy in the cabinet (docs/queue-policy.md): the store's
 * «Загрузка: +N мин» next to «Позиций готовится одновременно», and the
 * kitchen board's «готов к 12:11 · начать в 12:05» from the queue.
 */

/** HH:MM on the store's clock (Europe/Chisinau) of an instant, rounded up to the minute. */
function storeClock(at: number): string {
  const minute = Math.ceil(at / 60_000) * 60_000;
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: STORE.timezone,
  }).format(new Date(minute));
}

test.describe('order queue policy', () => {
  test('the kitchen board shows when the queue has an order ready and when to start it', async ({ context, page }) => {
    await signIn(context);
    await installFakeApi(context);
    const start = Date.now() + 5 * 60_000;
    const ready = Date.now() + 11 * 60_000 + 20_000;
    await context.route('**/api/kds/orders**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'order-queued',
            orderCode: 'Q11',
            status: 'ACCEPTED',
            pickupMode: 'ASAP',
            pickupAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            createdAt: new Date().toISOString(),
            customerName: 'Ира',
            notes: null,
            startBy: new Date(start).toISOString(),
            plannedReadyAt: new Date(ready).toISOString(),
            awaitingSince: null,
            acceptAlertAt: null,
            acceptDeadlineAt: null,
            items: [{ quantity: 2, productSnapshot: { name: 'Американо' } }],
          },
        ]),
      }),
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/kitchen');

    await expect(page.getByTestId('ticket-planned')).toHaveText(
      `готов к ${storeClock(ready)} · начать в ${storeClock(start - 59_999)}`,
    );
  });

  test('the store editor sets «Загрузка: +N мин» in whole minutes', async ({ context, page }) => {
    await signIn(context);
    await installFakeApi(context);
    const saved: Array<Record<string, unknown>> = [];
    await context.route(`**/api/admin/stores/${STORE.id}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        saved.push(body);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...STORE, ...body }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...STORE, kitchenParallelism: 2, loadExtraSeconds: 900 }),
      });
    });

    await page.goto(`/stores/${STORE.id}`);

    const field = page.getByTestId('store-load-extra-minutes');
    await expect(field).toHaveValue('15');
    await expect(page.getByText('Загрузка: +N мин')).toBeVisible();

    await field.fill('5');
    await page.getByRole('button', { name: 'Сохранить' }).first().click();
    await expect.poll(() => saved.at(-1)?.['loadExtraSeconds']).toBe(300);
  });
});
