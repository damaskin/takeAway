import { Injectable, NotFoundException } from '@nestjs/common';
import { BrandModerationStatus } from '@prisma/client';

import { OnboardingNotifier } from '../../onboarding/onboarding-notifier.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { SetBrandModerationDto } from './dto/admin-brand-moderation.dto';

/**
 * Platform-side moderation of self-registered brands: the decision, and
 * telling the owner about it.
 */
@Injectable()
export class BrandModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: OnboardingNotifier,
  ) {}

  /** Feeds the badge on «Бренды» in the platform admin's sidebar. */
  async pendingCount(): Promise<{ count: number }> {
    const count = await this.prisma.brand.count({ where: { moderationStatus: BrandModerationStatus.PENDING } });
    return { count };
  }

  /**
   * Returned with `owner` and `_count` so the brands page can swap the card
   * in place. The owner is emailed only when the status actually changes to
   * a decision; sending a brand back to PENDING is an internal matter.
   */
  async setModeration(id: string, dto: SetBrandModerationDto) {
    const current = await this.prisma.brand.findUnique({ where: { id }, select: { moderationStatus: true } });
    if (!current) throw new NotFoundException('Brand not found');

    const pending = dto.status === BrandModerationStatus.PENDING;
    const updated = await this.prisma.brand.update({
      where: { id },
      data: {
        moderationStatus: dto.status,
        moderationNote: pending ? null : dto.note || null,
        moderatedAt: pending ? null : new Date(),
      },
      include: {
        owner: { select: { id: true, email: true, name: true, phone: true } },
        _count: { select: { stores: true, products: true } },
      },
    });

    if (!pending && current.moderationStatus !== dto.status) {
      void this.notifier.brandModerated(id, dto.status);
    }
    return updated;
  }
}
