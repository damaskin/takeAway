import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { TelegramBotApi } from './telegram-bot-api.service';
import { TelegramWebhookRegistrar } from './telegram-webhook-registrar.service';

const CONFIGURED = {
  NODE_ENV: 'production',
  TELEGRAM_BOT_TOKEN: '123:abc',
  TELEGRAM_WEBHOOK_URL: 'https://api.takeaway.md/api/telegram/webhook',
  TELEGRAM_WEBHOOK_SECRET: 'b'.repeat(40),
};

function registrar(env: Record<string, string>) {
  const bot = { setWebhook: jest.fn().mockResolvedValue(undefined) };
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return { registrar: new TelegramWebhookRegistrar(config, bot as unknown as TelegramBotApi), bot };
}

describe('TelegramWebhookRegistrar', () => {
  let quiet: jest.SpyInstance[];
  beforeEach(() => {
    quiet = (['log', 'warn', 'error'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
  });
  afterEach(() => quiet.forEach((spy) => spy.mockRestore()));

  it('registers the webhook with its secret, asking for messages only', async () => {
    const { registrar: r, bot } = registrar(CONFIGURED);
    await expect(r.register()).resolves.toBe(true);
    expect(bot.setWebhook).toHaveBeenCalledWith(CONFIGURED.TELEGRAM_WEBHOOK_URL, CONFIGURED.TELEGRAM_WEBHOOK_SECRET);
  });

  it('calls nothing without TELEGRAM_WEBHOOK_URL — the default, and every developer machine', async () => {
    const env: Record<string, string> = { ...CONFIGURED };
    delete env['TELEGRAM_WEBHOOK_URL'];
    const { registrar: r, bot } = registrar(env);
    await expect(r.register()).resolves.toBe(false);
    expect(bot.setWebhook).not.toHaveBeenCalled();
  });

  it.each([
    ['outside production', { NODE_ENV: 'development' }],
    ['without a secret', { TELEGRAM_WEBHOOK_SECRET: '' }],
    ['with a secret Telegram would refuse', { TELEGRAM_WEBHOOK_SECRET: 'has spaces in it, too short?' }],
    ['to a plain-http address', { TELEGRAM_WEBHOOK_URL: 'http://api.takeaway.md/api/telegram/webhook' }],
    ['without a bot token', { TELEGRAM_BOT_TOKEN: '' }],
  ])('does not register %s', async (_label, patch: Record<string, string>) => {
    const { registrar: r, bot } = registrar({ ...CONFIGURED, ...patch });
    await expect(r.register()).resolves.toBe(false);
    expect(bot.setWebhook).not.toHaveBeenCalled();
  });

  it('keeps the API running when Telegram refuses', async () => {
    const { registrar: r, bot } = registrar(CONFIGURED);
    bot.setWebhook.mockRejectedValueOnce(new Error('Telegram setWebhook 401: Unauthorized'));
    await expect(r.register()).resolves.toBe(false);
  });
});
