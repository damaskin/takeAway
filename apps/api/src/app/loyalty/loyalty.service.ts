import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LoyaltyAccount, LoyaltyTier, PointsEntryType, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { LoyaltyAccountDto, LoyaltyEntryDto } from './dto/loyalty.dto';

/**
 * Lifetime-points thresholds per tier. Ordered ascending — we pick the
 * highest tier a user has cleared.
 */
const TIER_THRESHOLDS: Array<{ tier: LoyaltyTier; min: number }> = [
  { tier: LoyaltyTier.SILVER, min: 0 },
  { tier: LoyaltyTier.GOLD, min: 1_500 },
  { tier: LoyaltyTier.PLATINUM, min: 3_000 },
  { tier: LoyaltyTier.SIGNATURE, min: 10_000 },
];

/** 1 point per whole dollar (100 cents). Adjust centrally here. */
const POINTS_PER_CENT = 1 / 100;

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Ensure a row exists; safe to call repeatedly (idempotent). */
  async ensureAccount(userId: string, tx?: PrismaTx): Promise<LoyaltyAccount> {
    const client = tx ?? this.prisma;
    return client.loyaltyAccount.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  async getForUser(userId: string): Promise<LoyaltyAccountDto> {
    const account = await this.ensureAccount(userId);
    const recent = await this.prisma.pointsLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const nextThreshold = TIER_THRESHOLDS.find((t) => t.min > account.lifetimePoints);
    const currentThreshold =
      [...TIER_THRESHOLDS].reverse().find((t) => t.min <= account.lifetimePoints) ?? TIER_THRESHOLDS[0];

    let pointsToNextTier = 0;
    let tierProgressPercent = 100;
    if (nextThreshold && currentThreshold) {
      const span = nextThreshold.min - currentThreshold.min;
      const done = account.lifetimePoints - currentThreshold.min;
      pointsToNextTier = Math.max(0, nextThreshold.min - account.lifetimePoints);
      tierProgressPercent = span > 0 ? Math.min(100, Math.round((done / span) * 100)) : 0;
    }

    return {
      userId: account.userId,
      pointsBalance: account.pointsBalance,
      lifetimePoints: account.lifetimePoints,
      tier: account.tier,
      nextTier: nextThreshold?.tier ?? null,
      pointsToNextTier,
      tierProgressPercent,
      recent: recent.map(
        (e): LoyaltyEntryDto => ({
          id: e.id,
          type: e.type,
          amount: e.amount,
          reason: e.reason,
          orderId: e.orderId,
          createdAt: e.createdAt.toISOString(),
        }),
      ),
    };
  }

  /**
   * Credit points after a successful order payment.
   * Called from OrdersService / PaymentsService inside a transaction.
   */
  async creditForOrder(
    userId: string,
    orderId: string,
    subtotalCents: number,
    pointsMultiplier: number,
    tx: PrismaTx,
  ): Promise<void> {
    const baseAmount = Math.max(0, Math.floor(subtotalCents * POINTS_PER_CENT));
    const amount = Math.floor(baseAmount * pointsMultiplier);
    if (amount <= 0) return;

    const account = await this.ensureAccount(userId, tx);
    await this.applyDelta(account, amount, 'EARN', `order:${orderId}`, tx, {
      orderId,
      type: PointsEntryType.EARN,
      reason: `Order ${orderId} · +${amount} pts`,
      metadata: { subtotalCents, pointsMultiplier },
    });
  }

  /** Debit points when a promo consumes them. */
  async debit(userId: string, orderId: string | null, amount: number, reason: string, tx: PrismaTx): Promise<void> {
    if (amount <= 0) return;
    const account = await this.ensureAccount(userId, tx);
    if (account.pointsBalance < amount) {
      throw new NotFoundException('Not enough loyalty points');
    }
    await this.applyDelta(account, -amount, 'SPEND', reason, tx, {
      orderId: orderId ?? undefined,
      type: PointsEntryType.SPEND,
      reason,
      metadata: null,
    });
  }

  private async applyDelta(
    account: LoyaltyAccount,
    delta: number,
    _kind: 'EARN' | 'SPEND',
    _ledgerTag: string,
    tx: PrismaTx,
    entry: {
      orderId?: string;
      type: PointsEntryType;
      reason: string;
      metadata: Prisma.InputJsonValue | null;
    },
  ): Promise<void> {
    const nextBalance = account.pointsBalance + delta;
    const nextLifetime = delta > 0 ? account.lifetimePoints + delta : account.lifetimePoints;
    const nextTier = this.tierFor(nextLifetime);

    await tx.loyaltyAccount.update({
      where: { id: account.id },
      data: {
        pointsBalance: nextBalance,
        lifetimePoints: nextLifetime,
        tier: nextTier,
      },
    });

    await tx.pointsLedger.create({
      data: {
        loyaltyAccountId: account.id,
        userId: account.userId,
        orderId: entry.orderId ?? null,
        type: entry.type,
        amount: delta,
        reason: entry.reason,
        metadata: entry.metadata ?? Prisma.DbNull,
      },
    });

    if (nextTier !== account.tier) {
      this.logger.log(`[loyalty] user=${account.userId} tier ${account.tier} → ${nextTier} (lifetime=${nextLifetime})`);
    }
  }

  private tierFor(lifetimePoints: number): LoyaltyTier {
    // Walk from the highest tier down to SILVER; first hit wins.
    for (let i = TIER_THRESHOLDS.length - 1; i >= 0; i--) {
      const rule = TIER_THRESHOLDS[i];
      if (rule && lifetimePoints >= rule.min) return rule.tier;
    }
    return LoyaltyTier.SILVER;
  }
}
