import type { StoreAvailabilityService } from '../kitchen/store-availability.service';
import type { RealtimeGateway } from './realtime.gateway';
import { StoreAvailabilityNotifier } from './store-availability.notifier';

describe('StoreAvailabilityNotifier', () => {
  function harness(view: { acceptingOrders: boolean; openNow: boolean } | null) {
    const rules = {
      forStore: jest.fn().mockResolvedValue(view && { ...view, brandId: 'brand-1', status: 'OPEN' }),
    };
    const realtime = { emitStoreAvailabilityChanged: jest.fn() };
    const notifier = new StoreAvailabilityNotifier(
      rules as unknown as StoreAvailabilityService,
      realtime as unknown as RealtimeGateway,
    );
    return { notifier, rules, realtime };
  }

  it.each([
    ['taking ASAP orders', { acceptingOrders: true, openNow: true }, true],
    ['taking pre-orders only (shift closed, after hours, full queue)', { acceptingOrders: true, openNow: false }, true],
    ['taking nothing (switched off, no hours within a day)', { acceptingOrders: false, openNow: false }, false],
  ])('announces a store %s with exactly the fixed payload', async (_label, view, accepting) => {
    const { notifier, realtime } = harness(view);
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
    const { notifier, rules, realtime } = harness({ acceptingOrders: true, openNow: true });
    rules.forStore.mockRejectedValue(new Error('connection lost'));
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
