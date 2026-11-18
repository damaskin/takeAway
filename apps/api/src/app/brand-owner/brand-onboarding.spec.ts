import { BrandModerationStatus } from '@prisma/client';

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
  it('works out many brands from four grouped queries', async () => {
    const groupBy = (rows: Array<{ brandId: string; n: number }>) =>
      jest.fn().mockResolvedValue(rows.map((r) => ({ brandId: r.brandId, _count: { _all: r.n } })));
    const productGroups = jest.fn(({ where }: { where: Record<string, unknown> }) =>
      'imageUrls' in where
        ? groupBy([{ brandId: 'live', n: 2 }])()
        : groupBy([
            { brandId: 'live', n: 5 },
            { brandId: 'half', n: 4 },
          ])(),
    );
    const prisma = {
      store: {
        groupBy: groupBy([{ brandId: 'live', n: 2 }]),
        findMany: jest.fn().mockResolvedValue([{ brandId: 'sold' }]),
      },
      product: { groupBy: productGroups },
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
    expect(progress.get('half')).toMatchObject({ store: false, menu: true, photos: false, done: 1 });
    expect(progress.get('new')).toMatchObject({ done: 0, payments: false, complete: false });
    expect(progress.get('half')).toMatchObject({ payments: false });
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
    expect(productGroups).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ visible: true, category: { visible: true, addOnsOnly: false } }),
      }),
    );
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
