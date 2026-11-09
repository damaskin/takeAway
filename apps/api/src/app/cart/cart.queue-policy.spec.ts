import type { KitchenLoadService } from '../kitchen/kitchen-load.service';
import type { QueuePolicyService } from '../kitchen/queue-policy.service';
import type { StoreAvailabilityService } from '../kitchen/store-availability.service';
import type { PrismaService } from '../prisma/prisma.service';
import { optionGroupsStub } from '../option-groups/testing/option-groups.stub';
import { CartService } from './cart.service';

const at = (iso: string) => new Date(iso);

const CART = {
  id: 'cart-1',
  userId: 'user-1',
  storeId: 'store-1',
  subtotalCents: 600,
  etaSeconds: 0,
  updatedAt: at('2026-11-09T11:59:00Z'),
  items: [
    {
      id: 'ci-1',
      productId: 'p-americano',
      product: { name: 'Американо' },
      quantity: 2,
      variationIds: [],
      modifiersJson: {},
      unitPriceCents: 300,
      unitPrepSeconds: 240,
      notes: null,
    },
  ],
};

const OPEN = {
  openNow: true,
  asapBlockedReason: null,
  closesAt: at('2026-11-09T20:00:00Z'),
  extendedUntil: null,
};

function harness(enabled: boolean) {
  const prisma = { cart: { findUnique: jest.fn().mockResolvedValue(CART) } };
  const kitchen = {
    timings: jest.fn().mockReturnValue({ prepSeconds: 240, workSeconds: 480 }),
    quote: jest.fn().mockResolvedValue({ etaSeconds: 1080 }),
  };
  const availability = { forStore: jest.fn().mockResolvedValue(OPEN) };
  const queue = {
    enabled,
    maxAsapWaitSeconds: 2700,
    basket: jest.fn().mockResolvedValue([{ prepSeconds: 180, parallel: false, quantity: 2 }]),
    quoteBasket: jest.fn().mockResolvedValue({ readyAt: at('2026-11-09T12:11:00Z'), etaSeconds: 660 }),
  };
  const service = new CartService(
    prisma as unknown as PrismaService,
    kitchen as unknown as KitchenLoadService,
    availability as unknown as StoreAvailabilityService,
    optionGroupsStub(),
    queue as unknown as QueuePolicyService,
  );
  return { service, kitchen, availability, queue };
}

describe('CartService under the queue policy (2.5)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: at('2026-11-09T12:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });
  afterEach(() => jest.useRealTimers());

  it('quotes the cart at the end of the queue: «Если закажете сейчас — будет готово в 12:11 · ≈ 11 мин»', async () => {
    const { service, kitchen, queue } = harness(true);

    const cart = await service.getForUserAndStore('user-1', 'store-1');

    expect(kitchen.quote).not.toHaveBeenCalled();
    expect(queue.basket).toHaveBeenCalledWith(CART.items);
    expect(cart).toMatchObject({
      etaSeconds: 660,
      readyAt: '2026-11-09T12:11:00.000Z',
      asapAvailable: true,
      asapBlockedReason: null,
    });
  });

  it('says «Не успеем до закрытия» when the cart would be ready after the closing', async () => {
    const { service, availability } = harness(true);
    availability.forStore.mockResolvedValue({ ...OPEN, closesAt: at('2026-11-09T12:10:00Z') });

    const cart = await service.getForUserAndStore('user-1', 'store-1');

    expect(cart).toMatchObject({ asapAvailable: false, asapBlockedReason: 'CLOSING_SOON' });
  });

  it("passes the store's own reason on: «Перерыв», outside the hours", async () => {
    const { service, availability } = harness(true);
    availability.forStore.mockResolvedValue({ ...OPEN, openNow: false, asapBlockedReason: 'PAUSED' });

    expect(await service.getForUserAndStore('user-1', 'store-1')).toMatchObject({
      asapAvailable: false,
      asapBlockedReason: 'PAUSED',
    });
  });

  it('answers exactly as before with the flag off', async () => {
    const { service, kitchen, queue } = harness(false);

    const cart = await service.getForUserAndStore('user-1', 'store-1');

    expect(queue.quoteBasket).not.toHaveBeenCalled();
    expect(kitchen.quote).toHaveBeenCalled();
    expect(cart.etaSeconds).toBe(1080);
    expect(cart).not.toHaveProperty('readyAt');
    expect(cart).not.toHaveProperty('asapAvailable');
  });
});
