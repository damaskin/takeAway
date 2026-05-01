import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';

import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { POS_SYNC_QUEUE } from './pos/pos-sync.queue';
import { REDIS_CLIENT } from './redis/redis.service';

/**
 * Compiles the entire AppModule DI graph with external services mocked.
 *
 * The point of this test is not to exercise behaviour — it's a sentinel
 * for the recurring "module forgot `imports: [AuthModule]`" class of bug
 * (prod incident #107, then again with AdminCatalogModule during M1).
 * Anything that breaks the wiring graph — a missing import, a typo in a
 * provider token, a circular dependency — fails this test instead of
 * crash-looping the prod container.
 *
 * Pure DI compilation: we never call `init()` so onModuleInit hooks
 * don't run. PrismaService is replaced wholesale (stops `$connect`),
 * REDIS_CLIENT is a fake Redis instance, and the POS BullMQ queue is
 * a stub. BullMQ queues are lazy on register, so they don't reach out
 * to Redis until we'd add a job — which we never do.
 */
describe('AppModule DI graph', () => {
  it('compiles without missing providers', async () => {
    const fakeRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
      quit: jest.fn().mockResolvedValue('OK'),
      on: jest.fn(),
    } as unknown as Redis;
    const fakePrisma = {
      $connect: jest.fn(),
      $disconnect: jest.fn(),
    } as unknown as PrismaService;
    const fakeQueue = { add: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .overrideProvider(REDIS_CLIENT)
      .useValue(fakeRedis)
      .overrideProvider(getQueueToken(POS_SYNC_QUEUE))
      .useValue(fakeQueue)
      .compile();

    // Prove a sample of providers are resolvable. If any of these throw
    // it means the override or import graph is broken in a subtle way
    // that purely-static `compile()` tolerated.
    expect(moduleRef.get(PrismaService)).toBe(fakePrisma);
    expect(moduleRef.get(REDIS_CLIENT)).toBe(fakeRedis);
    expect(moduleRef.get(getQueueToken(POS_SYNC_QUEUE))).toBe(fakeQueue);

    await moduleRef.close();
  });
});
