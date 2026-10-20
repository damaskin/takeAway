import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { MemoryRedis } from '../auth/services/testing/memory-redis';
import type { TelegramBotApi } from './telegram-bot-api.service';
import type { TelegramNotifyLinkService } from './telegram-notify-link.service';
import { BOT_REPLIES_PER_MINUTE, BOT_TEXT, TelegramWebhookService } from './telegram-webhook.service';

const SECRET = 'webhook-secret-0123456789abcdef';

function setup(env: Record<string, string> = { TELEGRAM_WEBHOOK_SECRET: SECRET }) {
  const redis = new MemoryRedis();
  const bot = { sendMessage: jest.fn().mockResolvedValue(true) };
  const links = {
    consume: jest.fn(async (code: string) =>
      code === 'GoodCode0123456789abcd' ? { userId: 'barista', name: 'Ира' } : null,
    ),
  };
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const service = new TelegramWebhookService(
    config,
    redis.asService(),
    bot as unknown as TelegramBotApi,
    links as unknown as TelegramNotifyLinkService,
  );
  return { service, bot, links, redis };
}

/** A private message as Telegram posts it. */
const message = (text: string, chat: { id: number; type: string } = { id: 4242, type: 'private' }) => ({
  update_id: 1,
  message: { message_id: 7, date: 0, chat, from: { id: chat.id, is_bot: false, first_name: 'Ира' }, text },
});

describe('TelegramWebhookService', () => {
  describe('the secret', () => {
    it('lets in only the request with the secret Telegram was given', () => {
      const { service } = setup();
      expect(() => service.assertFromTelegram(SECRET)).not.toThrow();
      for (const wrong of [undefined, '', 'nope', `${SECRET}x`]) {
        const error = (() => {
          try {
            service.assertFromTelegram(wrong);
            return null;
          } catch (e) {
            return e as HttpException;
          }
        })();
        expect(error?.getStatus()).toBe(401);
      }
    });

    it('is not there at all without a configured secret', () => {
      const { service } = setup({});
      expect(() => service.assertFromTelegram(SECRET)).toThrow(NotFoundException);
      // A secret too short for Telegram counts as none.
      expect(() => setup({ TELEGRAM_WEBHOOK_SECRET: 'short' }).service.assertFromTelegram('short')).toThrow(
        NotFoundException,
      );
    });
  });

  it('links the chat with /start link_<code> and says so in Russian', async () => {
    const { service, bot, links } = setup();
    await service.handle(message('/start link_GoodCode0123456789abcd'));

    expect(links.consume).toHaveBeenCalledWith('GoodCode0123456789abcd', 4242n);
    expect(bot.sendMessage).toHaveBeenCalledWith(4242n, BOT_TEXT.linked('Ира'));
    expect(BOT_TEXT.linked('Ира')).toBe(
      'Готово! Уведомления о заказах для «Ира» будут приходить сюда.\nОтключить — на странице «Telegram» в кабинете.',
    );
  });

  it('says a used or expired link is stale', async () => {
    const { service, bot } = setup();
    await service.handle(message('/start link_OldCode0123456789abcdef'));
    expect(bot.sendMessage).toHaveBeenCalledWith(4242n, BOT_TEXT.linkStale);
  });

  it('greets a plain /start, or one with an unknown payload, with a button that opens the Mini App', async () => {
    const { service, bot } = setup({ TELEGRAM_WEBHOOK_SECRET: SECRET, PUBLIC_TMA_URL: 'https://tma.takeaway.md' });
    await service.handle(message('/start'));
    await service.handle(message('/start campaign42'));
    await service.handle(message('/start@takaway_tgbot'));

    expect(bot.sendMessage).toHaveBeenCalledTimes(3);
    for (const call of bot.sendMessage.mock.calls) {
      expect(call).toEqual([
        4242n,
        BOT_TEXT.greeting,
        { inline_keyboard: [[{ text: BOT_TEXT.openMiniApp, web_app: { url: 'https://tma.takeaway.md' } }]] },
      ]);
    }
  });

  it('greets without a button when no Mini App address is configured', async () => {
    const { service, bot } = setup();
    await service.handle(message('/start'));
    expect(bot.sendMessage).toHaveBeenCalledWith(4242n, BOT_TEXT.greeting, undefined);
  });

  it('ignores everything else: other text, groups, edits, junk', async () => {
    const { service, bot, links } = setup();
    await service.handle(message('привет'));
    await service.handle(message('/help'));
    await service.handle(message('/start link_GoodCode0123456789abcd', { id: -100, type: 'group' }));
    await service.handle({ update_id: 2, edited_message: message('/start').message });
    await service.handle({ update_id: 3, message: { chat: { id: 'x', type: 'private' }, text: '/start' } });
    await service.handle(null);
    await service.handle('junk');
    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(links.consume).not.toHaveBeenCalled();
  });

  it(`answers one chat at most ${BOT_REPLIES_PER_MINUTE} times a minute`, async () => {
    const { service, bot, redis } = setup();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    for (let i = 0; i < BOT_REPLIES_PER_MINUTE + 3; i++) await service.handle(message('/start'));
    expect(bot.sendMessage).toHaveBeenCalledTimes(BOT_REPLIES_PER_MINUTE);
    // Another chat is not held up.
    await service.handle(message('/start', { id: 1, type: 'private' }));
    expect(bot.sendMessage).toHaveBeenCalledTimes(BOT_REPLIES_PER_MINUTE + 1);
    // A minute later the first chat is answered again.
    redis.advance(61);
    await service.handle(message('/start'));
    expect(bot.sendMessage).toHaveBeenCalledTimes(BOT_REPLIES_PER_MINUTE + 2);
    warn.mockRestore();
  });
});
