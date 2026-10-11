import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Currency, Prisma, PromoStatus, PromoType } from '@prisma/client';
import { PROMO_TRANSITIONS, type PromoErrorCode, isPromoEditable, promoEffectiveStatus } from '@takeaway/shared-types';

import type { BrandScopeService } from '../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { checkoutError } from '../common/http/checkout-error';
import { isInactiveCustomer } from '../customers/customer-segment';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApplyPromoInput,
  ApplyPromoResultDto,
  CreatePromoDto,
  PromoDto,
  UpdatePromoDto,
  UpdatePromoStatusDto,
  ValidPromoResultDto,
} from './dto/promo.dto';

type PrismaTx = Prisma.TransactionClient;

/** Stable codes on the admin's promo errors, beside the English message. */
export type PromoAdminErrorCode =
  | 'PROMO_CODE_TAKEN'
  | 'PROMO_NOT_EDITABLE'
  | 'PROMO_STATUS_NOT_ALLOWED'
  | 'PROMO_ENDED'
  | 'PROMO_DATES'
  | 'PROMO_STORE';

function promoError(status: 400 | 409, code: PromoAdminErrorCode, message: string): Error {
  const body = { statusCode: status, error: status === 409 ? 'Conflict' : 'Bad Request', code, message };
  return status === 409 ? new ConflictException(body) : new BadRequestException(body);
}

