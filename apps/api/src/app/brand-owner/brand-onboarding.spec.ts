import { BrandModerationStatus } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import { onboardingProgressOf, progressOf } from './brand-onboarding';

describe('progressOf', () => {
  it('counts payments as done from the start: a fresh brand is 1 of 5', () => {
    expect(
      progressOf({
        logoUrl: null,
        moderationStatus: BrandModerationStatus.PENDING,
        readyStores: 0,
        categories: 0,
        photographedProducts: 0,
      }),
    ).toEqual({ brandProfile: false, store: false, menu: false, approved: false, done: 1, total: 5, complete: false });
  });

  it('needs a photographed product besides a category for the menu', () => {
    const p = progressOf({
      logoUrl: 'https://cdn/logo.png',
      moderationStatus: BrandModerationStatus.PENDING,
      readyStores: 1,
      categories: 3,
      photographedProducts: 0,
    });
    expect(p).toMatchObject({ brandProfile: true, store: true, menu: false, done: 3 });
  });

  it('is complete only once approved', () => {
    const facts = { logoUrl: 'x', readyStores: 1, categories: 1, photographedProducts: 1 };
    expect(progressOf({ ...facts, moderationStatus: BrandModerationStatus.PENDING }).complete).toBe(false);
    expect(progressOf({ ...facts, moderationStatus: BrandModerationStatus.APPROVED })).toMatchObject({
      done: 5,
      complete: true,
    });
  });
});

describe('onboardingProgressOf', () => {
  it('works out many brands from three grouped queries', async () => {
    const groupBy = (rows: Array<{ brandId: string; n: number }>) =>
      jest.fn().mockResolvedValue(rows.map((r) => ({ brandId: r.brandId, _count: { _all: r.n } })));
    const prisma = {
      store: { groupBy: groupBy([{ brandId: 'live', n: 2 }]) },
      category: {
        groupBy: groupBy([
          { brandId: 'live', n: 1 },
          { brandId: 'half', n: 4 },
        ]),
      },
      product: { groupBy: groupBy([{ brandId: 'live', n: 5 }]) },
    };

    const progress = await onboardingProgressOf(prisma as unknown as PrismaService, [
      { id: 'live', logoUrl: 'x', moderationStatus: BrandModerationStatus.APPROVED },
      { id: 'half', logoUrl: 'x', moderationStatus: BrandModerationStatus.PENDING },
      { id: 'new', logoUrl: null, moderationStatus: BrandModerationStatus.PENDING },
    ]);

    expect(progress.get('live')).toMatchObject({ done: 5, complete: true });
    expect(progress.get('half')).toMatchObject({ brandProfile: true, store: false, menu: false, done: 2 });
    expect(progress.get('new')).toMatchObject({ done: 1, complete: false });
    expect(prisma.store.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          brandId: { in: ['live', 'half', 'new'] },
          addressLine: { not: '' },
          workingHours: { some: { isClosed: false } },
        }),
      }),
    );
  });

  it('asks nothing for no brands', async () => {
    const prisma = { store: { groupBy: jest.fn() } };
    await expect(onboardingProgressOf(prisma as unknown as PrismaService, [])).resolves.toEqual(new Map());
    expect(prisma.store.groupBy).not.toHaveBeenCalled();
  });
});
