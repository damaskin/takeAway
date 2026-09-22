import { NotFoundException } from '@nestjs/common';
import { BrandModerationStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import type { OnboardingNotifier } from '../../onboarding/onboarding-notifier.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { BrandModerationService } from './brand-moderation.service';
import { SetBrandModerationDto } from './dto/admin-brand-moderation.dto';

const { PENDING, APPROVED, REJECTED } = BrandModerationStatus;

describe('SetBrandModerationDto', () => {
  async function invalidFields(body: Record<string, unknown>): Promise<string[]> {
    const errors = await validate(plainToInstance(SetBrandModerationDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return errors.map((e) => e.property);
  }

  it('needs a reason to reject — blank does not count', async () => {
    await expect(invalidFields({ status: REJECTED })).resolves.toEqual(['note']);
    await expect(invalidFields({ status: REJECTED, note: '   ' })).resolves.toEqual(['note']);
    await expect(invalidFields({ status: REJECTED, note: 'Добавьте фото товаров' })).resolves.toEqual([]);
  });

  it('approves and reverts without one', async () => {
    await expect(invalidFields({ status: APPROVED })).resolves.toEqual([]);
    await expect(invalidFields({ status: PENDING, note: '' })).resolves.toEqual([]);
    await expect(invalidFields({ status: APPROVED, note: null })).resolves.toEqual([]);
  });

  it('still caps the length of a note that is given', async () => {
    await expect(invalidFields({ status: APPROVED, note: 'x'.repeat(1001) })).resolves.toEqual(['note']);
  });
});

describe('BrandModerationService', () => {
  let prisma: { brand: { findUnique: jest.Mock; update: jest.Mock; count: jest.Mock } };
  let notifier: { brandModerated: jest.Mock };
  let service: BrandModerationService;

  function currently(status: BrandModerationStatus | null) {
    prisma.brand.findUnique.mockResolvedValue(status ? { moderationStatus: status } : null);
  }

  beforeEach(() => {
    prisma = {
      brand: {
        findUnique: jest.fn(),
        update: jest.fn(({ data }) => Promise.resolve({ id: 'b1', ...data })),
        count: jest.fn().mockResolvedValue(3),
      },
    };
    notifier = { brandModerated: jest.fn().mockResolvedValue(undefined) };
    service = new BrandModerationService(prisma as unknown as PrismaService, notifier as unknown as OnboardingNotifier);
  });

  it('rejects with the reason and emails the owner', async () => {
    currently(PENDING);

    await service.setModeration('b1', { status: REJECTED, note: 'Нет фото товаров' });

    expect(prisma.brand.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'b1' },
        data: { moderationStatus: REJECTED, moderationNote: 'Нет фото товаров', moderatedAt: expect.any(Date) },
      }),
    );
    expect(notifier.brandModerated).toHaveBeenCalledWith('b1', REJECTED);
  });

  it('approves and emails the owner', async () => {
    currently(REJECTED);

    await service.setModeration('b1', { status: APPROVED });

    expect(prisma.brand.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ moderationStatus: APPROVED, moderationNote: null }) }),
    );
    expect(notifier.brandModerated).toHaveBeenCalledWith('b1', APPROVED);
  });

  it('sends a brand back to review quietly, with the old verdict cleared', async () => {
    currently(APPROVED);

    await service.setModeration('b1', { status: PENDING });

    expect(prisma.brand.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { moderationStatus: PENDING, moderationNote: null, moderatedAt: null } }),
    );
    expect(notifier.brandModerated).not.toHaveBeenCalled();
  });

  it('does not email the same verdict twice', async () => {
    currently(APPROVED);

    await service.setModeration('b1', { status: APPROVED });

    expect(notifier.brandModerated).not.toHaveBeenCalled();
  });

  it('answers the moderation page even while the mail is still going out', async () => {
    currently(PENDING);
    notifier.brandModerated.mockReturnValue(new Promise(() => undefined));

    await expect(service.setModeration('b1', { status: APPROVED })).resolves.toEqual(
      expect.objectContaining({ moderationStatus: APPROVED }),
    );
  });

  it('404s an unknown brand', async () => {
    currently(null);

    await expect(service.setModeration('nope', { status: APPROVED })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.brand.update).not.toHaveBeenCalled();
  });

  it('counts the brands waiting for review', async () => {
    await expect(service.pendingCount()).resolves.toEqual({ count: 3 });
    expect(prisma.brand.count).toHaveBeenCalledWith({ where: { moderationStatus: PENDING } });
  });
});
