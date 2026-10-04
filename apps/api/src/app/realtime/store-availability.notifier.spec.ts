import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeGateway } from './realtime.gateway';
import { StoreAvailabilityNotifier } from './store-availability.notifier';

describe('StoreAvailabilityNotifier', () => {
  function harness(store: { status: string; shifts: { id: string }[] } | null) {
    const prisma = {
      store: {
        findUnique: jest.fn().mockResolvedValue(store && { id: 'store-1', brandId: 'brand-1', ...store }),
      },
    };
    const realtime = { emitStoreAvailabilityChanged: jest.fn() };
    const notifier = new StoreAvailabilityNotifier(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeGateway,
    );
    return { notifier, prisma, realtime };
  }

  it.each([
    ['open with a shift', 'OPEN', [{ id: 'shift-1' }], true],
    ['busy with a shift', 'OVERLOADED', [{ id: 'shift-1' }], true],
    ['open without a shift', 'OPEN', [], false],
    ['switched off during a shift', 'CLOSED', [{ id: 'shift-1' }], false],
  ])('announces a store %s', async (_label, status, shifts, accepting) => {
    const { notifier, realtime } = harness({ status, shifts });
    await notifier.announce('store-1');
    expect(realtime.emitStoreAvailabilityChanged).toHaveBeenCalledWith({
      storeId: 'store-1',
      brandId: 'brand-1',
      acceptingOrders: accepting,
    });
  });

  it('says nothing about a store that is gone', async () => {
    const { notifier, realtime } = harness(null);
    await notifier.announce('store-1');
    expect(realtime.emitStoreAvailabilityChanged).not.toHaveBeenCalled();
  });

  it('never fails the request that changed the store', async () => {
    const { notifier, prisma, realtime } = harness({ status: 'OPEN', shifts: [] });
    prisma.store.findUnique.mockRejectedValue(new Error('connection lost'));
    await expect(notifier.announce('store-1')).resolves.toBeUndefined();
    expect(realtime.emitStoreAvailabilityChanged).not.toHaveBeenCalled();
  });

  it('announces a deleted store as not taking orders', () => {
    const { notifier, realtime } = harness(null);
    notifier.announceGone({ id: 'store-1', brandId: 'brand-1' });
    expect(realtime.emitStoreAvailabilityChanged).toHaveBeenCalledWith({
      storeId: 'store-1',
      brandId: 'brand-1',
      acceptingOrders: false,
    });
  });
});
