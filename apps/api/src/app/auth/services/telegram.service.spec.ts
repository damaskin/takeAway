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
    expect(config.publicConfig()).toEqual({ botId: '7412345678', botUsername: 'takaway_tgbot' });
  });

  it('never leaks any part of the token after the colon', () => {
    const { botId } = service({ TELEGRAM_BOT_TOKEN: '123:secret' }).publicConfig();
    expect(botId).toBe('123');
  });

  it('reports no bot when the token is missing or malformed', () => {
    expect(service({}).publicConfig()).toEqual({ botId: null, botUsername: null });
    expect(service({ TELEGRAM_BOT_TOKEN: 'not-a-token' }).publicConfig().botId).toBeNull();
  });
});
