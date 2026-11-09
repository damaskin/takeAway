import type { FeatureFlagsService } from '../config/feature-flags.service';
import type { KitchenLoadService } from '../kitchen/kitchen-load.service';
import type { QueuePolicyService } from '../kitchen/queue-policy.service';
import type { StoreAvailabilityService } from '../kitchen/store-availability.service';
import type { PrismaService } from '../prisma/prisma.service';
import { optionGroupsStub } from '../option-groups/testing/option-groups.stub';
import { CatalogService } from './catalog.service';

const at = (iso: string) => new Date(iso);
const ms = (iso: string) => Date.parse(iso);

function harness(enabled: boolean) {
  const prisma = {
    store: { findFirst: jest.fn().mockResolvedValue({ id: 'store-1' }) },
    cart: {
      findUnique: jest.fn().mockResolvedValue({
        storeId: 'store-1',
        items: [{ productId: 'p-americano', quantity: 2, unitPrepSeconds: 180 }],
      }),
    },
  };
  const kitchen = {
    timings: jest.fn().mockReturnValue({ prepSeconds: 180, workSeconds: 360 }),
    pickupSlots: jest.fn().mockResolvedValue([
      { startsAt: at('2026-11-09T12:15:00Z'), endsAt: at('2026-11-09T12:30:00Z'), taken: 0, available: true },
      { startsAt: at('2026-11-09T12:30:00Z'), endsAt: at('2026-11-09T12:45:00Z'), taken: 3, available: false },
    ]),
    typicalPrepByStore: jest.fn().mockResolvedValue(new Map([['store-1', 240]])),
  };
  const basket = [{ prepSeconds: 180, parallel: false, quantity: 2 }];
  const queue = {
    enabled,
    basket: jest.fn().mockResolvedValue(basket),
    readyWindows: jest.fn().mockResolvedValue([{ from: ms('2026-11-09T12:11:00Z'), to: ms('2026-11-09T12:50:00Z') }]),
    pickupSlots: jest
      .fn()
      .mockResolvedValue([
        { startsAt: at('2026-11-09T12:15:00Z'), endsAt: at('2026-11-09T12:30:00Z'), taken: 1, available: true },
      ]),
  };
  const service = new CatalogService(
    prisma as unknown as PrismaService,
    {} as FeatureFlagsService,
    kitchen as unknown as KitchenLoadService,
    {} as StoreAvailabilityService,
    optionGroupsStub(),
    queue as unknown as QueuePolicyService,
  );
  return { service, kitchen, queue, basket };
}

describe('CatalogService pre-order times under the queue policy (2.4)', () => {
  it("answers the cart's free windows in whole minutes", async () => {
    const { service, queue, basket } = harness(true);

    expect(await service.getReadyWindows('centr', 'cart-1')).toEqual([
      { from: '2026-11-09T12:11:00.000Z', to: '2026-11-09T12:50:00.000Z' },
    ]);
    expect(queue.basket).toHaveBeenCalledWith([{ productId: 'p-americano', quantity: 2, unitPrepSeconds: 180 }]);
    expect(queue.readyWindows).toHaveBeenCalledWith('store-1', basket);
  });

  it('uses one position of the typical time without a cart', async () => {
    const { service, queue } = harness(true);
    await service.getReadyWindows('centr');
    expect(queue.readyWindows).toHaveBeenCalledWith('store-1', [{ prepSeconds: 240 }]);
  });

  it('keeps the 15-minute slots for old app builds, read off the windows', async () => {
    const { service, kitchen, queue } = harness(true);

    const slots = await service.getPickupSlots('centr', 'cart-1');

    expect(kitchen.pickupSlots).not.toHaveBeenCalled();
    expect(queue.pickupSlots).toHaveBeenCalled();
    expect(slots).toEqual([
      {
        startsAt: '2026-11-09T12:15:00.000Z',
        endsAt: '2026-11-09T12:30:00.000Z',
        taken: 1,
        capacity: 0,
        available: true,
      },
    ]);
  });

  it('answers the free slot starts as one-minute windows with the flag off', async () => {
    const { service, queue } = harness(false);

    expect(await service.getReadyWindows('centr', 'cart-1')).toEqual([
      { from: '2026-11-09T12:15:00.000Z', to: '2026-11-09T12:15:00.000Z' },
    ]);
    expect(queue.readyWindows).not.toHaveBeenCalled();
  });
});
