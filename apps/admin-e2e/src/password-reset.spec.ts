import { expect, test } from '@playwright/test';

import { installFakeApi } from './support/fake-api';

/**
 * «Забыли пароль?» for staff signed out of the cabinet: ask with a login,
 * be told to look in Telegram (the fake server has the bot but no SMTP),
 * then set the new password from the link the bot sent.
 */

test.beforeEach(async ({ context }) => {
  await installFakeApi(context);
});

test('a login-only barista asks for a link and is pointed to Telegram, not to an inbox', async ({ page }) => {
  await page.goto('/forgot-password');
  await expect(page.getByRole('heading', { name: 'Восстановление пароля' })).toBeVisible();
  await expect(page.getByTestId('forgot-no-channel-hint')).toContainText('поддержка takeAway');

  const request = page.waitForRequest('**/api/auth/password/forgot');
  await page.getByLabel('Почта или логин').fill('Ion.Barista');
  await page.getByRole('button', { name: 'Отправить ссылку' }).click();
  expect((await request).postDataJSON()).toEqual({ identifier: 'ion.barista' });

  const sent = page.getByTestId('forgot-sent');
  await expect(sent).toContainText('мы отправили ссылку в чат с ботом takeAway');
  await expect(sent).not.toContainText('Спам');
  await page.screenshot({ path: test.info().outputPath('forgot-sent.png') });
});

test('the link from the bot opens the new-password form and sets it', async ({ page }) => {
  const token = 'Abc_def-123456789012345678901234567890123';
  await page.goto(`/reset-password?token=${token}`);
  await expect(page.getByRole('heading', { name: 'Новый пароль' })).toBeVisible();

  const request = page.waitForRequest('**/api/auth/password/reset');
  await page.getByLabel('Новый пароль').fill('a-brand-new-password');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  expect((await request).postDataJSON()).toEqual({ token, newPassword: 'a-brand-new-password' });
  await expect(page.getByText('Пароль обновлён')).toBeVisible();
});
