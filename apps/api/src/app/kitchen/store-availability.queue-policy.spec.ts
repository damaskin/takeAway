import type { PrismaService } from '../prisma/prisma.service';
import type { KitchenLoadService } from './kitchen-load.service';
import type { QueuePolicyService } from './queue-policy.service';
import { type AvailabilityInput, StoreAvailabilityService } from './store-availability.service';

const at = (iso: string) => new Date(iso);
const ms = (iso: string) => Date.parse(iso);
const NOW = at('2026-11-09T12:00:00Z');

const STORE: AvailabilityInput = {
  id: 'store-1',
  status: 'OPEN',
  timezone: 'UTC',
  baseEtaSeconds: 300,
  kitchenParallelism: 1,
  loadExtraSeconds: 600,
  workingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: 480, closesAt: 1200, isClosed: false })),
  shifts: [{ extendedUntil: null }],
  pausedUntil: null,
};

function harness(readyAt: string) {
  const kitchen = {
    policy: {
      maxAsapWaitSeconds: 2700,
      minScheduledLeadSeconds: 600,
      preorderHorizonSeconds: 86_400,
      preorderOpeningLeadSeconds: 900,
    },
    asapByStore: jest.fn(),
  };
  const queue = {
    enabled: true,
    typicalQuotes: jest.fn().mockResolvedValue(new Map([['store-1', { readyAt: ms(readyAt) }]])),
  };
  const service = new StoreAvailabilityService(
    {} as PrismaService,
    kitchen as unknown as KitchenLoadService,
    queue as unknown as QueuePolicyService,
  );
  return { service, kitchen, queue };
}

describe('StoreAvailabilityService under the queue policy (2.3)', () => {
  it("shows the store's «N мин» as G of one typical position at the end of its queue", async () => {
    const { service, kitchen, queue } = harness('2026-11-09T12:09:00Z');

    const view = (await service.evaluate([STORE], NOW)).get('store-1');

    expect(kitchen.asapByStore).not.toHaveBeenCalled();
    expect(queue.typicalQuotes).toHaveBeenCalledWith([STORE], NOW);
    expect(view).toMatchObject({ openNow: true, asapBlockedReason: null, currentEtaSeconds: 540 });
  });

  it('keeps the 45-minute cap on an order for now (QUEUE_FULL), pre-orders still taken', async () => {
    const { service } = harness('2026-11-09T12:46:00Z');
    const view = (await service.evaluate([STORE], NOW)).get('store-1');
    expect(view).toMatchObject({ openNow: false, asapBlockedReason: 'QUEUE_FULL', acceptingOrders: true });
  });

  it('closes «как можно скорее» when a typical order would miss the closing', async () => {
    const { service } = harness('2026-11-09T20:04:00Z');
    const view = (await service.evaluate([STORE], at('2026-11-09T19:55:00Z'))).get('store-1');
    expect(view).toMatchObject({ openNow: false, asapBlockedReason: 'CLOSING_SOON' });
  });
});
