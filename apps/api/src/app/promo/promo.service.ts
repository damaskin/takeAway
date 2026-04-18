import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Currency, Prisma, PromoStatus, PromoType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  ApplyPromoInput,
  ApplyPromoResultDto,
  CreatePromoDto,
  PromoDto,
  UpdatePromoStatusDto,
  ValidPromoResultDto,
} from './dto/promo.dto';

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class PromoService {
  private readonly logger = new Logger(PromoService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────────────────
  // Customer-facing validation
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Pure validation: does this promo work for this user right now?
   * Does NOT create a redemption — checkout does that via applyAndRedeem().
   */
  async validate(
    userId: string | null,
    code: string,
    brandId: string,
    subtotalCents: number,
  ): Promise<ValidPromoResultDto> {
    const promo = await this.prisma.promo.findUnique({
      where: { brandId_code: { brandId, code: code.toUpperCase() } },
      include: { _count: { select: { redemptions: true } } },
    });

    if (!promo) return this.invalid('Unknown promo code');
    if (promo.status !== PromoStatus.RUNNING) return this.invalid('Promo is not active');

    const now = new Date();
    if (now < promo.startsAt) return this.invalid('Promo has not started yet');
    if (now > promo.endsAt) return this.invalid('Promo has expired');

    if (promo.minSubtotalCents && subtotalCents < promo.minSubtotalCents) {
      return this.invalid(`Minimum order is ${(promo.minSubtotalCents / 100).toFixed(2)} ${promo.currency}`);
    }

    const redemptionsCount = promo._count.redemptions;
    if (promo.maxRedemptions > 0 && redemptionsCount >= promo.maxRedemptions) {
      return this.invalid('Promo reached its usage limit');
    }

    if (userId && promo.perUserLimit > 0) {
      const usedByUser = await this.prisma.promoRedemption.count({
        where: { promoId: promo.id, userId },
      });
      if (usedByUser >= promo.perUserLimit) {
        return this.invalid('You already used this promo');
      }
    }

    const { discountCents, pointsMultiplier } = this.computeReward(promo.type, promo.value, subtotalCents);

    return {
      valid: true,
      reason: null,
      promo: this.toDto(promo, redemptionsCount),
      discountCents,
      pointsMultiplier,
    };
  }

  /**
   * Locks a promo against an order inside a transaction. Called by the order
   * creation pipeline. Throws BadRequestException if the code is no longer
   * valid (race condition after validate()).
   */
  async applyAndRedeem(input: ApplyPromoInput, orderId: string, tx: PrismaTx): Promise<ApplyPromoResultDto> {
    const res = await this.validate(input.userId, input.code, input.brandId, input.subtotalCents);
    if (!res.valid || !res.promo) {
      throw new BadRequestException(res.reason ?? 'Promo invalid');
    }

    await tx.promoRedemption.create({
      data: {
        promoId: res.promo.id,
        userId: input.userId,
        orderId,
        discountCents: res.discountCents,
      },
    });

    this.logger.log(
      `[promo] user=${input.userId} order=${orderId} code=${res.promo.code} discount=${res.discountCents} mult=${res.pointsMultiplier}`,
    );

    return {
      discountCents: res.discountCents,
      pointsMultiplier: res.pointsMultiplier,
      promoId: res.promo.id,
      code: res.promo.code,
      label: res.promo.label,
      type: res.promo.type,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Admin CRUD
  // ────────────────────────────────────────────────────────────────────────

  async list(brandId?: string): Promise<PromoDto[]> {
    const promos = await this.prisma.promo.findMany({
      where: brandId ? { brandId } : undefined,
      include: { _count: { select: { redemptions: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return promos.map((p) => this.toDto(p, p._count.redemptions));
  }

  async create(dto: CreatePromoDto): Promise<PromoDto> {
    const starts = new Date(dto.startsAt);
    const ends = new Date(dto.endsAt);
    if (ends <= starts) {
      throw new BadRequestException('endsAt must be later than startsAt');
    }
    this.assertValidValue(dto.type, dto.value);

    const promo = await this.prisma.promo.create({
      data: {
        brandId: dto.brandId,
        code: dto.code.toUpperCase(),
        label: dto.label,
        type: dto.type,
        value: dto.value,
        minSubtotalCents: dto.minSubtotalCents ?? null,
        maxRedemptions: dto.maxRedemptions ?? 0,
        perUserLimit: dto.perUserLimit ?? 0,
        startsAt: starts,
        endsAt: ends,
        status: dto.status ?? PromoStatus.DRAFT,
        currency: dto.currency ?? Currency.USD,
      },
      include: { _count: { select: { redemptions: true } } },
    });
    return this.toDto(promo, promo._count.redemptions);
  }

  async updateStatus(id: string, dto: UpdatePromoStatusDto): Promise<PromoDto> {
    const exists = await this.prisma.promo.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Promo not found');
    const promo = await this.prisma.promo.update({
      where: { id },
      data: { status: dto.status },
      include: { _count: { select: { redemptions: true } } },
    });
    return this.toDto(promo, promo._count.redemptions);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────

  private computeReward(
    type: PromoType,
    value: number,
    subtotalCents: number,
  ): { discountCents: number; pointsMultiplier: number } {
    switch (type) {
      case PromoType.PERCENT: {
        const pct = Math.min(100, Math.max(0, value));
        return {
          discountCents: Math.floor((subtotalCents * pct) / 100),
          pointsMultiplier: 1,
        };
      }
      case PromoType.FIXED:
        return {
          discountCents: Math.min(subtotalCents, Math.max(0, value)),
          pointsMultiplier: 1,
        };
      case PromoType.BOGO:
        // Simplified: half off subtotal (assuming a 2-item basket).
        return {
          discountCents: Math.floor(subtotalCents / 2),
          pointsMultiplier: 1,
        };
      case PromoType.POINTS_MULTIPLIER:
        // value is multiplier ×10; clamp to reasonable range.
        return {
          discountCents: 0,
          pointsMultiplier: Math.min(10, Math.max(1, value)) / 10,
        };
      default:
        return { discountCents: 0, pointsMultiplier: 1 };
    }
  }

  private assertValidValue(type: PromoType, value: number): void {
    if (type === PromoType.PERCENT && (value < 1 || value > 100)) {
      throw new BadRequestException('PERCENT value must be 1..100');
    }
    if (type === PromoType.POINTS_MULTIPLIER && (value < 10 || value > 100)) {
      throw new BadRequestException('POINTS_MULTIPLIER value must be 10..100 (×10)');
    }
  }

  private invalid(reason: string): ValidPromoResultDto {
    return { valid: false, reason, promo: null, discountCents: 0, pointsMultiplier: 1 };
  }

  private toDto(
    promo: {
      id: string;
      brandId: string;
      code: string;
      label: string;
      type: PromoType;
      value: number;
      minSubtotalCents: number | null;
      maxRedemptions: number;
      perUserLimit: number;
      startsAt: Date;
      endsAt: Date;
      status: PromoStatus;
      currency: Currency;
    },
    redemptionsCount: number,
  ): PromoDto {
    return {
      id: promo.id,
      brandId: promo.brandId,
      code: promo.code,
      label: promo.label,
      type: promo.type,
      value: promo.value,
      minSubtotalCents: promo.minSubtotalCents,
      maxRedemptions: promo.maxRedemptions,
      perUserLimit: promo.perUserLimit,
      startsAt: promo.startsAt.toISOString(),
      endsAt: promo.endsAt.toISOString(),
      status: promo.status,
      currency: promo.currency,
      redemptionsCount,
    };
  }
}
