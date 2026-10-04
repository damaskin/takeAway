import type { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import type { ApnsPushProvider } from './providers/apns.provider';
import type { FcmPushProvider } from './providers/fcm.provider';
import type { PushMessage, PushRecipient } from './providers/push-provider.interface';
import type { TelegramPushProvider } from './providers/telegram-push.provider';
import type { WebPushProvider } from './providers/web-push.provider';

const order = {
  id: 'order-1',
  userId: 'user-1',
  orderCode: 'A42',
  storeId: 'store-1',
  fulfillmentType: 'PICKUP' as const,
};

type Attempt = Awaited<ReturnType<FcmPushProvider['attempt']>>;

function setup(
  user: {
    locale?: 'EN' | 'RU';
    notifyOrderUpdates?: boolean;
    notifyPromotions?: boolean;
    telegramUserId?: bigint | null;
    devices?: Array<{ pushToken: string; type: 'IOS' | 'ANDROID' | 'WEB' }>;
  } = {},
  results: { fcm?: Attempt; webpush?: Attempt; telegram?: Attempt } = {},
) {
  const findUnique = jest.fn().mockResolvedValue({
    id: 'user-1',
    locale: user.locale ?? 'RU',
    telegramUserId: user.telegramUserId ?? null,
    notifyOrderUpdates: user.notifyOrderUpdates ?? true,
    notifyPromotions: user.notifyPromotions ?? true,
    devices: user.devices ?? [{ pushToken: 'fcm-token', type: 'IOS' }],
  });
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  const provider = (id: string, result: Attempt) => ({
    id,
    attempt: jest.fn().mockResolvedValue(result),
    send: jest.fn().mockResolvedValue(result.status === 'sent'),
    isConfigured: jest.fn().mockReturnValue(true),
  });
  const telegram = provider('telegram', results.telegram ?? { status: 'sent' });
  const apns = provider('apns', { status: 'skipped', reason: 'not_configured' });
  const fcm = provider('fcm', results.fcm ?? { status: 'sent' });
  const webpush = provider('webpush', results.webpush ?? { status: 'skipped', reason: 'no_target' });
  const service = new NotificationsService(
    prisma,
    telegram as unknown as TelegramPushProvider,
    apns as unknown as ApnsPushProvider,
    fcm as unknown as FcmPushProvider,
    webpush as unknown as WebPushProvider,
  );
  const sent = (): { recipient: PushRecipient; message: PushMessage } | undefined => {
    const call = fcm.attempt.mock.calls[0] as [PushRecipient, PushMessage] | undefined;
    return call && { recipient: call[0], message: call[1] };
  };
  return { service, findUnique, fcm, webpush, telegram, sent };
}

describe('NotificationsService.deliver', () => {
  const message: PushMessage = { kind: 'generic', title: 'Hi', body: 'There' };
  const recipient = (over: Partial<PushRecipient> = {}): PushRecipient => ({
    userId: 'user-1',
    locale: 'RU',
    telegramUserId: 42n,
    pushTokens: [{ token: 'fcm-token', deviceType: 'ANDROID' }],
    ...over,
  });

  it('stops at the app push when it lands — no duplicate bot message', async () => {
    const h = setup();
    await expect(h.service.deliver(recipient(), message)).resolves.toEqual({ outcome: 'sent', via: ['fcm'] });
    expect(h.telegram.attempt).not.toHaveBeenCalled();
  });

  it('falls back to the Telegram bot for a Mini App customer without device tokens', async () => {
    const h = setup({}, { fcm: { status: 'skipped', reason: 'no_target' } });
    await expect(h.service.deliver(recipient({ pushTokens: [] }), message)).resolves.toEqual({
      outcome: 'sent',
      via: ['telegram'],
    });
    expect(h.telegram.attempt).toHaveBeenCalledTimes(1);
  });

  it('falls back to Telegram when the app push fails, keeping the reason', async () => {
    const h = setup({}, { fcm: { status: 'failed', error: 'FCM 403 PERMISSION_DENIED' } });
    await expect(h.service.deliver(recipient(), message)).resolves.toEqual({
      outcome: 'sent',
      via: ['telegram'],
      error: 'FCM 403 PERMISSION_DENIED',
    });
  });

  it('reports failure with every reason when nothing lands', async () => {
    const h = setup(
      {},
      {
        fcm: { status: 'failed', error: 'FCM 500 INTERNAL' },
        telegram: { status: 'failed', error: 'Telegram 403: Forbidden: bot was blocked by the user' },
      },
    );
    await expect(h.service.deliver(recipient(), message)).resolves.toEqual({
      outcome: 'failed',
      via: [],
      error: 'FCM 500 INTERNAL; Telegram 403: Forbidden: bot was blocked by the user',
    });
  });

  it('says no_channel when the person has nothing to deliver to', async () => {
    const h = setup(
      {},
      { fcm: { status: 'skipped', reason: 'no_target' }, telegram: { status: 'skipped', reason: 'no_target' } },
    );
    await expect(h.service.deliver(recipient({ pushTokens: [], telegramUserId: null }), message)).resolves.toEqual({
      outcome: 'no_channel',
      via: [],
    });
  });

  it('only uses the bot in telegram mode', async () => {
    const h = setup();
    await expect(h.service.deliver(recipient(), message, 'telegram')).resolves.toEqual({
      outcome: 'sent',
      via: ['telegram'],
    });
    expect(h.fcm.attempt).not.toHaveBeenCalled();
  });

  it('treats a provider that throws as a failure, not a crash', async () => {
    const h = setup({}, { fcm: { status: 'skipped', reason: 'no_target' } });
    h.telegram.attempt.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(h.service.deliver(recipient({ pushTokens: [] }), message)).resolves.toEqual({
      outcome: 'failed',
      via: [],
      error: 'telegram: socket hang up',
    });
  });
});

describe('NotificationsService.sendCampaignTo', () => {
  it('skips a customer who turned promotions off', async () => {
    const h = setup({ notifyPromotions: false });
    await expect(h.service.sendCampaignTo('user-1', 'PUSH', 'Hi', 'There')).resolves.toEqual({
      outcome: 'opted_out',
      via: [],
    });
    expect(h.fcm.attempt).not.toHaveBeenCalled();
  });

  it('still sends the admin their own test', async () => {
    const h = setup({ notifyPromotions: false });
    await expect(
      h.service.sendCampaignTo('user-1', 'PUSH', 'Hi', 'There', { ignoreOptOut: true }),
    ).resolves.toMatchObject({ outcome: 'sent' });
  });
});

describe('NotificationsService.notifyOrderStatus', () => {
  it('tells the customer the order was accepted, in their language', async () => {
    const ru = setup({ locale: 'RU' });
    await ru.service.notifyOrderStatus(order, 'ACCEPTED');
    expect(ru.sent()?.message).toEqual({
      kind: 'order_status',
      title: 'Заказ #A42 принят',
      body: 'Заведение уже готовит ваш заказ.',
      orderId: 'order-1',
    });
    expect(ru.sent()?.recipient.pushTokens).toEqual([{ token: 'fcm-token', deviceType: 'IOS' }]);

    const en = setup({ locale: 'EN' });
    await en.service.notifyOrderStatus(order, 'ACCEPTED');
    expect(en.sent()?.message.title).toBe('Order #A42 accepted');
  });

  it('says where to collect a ready order', async () => {
    const pickup = setup();
    await pickup.service.notifyOrderStatus(order, 'READY');
    expect(pickup.sent()?.message).toMatchObject({ kind: 'order_ready', body: 'Можно забирать у стойки.' });

    const delivery = setup();
    await delivery.service.notifyOrderStatus({ ...order, fulfillmentType: 'DELIVERY' }, 'READY');
    expect(delivery.sent()?.message.body).toBe('Ждём курьера, скоро выедет к вам.');
  });

  it.each(['CREATED', 'PAID', 'IN_PROGRESS', 'PICKED_UP'] as const)(
    'stays quiet on %s without looking the customer up',
    async (status) => {
      const h = setup();
      await h.service.notifyOrderStatus(order, status);
      expect(h.findUnique).not.toHaveBeenCalled();
      expect(h.fcm.attempt).not.toHaveBeenCalled();
    },
  );

  it('respects the order-updates opt-out', async () => {
    const h = setup({ notifyOrderUpdates: false });
    await h.service.notifyOrderStatus(order, 'READY');
    expect(h.fcm.attempt).not.toHaveBeenCalled();
    expect(h.telegram.attempt).not.toHaveBeenCalled();
  });

  it('reaches a Mini App customer through the bot, in their language', async () => {
    const h = setup(
      { locale: 'EN', telegramUserId: 42n, devices: [] },
      { fcm: { status: 'skipped', reason: 'no_target' } },
    );
    await h.service.notifyOrderStatus(order, 'READY');
    const [recipient, message] = h.telegram.attempt.mock.calls[0] as [PushRecipient, PushMessage];
    expect(recipient.telegramUserId).toBe(42n);
    expect(message.title).toBe('Order #A42 is ready ☕');
  });

  it('does not also message the bot when the app push landed', async () => {
    const h = setup({ telegramUserId: 42n });
    await h.service.notifyOrderStatus(order, 'ACCEPTED');
    expect(h.fcm.attempt).toHaveBeenCalledTimes(1);
    expect(h.telegram.attempt).not.toHaveBeenCalled();
  });

  it('says the card hold was released when the store never accepted a paid order', async () => {
    const h = setup();
    await h.service.notifyOrderStatus(order, 'EXPIRED', {
      expiry: { reason: 'payment_timeout', holdReleased: true },
    });
    expect(h.sent()?.message).toMatchObject({
      title: 'Заказ #A42 не принят',
      body: 'Заведение не подтвердило заказ вовремя. Деньги не списаны, бронь на карте снята.',
    });
  });

  it('says the payment did not go through when nothing was held', async () => {
    const h = setup({ locale: 'EN' });
    await h.service.notifyOrderStatus(order, 'EXPIRED', {
      expiry: { reason: 'payment_timeout', holdReleased: false },
    });
    expect(h.sent()?.message.body).toBe(
      'The payment was not completed. Your promo code, points and gift card balance are back.',
    );
  });

  it('tells a pay-on-pickup customer the store did not take the order', async () => {
    const h = setup();
    await h.service.notifyOrderStatus(order, 'EXPIRED', {
      expiry: { reason: 'not_accepted', holdReleased: false },
    });
    expect(h.sent()?.message.body).toBe('Заведение не подтвердило заказ вовремя.');
  });
});
