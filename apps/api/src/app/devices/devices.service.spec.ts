import type { PrismaService } from '../prisma/prisma.service';
import { DevicesService } from './devices.service';

const APNS = 'AB'.repeat(32);

function setup(existing: { id: string } | null = null) {
  const device = {
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    findFirst: jest.fn().mockResolvedValue(existing),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({ id: 'new-device' }),
  };
  const service = new DevicesService({ device } as unknown as PrismaService);
  return { service, device };
}

describe('DevicesService.register', () => {
  it('stores the raw APNs token of an iPhone next to its FCM token, lower-cased', async () => {
    const h = setup();
    await expect(
      h.service.register('user-1', { type: 'IOS', pushToken: 'fcm-1', apnsToken: APNS, apnsEnvironment: 'SANDBOX' }),
    ).resolves.toEqual({ id: 'new-device' });
    expect(h.device.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'IOS',
        pushToken: 'fcm-1',
        locale: 'EN',
        apnsToken: APNS.toLowerCase(),
        apnsEnvironment: 'SANDBOX',
      },
      select: { id: true },
    });
  });

  it('assumes the production gateway when the app does not say', async () => {
    const h = setup({ id: 'd1' });
    await h.service.register('user-1', { type: 'IOS', pushToken: 'fcm-1', apnsToken: APNS });
    expect(h.device.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: expect.objectContaining({ apnsToken: APNS.toLowerCase(), apnsEnvironment: 'PRODUCTION' }) as unknown,
    });
  });

  it('moves the phone to whoever signed in on it and drops rows of a rotated FCM token', async () => {
    const h = setup();
    await h.service.register('user-2', { type: 'IOS', pushToken: 'fcm-1', apnsToken: APNS });
    expect(h.device.deleteMany).toHaveBeenCalledWith({ where: { pushToken: 'fcm-1', userId: { not: 'user-2' } } });
    expect(h.device.deleteMany).toHaveBeenCalledWith({
      where: { apnsToken: APNS.toLowerCase(), NOT: { userId: 'user-2', pushToken: 'fcm-1' } },
    });
  });

  it('leaves the stored APNs token alone when an app sends none, and ignores it on Android', async () => {
    const ios = setup({ id: 'd1' });
    await ios.service.register('user-1', { type: 'IOS', pushToken: 'fcm-1' });
    expect(ios.device.update.mock.calls[0]?.[0]).toEqual({
      where: { id: 'd1' },
      data: { lastSeenAt: expect.any(Date) as unknown, locale: undefined, type: 'IOS' },
    });
    expect(ios.device.deleteMany).toHaveBeenCalledTimes(1);

    const android = setup();
    await android.service.register('user-1', { type: 'ANDROID', pushToken: 'fcm-2', apnsToken: APNS });
    expect(android.device.create.mock.calls[0]?.[0]).toEqual({
      data: { userId: 'user-1', type: 'ANDROID', pushToken: 'fcm-2', locale: 'EN' },
      select: { id: true },
    });
  });
});
