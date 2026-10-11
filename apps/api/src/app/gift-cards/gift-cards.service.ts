import { randomInt } from 'node:crypto';

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Currency, GiftCard, GiftCardStatus, Prisma } from '@prisma/client';
import type { GiftCardErrorCode } from '@takeaway/shared-types';

import { checkoutError } from '../common/http/checkout-error';
import { codedConflict } from '../common/http/coded-conflict';
import { PrismaService } from '../prisma/prisma.service';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
const DEFAULT_CODE_LENGTH = 12;

/** The refusal code for a card that is no longer ACTIVE. */
const GIFT_CARD_STATUS_CODES: Record<Exclude<GiftCardStatus, 'ACTIVE'>, GiftCardErrorCode> = {
  REDEEMED: 'GIFT_CARD_USED_UP',
  EXPIRED: 'GIFT_CARD_EXPIRED',
  CANCELLED: 'GIFT_CARD_CANCELLED',
};

interface ValidatedGiftCard {
  giftCardId: string;
  amountCents: number;
  remainingCents: number;
  currency: Currency;
}

@Injectable()
export class GiftCardsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate a code at checkout. Returns the maximum amount we can apply
   * to an order with this code given the order subtotal — the caller
   * decides how much to actually consume (typically `min(subtotal, balance)`).
   * Throws when the card is unusable so the customer sees a clean 400.
   */
  async validateForOrder(input: {
    code: string;
    brandId: string;
    subtotalCents: number;
    currency: Currency;
  }): Promise<ValidatedGiftCard> {
    const code = normalizeCode(input.code);
    const card = await this.prisma.giftCard.findUnique({ where: { code } });
    // The English messages stay word for word: app builds released before
    // the codes tell the reasons apart by them.
    if (!card) throw checkoutError('GIFT_CARD_UNKNOWN', 'Gift card not found');
    if (card.brandId !== input.brandId)
      throw checkoutError('GIFT_CARD_OTHER_BRAND', 'Gift card is not valid at this brand');
    if (card.currency !== input.currency)
      throw checkoutError(
        'GIFT_CARD_CURRENCY',
        `Gift card currency (${card.currency}) does not match the order currency`,
      );
    if (card.status !== 'ACTIVE')
      throw checkoutError(GIFT_CARD_STATUS_CODES[card.status], `Gift card is ${card.status.toLowerCase()}`);
    if (card.expiresAt && card.expiresAt < new Date()) {
      // Mark as expired in passing — saves a sweep cron.
      await this.prisma.giftCard.update({ where: { id: card.id }, data: { status: 'EXPIRED' } });
      throw checkoutError('GIFT_CARD_EXPIRED', 'Gift card has expired');
    }
    if (card.balanceCents <= 0) throw checkoutError('GIFT_CARD_USED_UP', 'Gift card has no remaining balance');

    const amountCents = Math.min(card.balanceCents, input.subtotalCents);
    return {
      giftCardId: card.id,
      amountCents,
      remainingCents: card.balanceCents - amountCents,
      currency: card.currency,
    };
  }

  /**
   * Lock in the redemption row and decrement the card balance. Called
   * inside the order-creation transaction so a failure after this point
   * rolls the balance back automatically.
   *
   * The balance was checked by {@link validateForOrder} before the
   * transaction, so two checkouts with the same card at the same moment both
   * saw the full balance and both spent it. The debit is therefore
   * conditional — it only matches while the card is still ACTIVE and still
   * holds the amount — and Postgres re-checks that condition on the row lock,
   * so of two racing orders exactly one debit lands. The loser gets 409
   * `GIFT_CARD_BALANCE_CHANGED` and its whole order rolls back.
   */
  async applyRedemption(
    tx: Prisma.TransactionClient,
    input: { giftCardId: string; orderId: string; amountCents: number },
  ): Promise<void> {
    if (input.amountCents <= 0) return;
    const debited = await tx.giftCard.updateMany({
      where: { id: input.giftCardId, status: 'ACTIVE', balanceCents: { gte: input.amountCents } },
      data: { balanceCents: { decrement: input.amountCents } },
    });
    if (debited.count !== 1) {
      throw codedConflict(
        'GIFT_CARD_BALANCE_CHANGED',
        'The gift card balance changed while the order was being placed. Check the card and try again.',
      );
    }
    await tx.giftCardRedemption.create({
      data: {
        giftCardId: input.giftCardId,
        orderId: input.orderId,
        amountCents: input.amountCents,
      },
    });
    const updated = await tx.giftCard.findUniqueOrThrow({
      where: { id: input.giftCardId },
      select: { balanceCents: true },
    });
    // If we drained the card, flip the status so it falls out of the
    // ACTIVE-list filter even before the next sweep.
    if (updated.balanceCents <= 0) {
      await tx.giftCard.update({ where: { id: input.giftCardId }, data: { status: 'REDEEMED' } });
    }
  }

  /**
   * Put the money back on the card when an order never completes.
   *
   * The balance is drawn down at order creation, so an abandoned checkout
   * silently ate part of a gift someone paid for. Restores the balance,
   * drops the redemption row, and reopens a card that the redemption had
   * flipped to REDEEMED.
   *
   * Safe to call for an order that never used a gift card.
   */
  async releaseForOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const redemption = await tx.giftCardRedemption.findUnique({ where: { orderId } });
    if (!redemption) return;

    await tx.giftCardRedemption.delete({ where: { id: redemption.id } });
    const card = await tx.giftCard.update({
      where: { id: redemption.giftCardId },
      data: { balanceCents: { increment: redemption.amountCents } },
    });
    // Only reopen a card we ourselves drained. CANCELLED and EXPIRED are
    // deliberate states and must survive a refund.
    if (card.status === 'REDEEMED' && card.balanceCents > 0) {
      await tx.giftCard.update({ where: { id: card.id }, data: { status: 'ACTIVE' } });
    }
  }

  // ── Admin issue ──────────────────────────────────────────────────────────

  /**
   * BRAND_ADMIN-driven creation. The caller's brand scope is checked at
   * the controller layer; this service trusts the brandId.
   */
  async issue(input: {
    brandId: string;
    amountCents: number;
    currency: Currency;
    recipientEmail?: string | null;
    recipientName?: string | null;
    message?: string | null;
    expiresAt?: Date | null;
    purchaserUserId?: string | null;
  }): Promise<GiftCard> {
    if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
      throw new BadRequestException('amountCents must be positive');
    }
    // Retry on the (extremely unlikely) code collision rather than bubbling
    // a P2002 to the caller.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      try {
        return await this.prisma.giftCard.create({
          data: {
            code,
            brandId: input.brandId,
            initialAmountCents: input.amountCents,
            balanceCents: input.amountCents,
            currency: input.currency,
            recipientEmail: input.recipientEmail ?? null,
            recipientName: input.recipientName ?? null,
            message: input.message ?? null,
            expiresAt: input.expiresAt ?? null,
            purchaserUserId: input.purchaserUserId ?? null,
          },
        });
      } catch (err) {
        const isUnique =
          typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'P2002';
        if (!isUnique) throw err;
      }
    }
    throw new BadRequestException('Could not allocate a unique code, please retry');
  }

  /** Admin list — scoped to brand. */
  list(brandId: string): Promise<GiftCard[]> {
    return this.prisma.giftCard.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * Customer-facing list of gift cards the user has redeemed against
   * their orders. We don't have a "purchased by user" relation in v1
   * (cards are admin-issued), so this is always the redemption history.
   */
  async listMine(userId: string): Promise<
    Array<{
      orderId: string;
      orderCode: string;
      code: string;
      amountCents: number;
      currency: string;
      brandName: string;
      createdAt: string;
    }>
  > {
    const rows = await this.prisma.giftCardRedemption.findMany({
      where: { order: { userId } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        giftCard: { include: { brand: { select: { name: true } } } },
        order: { select: { orderCode: true } },
      },
    });
    return rows.map((r) => ({
      orderId: r.orderId,
      orderCode: r.order.orderCode,
      code: r.giftCard.code,
      amountCents: r.amountCents,
      currency: r.giftCard.currency,
      brandName: r.giftCard.brand.name,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Admin cancel — refuses if any redemptions already exist. */
  async cancel(brandId: string, giftCardId: string): Promise<GiftCard> {
    const card = await this.prisma.giftCard.findUnique({ where: { id: giftCardId } });
    if (!card) throw new NotFoundException('Gift card not found');
    if (card.brandId !== brandId) throw new ForbiddenException('Cross-brand access denied');
    if (card.status === 'CANCELLED') return card;
    if (card.status === 'REDEEMED') throw new BadRequestException('Gift card is already fully redeemed');
    return this.prisma.giftCard.update({
      where: { id: giftCardId },
      data: { status: 'CANCELLED', balanceCents: 0 },
    });
  }
}

function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** The code is the card's only secret, so it comes from the CSPRNG, not Math.random. */
function generateCode(): string {
  let out = '';
  for (let i = 0; i < DEFAULT_CODE_LENGTH; i++) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}
