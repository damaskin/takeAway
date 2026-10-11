import { createHmac } from 'node:crypto';

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TelegramService } from './telegram.service';

function service(env: Record<string, string | undefined>): TelegramService {
  return new TelegramService({ get: (key: string) => env[key] } as unknown as ConfigService);
}

describe('TelegramService.publicConfig', () => {
  it('exposes the bot id from the token prefix and the username without @', () => {
    const config = service({
      TELEGRAM_BOT_TOKEN: '7412345678:AAH-secret-part',
      TELEGRAM_BOT_USERNAME: '@takaway_tgbot',
    });
    expect(config.publicConfig()).toEqual({
      botId: '7412345678',
      botUsername: 'takaway_tgbot',
      // Telegram Login uses the bot id as its OpenID Connect client id.
      clientId: '7412345678',
    });
  });

  it('never leaks any part of the token after the colon', () => {
    const { botId } = service({ TELEGRAM_BOT_TOKEN: '123:secret' }).publicConfig();
    expect(botId).toBe('123');
  });

  it('lets a deployment sign in through a different bot than the one that messages', () => {
    const config = service({ TELEGRAM_BOT_TOKEN: '123:secret', TELEGRAM_LOGIN_CLIENT_ID: ' 8521897198 ' });
    expect(config.publicConfig().clientId).toBe('8521897198');
  });

  it('reports no bot when the token is missing or malformed', () => {
    expect(service({}).publicConfig()).toEqual({ botId: null, botUsername: null, clientId: null });
    expect(service({ TELEGRAM_BOT_TOKEN: 'not-a-token' }).publicConfig().botId).toBeNull();
  });
});

const BOT_TOKEN = '7412345678:AAH-secret-part';

/** Init data as Telegram signs it for a Mini App launch at `authDate`. */
function initData(authDate: number, token = BOT_TOKEN): string {
  const fields: Record<string, string> = {
    auth_date: String(authDate),
    query_id: 'AAE-query',
    user: JSON.stringify({ id: 42, first_name: 'Ana' }),
  };
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const check = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

describe('TelegramService.verifyInitData', () => {
  const now = () => Math.floor(Date.now() / 1000);
  const prod = { NODE_ENV: 'production', TELEGRAM_BOT_TOKEN: BOT_TOKEN };

  it('accepts init data Telegram signed a moment ago', () => {
    expect(service(prod).verifyInitData(initData(now() - 60)).user.id).toBe(42);
  });

  it('refuses init data older than a day, however valid its signature', () => {
    expect(() => service(prod).verifyInitData(initData(now() - 25 * 60 * 60))).toThrow(UnauthorizedException);
    expect(() => service(prod).verifyInitData(initData(now() - 25 * 60 * 60))).toThrow(/stale/);
  });

  it('takes the window from TELEGRAM_INIT_DATA_MAX_AGE_SECONDS', () => {
    const strict = service({ ...prod, TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '3600' });
    expect(() => strict.verifyInitData(initData(now() - 2 * 60 * 60))).toThrow(/stale/);
    const lenient = service({ ...prod, TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: String(7 * 24 * 60 * 60) });
    expect(lenient.verifyInitData(initData(now() - 2 * 24 * 60 * 60)).user.id).toBe(42);
  });

  it('refuses init data without a date, or dated well in the future', () => {
    expect(() => service(prod).verifyInitData(initData(0))).toThrow(UnauthorizedException);
    expect(() => service(prod).verifyInitData(initData(now() + 60 * 60))).toThrow(/future/);
  });

  it('still refuses a fresh date under somebody else’s signature', () => {
    expect(() => service(prod).verifyInitData(initData(now(), '1:another-bot'))).toThrow(/signature/);
  });
});
