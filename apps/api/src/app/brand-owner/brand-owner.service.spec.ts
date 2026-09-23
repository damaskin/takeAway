import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BrandModerationStatus, Currency, Locale, Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { FeatureFlagsService } from '../config/feature-flags.service';
import type { OnboardingNotifier } from '../onboarding/onboarding-notifier.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import { BrandOwnerService } from './brand-owner.service';

function userWith(role: Role, id = 'u1'): AuthenticatedUser {
  return { id, phone: null, email: null, name: null, role };
}

const owner = userWith(Role.BRAND_ADMIN, 'owner1');
const platformAdmin = userWith(Role.SUPER_ADMIN, 'root');

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ConflictException);
    return ((err as ConflictException).getResponse() as { code?: string }).code;
  }
  throw new Error('expected a ConflictException');
}

describe('BrandOwnerService', () => {
  let prisma: {
    brand: Record<'findFirst' | 'findUnique' | 'findUniqueOrThrow' | 'update' | 'updateMany', jest.Mock>;
    order: { findFirst: jest.Mock };
    store: { count: jest.Mock };
    category: { count: jest.Mock };
    product: { count: jest.Mock };
  };
  let notifier: { brandResubmitted: jest.Mock };
  let flags: { agroprombankEnabled: boolean };
  let service: BrandOwnerService;

  beforeEach(() => {
    prisma = {
      brand: {
        findFirst: jest.fn().mockResolvedValue({ id: 'b1', slug: 'alpha', currency: Currency.MDL }),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'b1', name: 'Alpha' }),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'b1', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      store: { count: jest.fn().mockResolvedValue(0) },
      category: { count: jest.fn().mockResolvedValue(0) },
      product: { count: jest.fn().mockResolvedValue(0) },
    };
    notifier = { brandResubmitted: jest.fn().mockResolvedValue(undefined) };
    flags = { agroprombankEnabled: false };
    service = new BrandOwnerService(
      prisma as unknown as PrismaService,
      {} as StorageService,
      flags as unknown as FeatureFlagsService,
      notifier as unknown as OnboardingNotifier,
    );
  });

  describe('which brand', () => {
    it('gives an owner who names no brand their oldest one, not whichever row comes first', async () => {
      await service.get(owner);

      expect(prisma.brand.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerId: 'owner1' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      );
      expect(prisma.brand.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b1' } }));
    });

    // The header selector sends the brand in view; before, an owner of two
    // brands edited an arbitrary one whatever the selector showed.
    it('follows the brand picked in the header when the owner owns it', async () => {
      prisma.brand.findFirst.mockResolvedValue({ id: 'b2', slug: 'beta', currency: Currency.MDL });

      await service.update(owner, { name: 'Renamed' }, 'b2');

      expect(prisma.brand.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'b2', ownerId: 'owner1' } }),
      );
      expect(prisma.brand.update).toHaveBeenCalledWith({ where: { id: 'b2' }, data: { name: 'Renamed' } });
    });

    it('refuses a brand that belongs to someone else, and changes nothing', async () => {
      prisma.brand.findFirst.mockResolvedValue(null);

      await expect(service.update(owner, { name: 'Mine now' }, 'rival')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.brand.update).not.toHaveBeenCalled();
    });

    it('resolves a SUPER_ADMIN to the brand they are acting on', async () => {
      prisma.brand.findUnique.mockResolvedValue({ id: 'b7', slug: 'seven', currency: Currency.USD });

      await service.get(platformAdmin, 'b7');

      expect(prisma.brand.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b7' } }));
      expect(prisma.brand.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to the first brand by name when a SUPER_ADMIN sends no brandId', async () => {
      await service.get(platformAdmin);

      expect(prisma.brand.findFirst).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { name: 'asc' } }));
    });

    it('404s a SUPER_ADMIN on an install with no brands at all', async () => {
      prisma.brand.findFirst.mockResolvedValue(null);

      await expect(service.get(platformAdmin)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('currency and language', () => {
    it('changes the currency while the brand has no orders', async () => {
      await service.update(owner, { currency: Currency.RUP, locale: Locale.RU });

      expect(prisma.brand.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { currency: Currency.RUP, locale: Locale.RU },
      });
    });

    it('refuses a new currency once the brand has taken an order', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'o1' });

      await expect(codeOf(service.update(owner, { currency: Currency.USD }))).resolves.toBe('CURRENCY_LOCKED');
      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { store: { brandId: 'b1' } } }),
      );
      expect(prisma.brand.update).not.toHaveBeenCalled();
    });

    it('lets the settings form resend the same currency even after orders', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'o1' });

      await service.update(owner, { currency: Currency.MDL, name: 'Alpha' });

      expect(prisma.order.findFirst).not.toHaveBeenCalled();
      expect(prisma.brand.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { name: 'Alpha' } });
    });

    it('tells /settings up front whether the currency can still change', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'o1' });

      await expect(service.get(owner)).resolves.toEqual(expect.objectContaining({ currencyLocked: true }));
    });
  });

  describe('resubmit', () => {
    it('puts a rejected brand back in the queue, clears the verdict and tells the platform', async () => {
      await service.resubmit(owner);

      expect(prisma.brand.updateMany).toHaveBeenCalledWith({
        where: { id: 'b1', moderationStatus: BrandModerationStatus.REJECTED },
        data: {
          moderationStatus: BrandModerationStatus.PENDING,
          moderationNote: null,
          moderatedAt: null,
          submittedAt: expect.any(Date),
        },
      });
      expect(notifier.brandResubmitted).toHaveBeenCalledWith('b1');
    });

    it('refuses a brand that is not rejected, and wakes nobody', async () => {
      prisma.brand.updateMany.mockResolvedValue({ count: 0 });

      await expect(codeOf(service.resubmit(owner))).resolves.toBe('NOT_REJECTED');
      expect(notifier.brandResubmitted).not.toHaveBeenCalled();
    });
  });

  describe('onboarding checklist', () => {
    function brandState(logoUrl: string | null, moderationStatus: BrandModerationStatus) {
      prisma.brand.findUniqueOrThrow.mockResolvedValue({ logoUrl, moderationStatus, moderationNote: null });
    }

    it('reports a fresh brand as having everything still to do', async () => {
      brandState(null, BrandModerationStatus.PENDING);

      await expect(service.onboarding(owner)).resolves.toEqual({
        brandId: 'b1',
        moderationStatus: BrandModerationStatus.PENDING,
        moderationNote: null,
        brandProfile: false,
        store: false,
        menu: false,
        cardPayments: false,
        complete: false,
      });
    });

    it('counts only stores with an address and opening hours, and products with a photo', async () => {
      brandState('https://cdn/logo.png', BrandModerationStatus.PENDING);
      prisma.store.count.mockResolvedValue(1);
      prisma.category.count.mockResolvedValue(2);
      prisma.product.count.mockResolvedValue(3);

      const result = await service.onboarding(owner);

      expect(prisma.store.count).toHaveBeenCalledWith({
        where: { brandId: 'b1', addressLine: { not: '' }, workingHours: { some: { isClosed: false } } },
      });
      expect(prisma.product.count).toHaveBeenCalledWith({ where: { brandId: 'b1', imageUrls: { isEmpty: false } } });
      expect(result).toEqual(expect.objectContaining({ brandProfile: true, store: true, menu: true }));
      // Everything is set up, but the brand is still waiting for review.
      expect(result.complete).toBe(false);
    });

    it('is complete once every step is done and the brand is approved', async () => {
      brandState('https://cdn/logo.png', BrandModerationStatus.APPROVED);
      prisma.store.count.mockResolvedValue(1);
      prisma.category.count.mockResolvedValue(1);
      prisma.product.count.mockResolvedValue(1);
      flags.agroprombankEnabled = true;

      await expect(service.onboarding(owner)).resolves.toEqual(
        expect.objectContaining({ cardPayments: true, complete: true }),
      );
    });

    it('does not count a menu with categories but no photographed product', async () => {
      brandState('https://cdn/logo.png', BrandModerationStatus.APPROVED);
      prisma.category.count.mockResolvedValue(4);
      prisma.product.count.mockResolvedValue(0);

      await expect(service.onboarding(owner)).resolves.toEqual(
        expect.objectContaining({ menu: false, complete: false }),
      );
    });
  });
});
