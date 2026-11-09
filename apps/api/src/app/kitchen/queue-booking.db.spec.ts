import { PrismaClient } from '@prisma/client';

import type { FeatureFlagsService } from '../config/feature-flags.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { KitchenLoadService } from './kitchen-load.service';
import { QueuePolicyService } from './queue-policy.service';
import { QueueStateService } from './queue-state.service';

/**
 * The booking lock on a real Postgres (docs/queue-policy.md 2.4): two
 * customers booking the last free stretch at the same moment — one gets it,
 * the other `PICKUP_SLOT_FULL`. Opt-in: set QUEUE_IT_DATABASE_URL to a
 * throwaway database with the migrations applied (`prisma migrate deploy`).
 * The suite adds one brand, store and customer with ids starting `qit-` and
 * deletes them again. Never point it at a database you care about.
 */
const url = process.env['QUEUE_IT_DATABASE_URL'];
const suite = url ? describe : describe.skip;

const BRAND = 'qit-brand';
const STORE = 'qit-store';
const USER = 'qit-user';

suite('the queue booking lock (Postgres)', () => {
  let prisma: PrismaClient;
  let queue: QueuePolicyService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await cleanUp(prisma);
    await prisma.brand.create({ data: { id: BRAND, slug: BRAND, name: 'QIT', currency: 'MDL' } });
    await prisma.store.create({
      data: {
        id: STORE,
        brandId: BRAND,
        slug: STORE,
        name: 'Центр',
        addressLine: 'Юности 12',
        city: 'Тирасполь',
        country: 'MD',
        latitude: 46.84,
        longitude: 29.66,
        currency: 'MDL',
        timezone: 'UTC',
        baseEtaSeconds: 300,
        kitchenParallelism: 1,
      },
    });
    await prisma.user.create({ data: { id: USER, name: 'Клиент' } });
    const kitchen = { policy: { maxAsapWaitSeconds: 2700, preorderOpeningLeadSeconds: 900 } };
    queue = new QueuePolicyService(
      prisma as unknown as PrismaService,
      new QueueStateService(prisma as unknown as PrismaService),
      kitchen as unknown as KitchenLoadService,
      { queuePolicyEnabled: true } as FeatureFlagsService,
    );
  });

  afterAll(async () => {
    await cleanUp(prisma);
    await prisma.$disconnect();
  });

  it('lets only one of two simultaneous customers book the same ten minutes', async () => {
    const now = new Date();
    const readyBy = new Date(Math.ceil((now.getTime() + 60 * 60_000) / 60_000) * 60_000);
    const cake = [{ prepSeconds: 600, quantity: 1 }];

    const book = (code: string) =>
      prisma.$transaction(async (tx) => {
        await queue.lockStore(tx, STORE);
        await queue.assertPreorderTime(STORE, cake, readyBy, new Date(), tx);
        // Hold the lock a while, so the other booking really waits for it.
        await new Promise((resolve) => setTimeout(resolve, 200));
        return tx.order.create({
          data: {
            id: `qit-${code}`,
            userId: USER,
            storeId: STORE,
            status: 'PAID',
            pickupMode: 'SCHEDULED',
            pickupAt: readyBy,
            kitchenVisibleAt: new Date(),
            subtotalCents: 500,
            totalCents: 500,
            currency: 'MDL',
            orderCode: `qit-${code}`,
            qrToken: `qit-${code}`,
            items: {
              create: {
                productSnapshot: { id: 'qit-cake', name: 'Торт' },
                quantity: 1,
                unitPriceCents: 500,
                totalCents: 500,
                prepSeconds: 600,
                prepParallel: false,
              },
            },
          },
        });
      });

    const results = await Promise.allSettled([book('a'), book('b')]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(refused?.reason).toMatchObject({ response: expect.objectContaining({ code: 'PICKUP_SLOT_FULL' }) });
    expect(await prisma.order.count({ where: { storeId: STORE } })).toBe(1);

    // The next customer no longer sees that time.
    const windows = await queue.readyWindows(STORE, cake, new Date());
    expect(windows.some((w) => w.from <= readyBy.getTime() - 60_000 && readyBy.getTime() - 60_000 <= w.to)).toBe(false);
  });
});

async function cleanUp(prisma: PrismaClient): Promise<void> {
  await prisma.orderItem.deleteMany({ where: { order: { storeId: STORE } } });
  await prisma.order.deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.brand.deleteMany({ where: { id: BRAND } });
}
