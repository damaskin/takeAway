import { BrandModerationStatus } from '@prisma/client';

import { optionTablesFake } from '../option-groups/testing/option-tables.fake';
import type { PrismaService } from '../prisma/prisma.service';
import { onboardingProgressOf, progressOf } from './brand-onboarding';

const fresh = {
  logoUrl: null,
  moderationStatus: BrandModerationStatus.PENDING,
  readyStores: 0,
  listedProducts: 0,
  photographedProducts: 0,
  hasOrders: false,
};

describe('progressOf', () => {
  it('counts payments as done from the start: a fresh brand is 1 of 4', () => {
    expect(progressOf(fresh)).toEqual({
      brandProfile: false,
      store: false,
      menu: false,
      photos: false,
      approved: false,
      hasOrders: false,
      done: 1,
      total: 4,
      complete: false,
    });
  });

  it('needs a product customers can see for the menu, not a photo of it', () => {
    const p = progressOf({ ...fresh, readyStores: 1, listedProducts: 3 });
    expect(p).toMatchObject({ store: true, menu: true, photos: false, done: 3 });
  });

  it('takes the logo and photos as recommendations that do not hold the launch back', () => {
    const facts = { ...fresh, readyStores: 1, listedProducts: 1 };
    expect(progressOf({ ...facts, moderationStatus: BrandModerationStatus.PENDING }).complete).toBe(false);
    expect(progressOf({ ...facts, moderationStatus: BrandModerationStatus.APPROVED })).toMatchObject({
      brandProfile: false,
      photos: false,
      done: 4,
      complete: true,
    });
  });

  it('counts a brand that has sold as launched, whatever the checklist says', () => {
    expect(progressOf({ ...fresh, moderationStatus: BrandModerationStatus.APPROVED, hasOrders: true })).toMatchObject({
      menu: false,
      done: 2,
      complete: true,
    });
  });
});

describe('onboardingProgressOf', () => {
  it('works out many brands from a few grouped queries', async () => {
    const groupBy = (rows: Array<{ brandId: string; n: number }>) =>
      jest.fn().mockResolvedValue(rows.map((r) => ({ brandId: r.brandId, _count: { _all: r.n } })));
    const productGroups = groupBy([{ brandId: 'live', n: 2 }]);
    // On the menu: two of «live», one of «half» and one of «new»; «new»'s has a variant and no add-on.
    const listed = jest.fn().mockResolvedValue([
      { id: 'l1', brandId: 'live' },
      { id: 'l2', brandId: 'live' },
      { id: 'h1', brandId: 'half' },
      { id: 'n1', brandId: 'new' },
    ]);
    const prisma = {
      store: {
        groupBy: groupBy([{ brandId: 'live', n: 2 }]),
        findMany: jest.fn().mockResolvedValue([{ brandId: 'sold' }]),
      },
      product: { groupBy: productGroups, findMany: listed },
      ...optionTablesFake(['l1', 'l2', 'h1'], ['n1']),
    };

    const progress = await onboardingProgressOf(prisma as unknown as PrismaService, [
      { id: 'live', logoUrl: 'x', moderationStatus: BrandModerationStatus.APPROVED },
      { id: 'half', logoUrl: 'x', moderationStatus: BrandModerationStatus.PENDING },
      { id: 'new', logoUrl: null, moderationStatus: BrandModerationStatus.PENDING },
      { id: 'sold', logoUrl: null, moderationStatus: BrandModerationStatus.APPROVED },
    ]);

    expect(progress.get('live')).toMatchObject({ done: 4, photos: true, complete: true });
    expect(progress.get('half')).toMatchObject({ store: false, menu: true, photos: false, done: 2 });
    expect(progress.get('new')).toMatchObject({ menu: false, done: 1, complete: false });
    // A test sale is a launch, photos or not.
    expect(progress.get('sold')).toMatchObject({ menu: false, hasOrders: true, complete: true });
    expect(prisma.store.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          brandId: { in: ['live', 'half', 'new', 'sold'] },
          addressLine: { not: '' },
          workingHours: { some: { isClosed: false } },
        }),
      }),
    );
    expect(listed).toHaveBeenCalledWith({
      where: {
        brandId: { in: ['live', 'half', 'new', 'sold'] },
        visible: true,
        category: { visible: true, addOnsOnly: false },
      },
      select: { id: true, brandId: true },
    });
    expect(prisma.store.findMany).toHaveBeenCalledWith({
      where: {
        brandId: { in: ['live', 'half', 'new', 'sold'] },
        orders: { some: { status: { notIn: ['CANCELLED', 'EXPIRED'] } } },
      },
      distinct: ['brandId'],
      select: { brandId: true },
    });
  });

  it('asks nothing for no brands', async () => {
    const prisma = { store: { groupBy: jest.fn() } };
    await expect(onboardingProgressOf(prisma as unknown as PrismaService, [])).resolves.toEqual(new Map());
    expect(prisma.store.groupBy).not.toHaveBeenCalled();
  });
});
