import { OrderStatus } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService.orderStatuses', () => {
  function service(live: Array<[OrderStatus, number]>, period: Array<[OrderStatus, number]>) {
    const rows = (pairs: Array<[OrderStatus, number]>) => pairs.map(([status, n]) => ({ status, _count: { _all: n } }));
    const groupBy = jest.fn().mockResolvedValueOnce(rows(live)).mockResolvedValueOnce(rows(period));
    const prisma = { order: { groupBy } } as unknown as PrismaService;
    return { analytics: new AnalyticsService(prisma), groupBy };
  }

  it('counts the open orders now and how the period ended up', async () => {
    const { analytics, groupBy } = service(
      [
        [OrderStatus.PAID, 2],
        [OrderStatus.IN_PROGRESS, 1],
      ],
      [
        [OrderStatus.PICKED_UP, 7],
        [OrderStatus.DELIVERED, 1],
        [OrderStatus.CANCELLED, 1],
        [OrderStatus.EXPIRED, 1],
        [OrderStatus.PAID, 2],
      ],
    );

    const stats = await analytics.orderStatuses({ brandIds: ['b1'], storeIds: null }, 7);

    expect(stats.live).toEqual({
      CREATED: 0,
      PAID: 2,
      ACCEPTED: 0,
      IN_PROGRESS: 1,
      READY: 0,
      OUT_FOR_DELIVERY: 0,
    });
    expect(stats.liveTotal).toBe(3);
    expect(stats.period).toEqual(
      expect.objectContaining({ total: 12, completed: 8, cancelled: 1, expired: 1, completionRatePercent: 80 }),
    );
    // Both queries stay inside the caller's brands.
    for (const [args] of groupBy.mock.calls) {
      expect(args.where.store).toEqual({ brandId: { in: ['b1'] } });
    }
  });

  it('has no completion rate before anything has finished', async () => {
    const { analytics } = service([], [[OrderStatus.PAID, 3]]);
    const stats = await analytics.orderStatuses({ brandIds: null, storeIds: ['s1'] }, 1);
    expect(stats.period.completionRatePercent).toBeNull();
    expect(stats.period.total).toBe(3);
  });
});