/** Starting a promo stores SCHEDULED until its start date, RUNNING after — both work at checkout. */
function activeStatus(startsAt: Date, now: Date): PromoStatus {
  return startsAt.getTime() > now.getTime() ? PromoStatus.SCHEDULED : PromoStatus.RUNNING;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

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
    now = new Date(),
  ): Promise<ValidPromoResultDto> {
    const promo = await this.prisma.promo.findUnique({
      where: { brandId_code: { brandId, code: code.toUpperCase() } },
      include: { _count: { select: { redemptions: true } } },
    });

    if (!promo) return this.invalid('PROMO_UNKNOWN', 'Unknown promo code');
    // SCHEDULED is a started promo waiting for its date: it works from startsAt.
    if (promo.status !== PromoStatus.RUNNING && promo.status !== PromoStatus.SCHEDULED) {
      return this.invalid('PROMO_INACTIVE', 'Promo is not active');
    }

    if (now < promo.startsAt) return this.invalid('PROMO_NOT_STARTED', 'Promo has not started yet');
    if (now > promo.endsAt) return this.invalid('PROMO_EXPIRED', 'Promo has expired');

    if (promo.minSubtotalCents && subtotalCents < promo.minSubtotalCents) {
      return {
        ...this.invalid(
          'PROMO_MIN_ORDER',
          `Minimum order is ${(promo.minSubtotalCents / 100).toFixed(2)} ${promo.currency}`,
        ),
        minOrderCents: promo.minSubtotalCents,
        currency: promo.currency,
      };
    }

    const redemptionsCount = promo._count.redemptions;
    if (promo.maxRedemptions > 0 && redemptionsCount >= promo.maxRedemptions) {
      return this.invalid('PROMO_LIMIT_REACHED', 'Promo reached its usage limit');
    }

    if (userId && promo.perUserLimit > 0) {
      const usedByUser = await this.prisma.promoRedemption.count({
        where: { promoId: promo.id, userId },
      });
      if (usedByUser >= promo.perUserLimit) {
        return this.invalid('PROMO_ALREADY_USED', 'You already used this promo');
      }
    }

    // A win-back code: only for regulars who have not ordered for a while.
    // A guest preview cannot tell; the order itself is checked signed in.
    if (userId && promo.inactiveDays !== null) {
      const eligible = await isInactiveCustomer(
        this.prisma,
        { brandIds: [promo.brandId], storeIds: promo.segmentStoreId ? [promo.segmentStoreId] : null },
        userId,
        promo.inactiveDays,
        now,
      );
      if (!eligible) {
        return this.invalid('PROMO_NOT_ELIGIBLE', 'This code is for customers who have not ordered for a while');
      }
    }

    const { discountCents, pointsMultiplier } = this.computeReward(promo.type, promo.value, subtotalCents);

    return {
      valid: true,
      reason: null,
      reasonCode: null,
      promo: this.toDto(promo, redemptionsCount, now),
      discountCents,
      pointsMultiplier,
    };
  }

  /**
   * Locks a promo against an order inside a transaction. Called by the order
   * creation pipeline. Throws BadRequestException if the code is no longer
   * valid (race condition after validate()).
   */
  /**
   * Hand the promo back when an order never completes.
   *
   * Redemption is recorded the moment the order is created, so an
   * abandoned checkout used to burn the customer's one-per-user allowance
   * and a slot of the campaign's total. Deleting the row restores both —
   * `validate` counts rows, it does not keep a separate counter.
   *
   * Safe to call for an order that never carried a promo.
   */
  async releaseForOrder(tx: PrismaTx, orderId: string): Promise<void> {
    await tx.promoRedemption.deleteMany({ where: { orderId } });
  }

  async applyAndRedeem(input: ApplyPromoInput, orderId: string, tx: PrismaTx): Promise<ApplyPromoResultDto> {
    const res = await this.validate(input.userId, input.code, input.brandId, input.subtotalCents);
    if (!res.valid || !res.promo) {
      throw checkoutError(res.reasonCode ?? 'PROMO_UNKNOWN', res.reason ?? 'Promo invalid', {
        minOrderCents: res.minOrderCents,
        currency: res.currency,
      });
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

  /**
   * `scope` semantics match BrandScopeService.resolveBrandIds:
   * `null` = no filter (SUPER_ADMIN), array = restrict to those brands.
   */
  async list(scope: string[] | null): Promise<PromoDto[]> {
    const promos = await this.prisma.promo.findMany({
      where: scope === null ? undefined : { brandId: { in: scope } },
      include: { _count: { select: { redemptions: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return promos.map((p) => this.toDto(p, p._count.redemptions));
  }

  /** Throws if the promo's brand is outside the caller's scope. */
  async assertOwned(user: AuthenticatedUser, promoId: string, scope: BrandScopeService): Promise<void> {
    const promo = await this.prisma.promo.findUnique({ where: { id: promoId }, select: { brandId: true } });
    if (!promo) throw new NotFoundException('Promo not found');
    await scope.assertBrand(user, promo.brandId);
  }

  async get(id: string): Promise<PromoDto> {
    const promo = await this.prisma.promo.findUnique({
      where: { id },
      include: { _count: { select: { redemptions: true } } },
    });
    if (!promo) throw new NotFoundException('Promo not found');
    return this.toDto(promo, promo._count.redemptions);
  }

  async create(dto: CreatePromoDto, now = new Date()): Promise<PromoDto> {
    const starts = new Date(dto.startsAt);
    const ends = new Date(dto.endsAt);
    this.assertDates(starts, ends);
    this.assertValidValue(dto.type, dto.value);
    if (dto.segmentStoreId) await this.assertStore(dto.brandId, dto.segmentStoreId);
    const status = !dto.status || dto.status === PromoStatus.DRAFT ? PromoStatus.DRAFT : activeStatus(starts, now);

    try {
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
          status,
          currency: dto.currency ?? Currency.USD,
          inactiveDays: dto.inactiveDays ?? null,
          segmentStoreId: dto.inactiveDays ? (dto.segmentStoreId ?? null) : null,
        },
        include: { _count: { select: { redemptions: true } } },
      });
      return this.toDto(promo, promo._count.redemptions);
    } catch (err) {
      throw this.codeTaken(err, dto.code);
    }
  }

  /**
   * Edits a promo while nothing depends on its terms yet: a draft, or a
   * scheduled or paused promo that nobody has redeemed. Anything else
   * answers 409 PROMO_NOT_EDITABLE — only its status may move.
   */
  async update(id: string, dto: UpdatePromoDto, now = new Date()): Promise<PromoDto> {
    const current = await this.prisma.promo.findUnique({
      where: { id },
      include: { _count: { select: { redemptions: true } } },
    });
    if (!current) throw new NotFoundException('Promo not found');
    if (!isPromoEditable({ ...current, redemptionsCount: current._count.redemptions }, now)) {
      throw promoError(
        409,
        'PROMO_NOT_EDITABLE',
        'Only a draft, or a scheduled or paused promo nobody used, can change',
      );
    }

    const starts = dto.startsAt ? new Date(dto.startsAt) : current.startsAt;
    const ends = dto.endsAt ? new Date(dto.endsAt) : current.endsAt;
    this.assertDates(starts, ends);
    const type = dto.type ?? current.type;
    const value = dto.value ?? current.value;
    this.assertValidValue(type, value);
    const inactiveDays = dto.inactiveDays === undefined ? current.inactiveDays : dto.inactiveDays;
    const storeId = dto.segmentStoreId === undefined ? current.segmentStoreId : dto.segmentStoreId;
    if (inactiveDays !== null && storeId) await this.assertStore(current.brandId, storeId);
    // A started promo whose start moved keeps saying the truth about it.
    const status =
      current.status === PromoStatus.SCHEDULED || current.status === PromoStatus.RUNNING
        ? activeStatus(starts, now)
        : current.status;

    try {
      const promo = await this.prisma.promo.update({
        where: { id },
        data: {
          code: dto.code?.toUpperCase(),
          label: dto.label,
          type,
          value,
          minSubtotalCents: dto.minSubtotalCents,
          maxRedemptions: dto.maxRedemptions,
          perUserLimit: dto.perUserLimit,
          startsAt: starts,
          endsAt: ends,
          currency: dto.currency,
          status,
          inactiveDays,
          segmentStoreId: inactiveDays === null ? null : storeId,
        },
        include: { _count: { select: { redemptions: true } } },
      });
      return this.toDto(promo, promo._count.redemptions);
    } catch (err) {
      throw this.codeTaken(err, dto.code ?? current.code);
    }
  }

  /**
   * Moves a promo along draft → active → paused → ended
   * ({@link PROMO_TRANSITIONS}), judged by the status it has now — an
   * active promo past its end is already ended. Starting or resuming stores
   * SCHEDULED until the start date; a promo past its end cannot start
   * again (move the dates first, or make a new one).
   */
  async updateStatus(id: string, dto: UpdatePromoStatusDto, now = new Date()): Promise<PromoDto> {
    const existing = await this.prisma.promo.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Promo not found');
    // Older admins asked for SCHEDULED to start a promo; it means the same.
    const target = dto.status === PromoStatus.SCHEDULED ? PromoStatus.RUNNING : dto.status;
    const from = promoEffectiveStatus(existing, now);
    if (!PROMO_TRANSITIONS[from].includes(target)) {
      throw promoError(409, 'PROMO_STATUS_NOT_ALLOWED', `A ${from} promo cannot become ${target}`);
    }
    if (target === PromoStatus.RUNNING && existing.endsAt.getTime() <= now.getTime()) {
      throw promoError(400, 'PROMO_ENDED', 'The promo is past its end date — move the end date first');
    }
    const promo = await this.prisma.promo.update({
      where: { id },
      data: { status: target === PromoStatus.RUNNING ? activeStatus(existing.startsAt, now) : target },
      include: { _count: { select: { redemptions: true } } },
    });
    return this.toDto(promo, promo._count.redemptions, now);
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

  private assertDates(starts: Date, ends: Date): void {
    if (ends <= starts) throw promoError(400, 'PROMO_DATES', 'endsAt must be later than startsAt');
  }

  /** A win-back code narrowed to a store must name a store of the promo's brand. */
  private async assertStore(brandId: string, storeId: string): Promise<void> {
    const store = await this.prisma.store.findFirst({ where: { id: storeId, brandId }, select: { id: true } });
    if (!store) throw promoError(400, 'PROMO_STORE', 'That store is not one of the brand');
  }

  private codeTaken(err: unknown, code: string): unknown {
    if (!isUniqueViolation(err)) return err;
    return promoError(409, 'PROMO_CODE_TAKEN', `The code ${code.toUpperCase()} is already used by another promo`);
  }

  private assertValidValue(type: PromoType, value: number): void {
    if (type === PromoType.PERCENT && (value < 1 || value > 100)) {
      throw new BadRequestException('PERCENT value must be 1..100');
    }
    if (type === PromoType.POINTS_MULTIPLIER && (value < 10 || value > 100)) {
      throw new BadRequestException('POINTS_MULTIPLIER value must be 10..100 (×10)');
    }
  }

  private invalid(reasonCode: PromoErrorCode, reason: string): ValidPromoResultDto {
    return { valid: false, reason, reasonCode, promo: null, discountCents: 0, pointsMultiplier: 1 };
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
      inactiveDays: number | null;
      segmentStoreId: string | null;
    },
    redemptionsCount: number,
    now = new Date(),
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
      status: promoEffectiveStatus(promo, now),
      currency: promo.currency,
      redemptionsCount,
      inactiveDays: promo.inactiveDays,
      segmentStoreId: promo.segmentStoreId,
    };
  }
}
