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
  paymentTerminal: false,
  hasOrders: false,
};

describe('progressOf', () => {
  it('starts at 0 of 4: payments wait for the brand terminal', () => {
    expect(progressOf(fresh)).toEqual({
      brandProfile: false,
      store: false,
      menu: false,
      photos: false,
      payments: false,
      approved: false,
      hasOrders: false,
      done: 0,
      total: 4,
      complete: false,
    });
  });

  it('needs a product customers can see for the menu, not a photo of it', () => {
    const p = progressOf({ ...fresh, readyStores: 1, listedProducts: 3 });
    expect(p).toMatchObject({ store: true, menu: true, photos: false, done: 2 });
  });

  it('takes the logo and photos as recommendations that do not hold the launch back', () => {
    const facts = { ...fresh, readyStores: 1, listedProducts: 1, paymentTerminal: true };
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
      done: 1,
      complete: true,
    });
  });

  it('counts payments once the brand terminal is connected', () => {
    expect(progressOf({ ...fresh, paymentTerminal: true })).toMatchObject({ payments: true, done: 1 });
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
      paymentTerminal: {
        findMany: jest.fn().mockResolvedValue([
          // A QR section is enough; a retired row is never read (where: retiredAt null).
          { brandId: 'live', cardMerchantId: null, webMerchantLogin: null, qrTerminalId: 'QRT000000000000001' },
          { brandId: 'half', cardMerchantId: null, webMerchantLogin: null, qrTerminalId: null },
        ]),
      },
    };

    const progress = await onboardingProgressOf(prisma as unknown as PrismaService, [
      { id: 'live', logoUrl: 'x', moderationStatus: BrandModerationStatus.APPROVED },
      { id: 'half', logoUrl: 'x', moderationStatus: BrandModerationStatus.PENDING },
      { id: 'new', logoUrl: null, moderationStatus: BrandModerationStatus.PENDING },
      { id: 'sold', logoUrl: null, moderationStatus: BrandModerationStatus.APPROVED },
    ]);

    expect(progress.get('live')).toMatchObject({ done: 4, photos: true, complete: true });
    expect(progress.get('half')).toMatchObject({ store: false, menu: true, photos: false, payments: false, done: 1 });
    expect(progress.get('new')).toMatchObject({ menu: false, payments: false, done: 0, complete: false });
    expect(prisma.paymentTerminal.findMany).toHaveBeenCalledWith({
      where: { brandId: { in: ['live', 'half', 'new', 'sold'] }, retiredAt: null },
    });
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
