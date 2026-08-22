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

/**
 * What a point is worth when spent, in cents. Paired with the earn rate
 * above this is a 1% return, which is deliberately modest: points are a
 * reason to come back, not a discount scheme, and a generous rate is very
 * hard to walk back once customers have banked a balance.
 */
const POINT_VALUE_CENTS = 1;

/**
 * Floor on a redemption. Burning nine points to save nine cents wastes
 * everyone's attention and clutters the ledger.
 */
const MIN_REDEEMABLE_POINTS = 100;

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

  /**
   * Flat-amount EARN credit not tied to an order subtotal — used by the
   * referral bonus (and any future signup / birthday / win-back rewards).
   * Goes through the same ledger/tier path as regular order credits, so
   * recent activity and tier progression include it.
   */
  async creditBonus(userId: string, amount: number, reason: string, tx: PrismaTx, orderId?: string): Promise<void> {
    if (amount <= 0) return;
    const account = await this.ensureAccount(userId, tx);
    await this.applyDelta(account, amount, 'EARN', `bonus:${reason}`, tx, {
      orderId,
      type: PointsEntryType.EARN,
      reason,
      metadata: null,
    });
  }

  /**
   * Work out what a customer may actually spend, given what they asked
   * for, what they have, and what the order costs.
   *
   * Returns zero rather than throwing when a redemption is not possible —
   * an empty balance or a tiny order is a normal state, not an error, and
   * the checkout should quietly show no points row.
   */
  async quoteRedemption(
    userId: string,
    requestedPoints: number,
    payableCents: number,
  ): Promise<{ points: number; discountCents: number }> {
    const none = { points: 0, discountCents: 0 };
    if (!Number.isFinite(requestedPoints) || requestedPoints < MIN_REDEEMABLE_POINTS) return none;
    if (payableCents <= 0) return none;

    const account = await this.ensureAccount(userId);
    // Three ceilings: what they asked for, what they hold, and what the
    // order is worth. Points must never turn into a cash refund.
    const affordable = Math.min(
      Math.floor(requestedPoints),
      account.pointsBalance,
      Math.floor(payableCents / POINT_VALUE_CENTS),
    );
    if (affordable < MIN_REDEEMABLE_POINTS) return none;

    return { points: affordable, discountCents: affordable * POINT_VALUE_CENTS };
  }

  /** Value of a point in cents — the checkout needs it to render a preview. */
  get pointValueCents(): number {
    return POINT_VALUE_CENTS;
  }

  /** Fewest points worth redeeming. */
  get minRedeemablePoints(): number {
    return MIN_REDEEMABLE_POINTS;
  }

  /**
   * Put points back when an order never completes. Mirrors the promo and
   * gift-card release: the balance is drawn at order creation, so an
   * abandoned checkout would otherwise eat points the customer earned.
   */
  async releaseForOrder(tx: PrismaTx, orderId: string): Promise<void> {
    const spend = await tx.pointsLedger.findFirst({
      where: { orderId, type: PointsEntryType.SPEND },
      orderBy: { createdAt: 'desc' },
    });
    if (!spend) return;

    const account = await this.ensureAccount(spend.userId, tx);
    await this.applyDelta(account, Math.abs(spend.amount), 'EARN', `refund:${orderId}`, tx, {
      orderId,
      type: PointsEntryType.EARN,
      reason: `Refunded ${Math.abs(spend.amount)} pts from order ${orderId}`,
      metadata: null,
      countsTowardLifetime: false,
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
      /**
       * Whether a positive delta advances the tier. False for giving back
       * points a cancelled order had taken: that is undoing a spend, not
       * earning, and counting it would let a customer promote themselves
       * by ordering and cancelling.
       */
      countsTowardLifetime?: boolean;
    },
  ): Promise<void> {
    const nextBalance = account.pointsBalance + delta;
    const earns = delta > 0 && entry.countsTowardLifetime !== false;
    const nextLifetime = earns ? account.lifetimePoints + delta : account.lifetimePoints;
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
