import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { OpsChatService } from './ops-chat.service';

function withEnv(env: Record<string, string>): OpsChatService {
  return new OpsChatService({ get: (key: string) => env[key] } as unknown as ConfigService);
}

describe('OpsChatService', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('is off, and silent, without a chat id', async () => {
    const chat = withEnv({ TELEGRAM_BOT_TOKEN: 'token' });

    expect(chat.enabled).toBe(false);
    await expect(chat.send('hello')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts plain text to the configured chat through the bot', async () => {
    const chat = withEnv({ TELEGRAM_BOT_TOKEN: 'token', OPS_ALERT_TELEGRAM_CHAT_ID: '-100500' });

    await expect(chat.send('New brand to review')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/bottoken/sendMessage',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      chat_id: '-100500',
      text: 'New brand to review',
      disable_web_page_preview: true,
    });
  });

  it('reports a refused or failed delivery as false instead of throwing', async () => {
    const chat = withEnv({ TELEGRAM_BOT_TOKEN: 'token', OPS_ALERT_TELEGRAM_CHAT_ID: '-100500' });

    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, text: () => Promise.resolve('bot was kicked') });
    await expect(chat.send('x')).resolves.toBe(false);

    fetchMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    await expect(chat.send('x')).resolves.toBe(false);
  });
});
