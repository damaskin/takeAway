import { Test } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsRefreshService } from './analytics-refresh.service';

describe('AnalyticsRefreshService', () => {
  const buildService = async (
    executeRawUnsafe: jest.Mock = jest.fn().mockResolvedValue(0),
  ): Promise<{ service: AnalyticsRefreshService; calls: jest.Mock }> => {
    const module = await Test.createTestingModule({
      providers: [
        AnalyticsRefreshService,
        { provide: PrismaService, useValue: { $executeRawUnsafe: executeRawUnsafe } },
      ],
    }).compile();
    return { service: module.get(AnalyticsRefreshService), calls: executeRawUnsafe };
  };

  it('refreshOrdersDaily issues REFRESH MATERIALIZED VIEW CONCURRENTLY mv_orders_daily', async () => {
    const { service, calls } = await buildService();
    await service.refreshOrdersDaily();
    expect(calls).toHaveBeenCalledTimes(1);
    expect(calls.mock.calls[0][0]).toBe('REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_orders_daily"');
  });

  it('skips a concurrent run if one is already in flight', async () => {
    let resolveFirst!: () => void;
    const firstCall = new Promise<void>((res) => (resolveFirst = res));
    const exec = jest
      .fn()
      .mockImplementationOnce(() => firstCall)
      .mockResolvedValue(0);
    const { service } = await buildService(exec);

    const inflight = service.refreshOrdersDaily();
    // Second call fires while the first is still pending — guard should skip.
    await service.refreshOrdersDaily();
    resolveFirst();
    await inflight;

    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('swallows refresh errors so the cron never throws', async () => {
    const exec = jest.fn().mockRejectedValue(new Error('view does not exist'));
    const { service } = await buildService(exec);
    await expect(service.refreshOrdersDaily()).resolves.toBeUndefined();
  });
});
