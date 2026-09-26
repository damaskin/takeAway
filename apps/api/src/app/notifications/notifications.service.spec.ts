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

function setup(user: { locale?: 'EN' | 'RU'; notifyOrderUpdates?: boolean } = {}) {
  const findUnique = jest.fn().mockResolvedValue({
    id: 'user-1',
    locale: user.locale ?? 'RU',
    telegramUserId: null,
    notifyOrderUpdates: user.notifyOrderUpdates ?? true,
    devices: [{ pushToken: 'fcm-token', type: 'IOS' }],
  });
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  const provider = () => ({ send: jest.fn().mockResolvedValue(true) });
  const telegram = provider();
  const apns = provider();
  const fcm = provider();
  const webpush = provider();
  const service = new NotificationsService(
    prisma,
    telegram as unknown as TelegramPushProvider,
    apns as unknown as ApnsPushProvider,
    fcm as unknown as FcmPushProvider,
    webpush as unknown as WebPushProvider,
  );
  const sent = (): { recipient: PushRecipient; message: PushMessage } | undefined => {
    const call = fcm.send.mock.calls[0] as [PushRecipient, PushMessage] | undefined;
    return call && { recipient: call[0], message: call[1] };
  };
  return { service, findUnique, fcm, sent };
}

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
      expect(h.fcm.send).not.toHaveBeenCalled();
    },
  );

  it('respects the order-updates opt-out', async () => {
    const h = setup({ notifyOrderUpdates: false });
    await h.service.notifyOrderStatus(order, 'READY');
    expect(h.fcm.send).not.toHaveBeenCalled();
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
