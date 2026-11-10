import { Injectable, Logger } from '@nestjs/common';
import type { Currency, Prisma } from '@prisma/client';
import type { PromoErrorCode } from '@takeaway/shared-types';
import { takeawayPromoBudgetFits, takeawayPromoDiscountCents } from '@takeaway/utils';

import { checkoutError } from '../common/http/checkout-error';
import { PrismaService } from '../prisma/prisma.service';
import type { ValidPromoResultDto } from '../promo/dto/promo.dto';
import { isUniqueViolation } from './takeaway-promo-view';

type PrismaTx = Prisma.TransactionClient;

/** Where the cart is, for the currency check: the checkout knows the store's currency, a preview may name the store. */
export interface TakeawayPromoPlace {
  /** The store's currency, when the caller has it (checkout). */
  currency?: string;
  /** The store of the cart; its currency is looked up. */
  storeId?: string;
  /** Without a store: the promo works when any store of the brand sells in its currency. */
  brandId?: string;
}

/** What `POST /orders` writes for an order that holds a takeAway promo. */
export interface TakeawayReservation {
  promoId: string;
  code: string;
  percent: number;
  isWelcome: boolean;
  userId: string;
  orderId: string;
  brandId: string;
  storeId: string;
  currency: Currency;
  /** P. */
  menuTotalCents: number;
  /** D, as the order was priced with. */
  discountCents: number;
}

/**
 * The customer's side of «Акции takeAway» (docs/takeaway-promos.md): checks a
 * code, takes the discount from the budget with the order and gives it back
 * when the order does not happen. The money rule is `@takeaway/utils`
 * (takeaway-promo.ts); the platform admin's side is TakeawayPromoAdminService.
 */
@Injectable()
export class TakeawayPromoService {
  private readonly logger = new Logger(TakeawayPromoService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** A takeAway promo holds this code — a brand promo may not take it (§2.1). */
  async codeTaken(code: string): Promise<boolean> {
    const promo = await this.prisma.takeawayPromo.findUnique({
      where: { code: normalizeCode(code) },
      select: { id: true },
    });
    return promo !== null;
  }

  /**
   * Checks a code against takeAway promos: null when none has it (the code
   * is unknown), otherwise the answer of `/promo/validate` (§4.3). Pure: the
   * budget is only taken by {@link reserveForOrder}.
   *
   * `userId` null is a guest preview: the once-per-customer rule cannot be
   * checked, and a welcome code is never valid for a guest.
   */
  async validate(
    input: { userId: string | null; code: string; subtotalCents: number; place: TakeawayPromoPlace },
    now = new Date(),
  ): Promise<ValidPromoResultDto | null> {
    const promo = await this.prisma.takeawayPromo.findUnique({ where: { code: normalizeCode(input.code) } });
    if (!promo) return null;

    if (promo.status === 'DISABLED') return invalid('PROMO_INACTIVE', 'Promo is not active');
    if (now < promo.startsAt) return invalid('PROMO_NOT_STARTED', 'Promo has not started yet');
    if (now > promo.endsAt) return invalid('PROMO_EXPIRED', 'Promo has expired');
    if (promo.status === 'EXHAUSTED') return invalid('PROMO_LIMIT_REACHED', 'The promo budget is used up');

    const currencies = await this.currenciesAt(input.place);
    if (!currencies.includes(promo.currency)) {
      return {
        ...invalid('PROMO_NOT_HERE', `The promo works at venues selling in ${promo.currency}`),
        currency: promo.currency,
      };
    }

    if (promo.isWelcome) {
      if (!input.userId) return invalid('PROMO_NOT_ELIGIBLE', 'The welcome bonus is for the customer who received it');
      const bonus = await this.prisma.welcomeBonus.findUnique({ where: { userId: input.userId } });
      if (!bonus || bonus.promoId !== promo.id) {
        return invalid('PROMO_NOT_ELIGIBLE', 'The welcome bonus is for the customer who received it');
      }
      if (bonus.orderId) return invalid('PROMO_ALREADY_USED', 'You already used your welcome bonus');
      if (bonus.expiresAt <= now) return invalid('PROMO_EXPIRED', 'Your welcome bonus has expired');
    }

    if (input.userId) {
      const used = await this.prisma.takeawayPromoRedemption.findUnique({
        where: { promoId_userId: { promoId: promo.id, userId: input.userId } },
        select: { id: true },
      });
      if (used) return invalid('PROMO_ALREADY_USED', 'You already used this promo');
    }

    const discountCents = takeawayPromoDiscountCents(input.subtotalCents, promo.percent);
    if (!takeawayPromoBudgetFits(promo.budgetCents, promo.spentCents, discountCents)) {
      return invalid('PROMO_LIMIT_REACHED', 'The promo budget cannot take this order');
    }

    return {
      valid: true,
      reason: null,
      reasonCode: null,
      promo: null,
      source: 'TAKEAWAY',
      takeawayPromo: {
        id: promo.id,
        code: promo.code,
        name: promo.name,
        percent: promo.percent,
        isWelcome: promo.isWelcome,
      },
      discountCents,
      pointsMultiplier: 1,
    };
  }

  /**
   * Takes D from the budget for a new order, inside the order's transaction
   * (§2.4): the redemption first — the unique (promo, customer) pair is the
   * once-per-customer rule, and a second checkout of the same customer waits
   * on it — then one conditional update that only matches while the promo is
   * ACTIVE, inside its dates and D still fits. Two checkouts at once queue on
   * the promo's row and the second re-reads what the first left, so the
   * budget is never overspent (the DB CHECK is the floor under it). The
   * update that takes the last of it exhausts the promo at once.
   *
   * Throws the checkout's 400 when the promo cannot be had any more; the
   * transaction then rolls back with the order, and the caller exhausts a
   * promo whose budget was the reason ({@link exhaustIfShort}).
   */
  async reserveForOrder(tx: PrismaTx, r: TakeawayReservation, now = new Date()): Promise<void> {
    try {
      await tx.takeawayPromoRedemption.create({
        data: {
          promoId: r.promoId,
          userId: r.userId,
          orderId: r.orderId,
          brandId: r.brandId,
          storeId: r.storeId,
          currency: r.currency,
          code: r.code,
          percent: r.percent,
          menuTotalCents: r.menuTotalCents,
          discountCents: r.discountCents,
        },
      });
    } catch (err) {
      // Left to bubble, a P2002 would read as an order-code clash and be retried.
      if (isUniqueViolation(err)) throw checkoutError('PROMO_ALREADY_USED', 'You already used this promo');
      throw err;
    }

    const at = now.toISOString();
    const taken = await tx.$executeRaw`
      UPDATE "TakeawayPromo"
      SET "spentCents" = "spentCents" + ${r.discountCents},
          "status" = CASE WHEN "spentCents" + ${r.discountCents} = "budgetCents"
                          THEN 'EXHAUSTED'::"TakeawayPromoStatus" ELSE "status" END,
          "exhaustedAt" = CASE WHEN "spentCents" + ${r.discountCents} = "budgetCents"
                               THEN ${at}::timestamp ELSE "exhaustedAt" END,
          "updatedAt" = ${at}::timestamp
      WHERE "id" = ${r.promoId}
        AND "status" = 'ACTIVE'
        AND "startsAt" <= ${at}::timestamp
        AND "endsAt" >= ${at}::timestamp
        AND "spentCents" + ${r.discountCents} <= "budgetCents"
    `;
    if (taken === 0) throw checkoutError('PROMO_LIMIT_REACHED', 'The promo budget cannot take this order');

    if (r.isWelcome) {
      const claimed = await tx.welcomeBonus.updateMany({
        where: { userId: r.userId, promoId: r.promoId, orderId: null, expiresAt: { gt: now } },
        data: { orderId: r.orderId },
      });
      if (claimed.count === 0) {
        const bonus = await tx.welcomeBonus.findUnique({ where: { userId: r.userId } });
        if (!bonus || bonus.promoId !== r.promoId) {
          throw checkoutError('PROMO_NOT_ELIGIBLE', 'The welcome bonus is for the customer who received it');
        }
        if (bonus.orderId) throw checkoutError('PROMO_ALREADY_USED', 'You already used your welcome bonus');
        throw checkoutError('PROMO_EXPIRED', 'Your welcome bonus has expired');
      }
    }

    this.logger.log(
      `[takeaway-promo] user=${r.userId} order=${r.orderId} code=${r.code} P=${r.menuTotalCents} D=${r.discountCents}`,
    );
  }

  /**
   * Gives the promo back when an order does not happen — cancelled, expired
   * unpaid, or the card declined on accept: the redemption goes, D returns
   * to the budget and the welcome bonus is free again. A promo exhausted
   * meanwhile stays so (§2.5): the platform admin switches it back on.
   * Safe for an order that never had one.
   */
  async releaseForOrder(tx: PrismaTx, orderId: string): Promise<void> {
    await tx.welcomeBonus.updateMany({ where: { orderId }, data: { orderId: null } });
    const redemption = await tx.takeawayPromoRedemption.findUnique({
      where: { orderId },
      select: { id: true, promoId: true, discountCents: true },
    });
    if (!redemption) return;
    const { count } = await tx.takeawayPromoRedemption.deleteMany({ where: { id: redemption.id } });
    if (count === 0) return;
    await tx.takeawayPromo.update({
      where: { id: redemption.promoId },
      data: { spentCents: { decrement: redemption.discountCents } },
    });
  }

  /**
   * A checkout refused for the budget: when the discount of this order does
   * not fit what is left, the promo stops for everyone (§2.5) — the next
   * customer is told so at once instead of at the payment. Run after the
   * order's transaction rolled back; a promo refused for any other reason,
   * or a brand's code, is left alone.
   */
  async exhaustIfShort(code: string, menuTotalCents: number, now = new Date()): Promise<boolean> {
    const promo = await this.prisma.takeawayPromo.findUnique({
      where: { code: normalizeCode(code) },
      select: { id: true, percent: true, status: true },
    });
    if (!promo || promo.status !== 'ACTIVE') return false;
    const discountCents = takeawayPromoDiscountCents(menuTotalCents, promo.percent);
    const at = now.toISOString();
    const updated = await this.prisma.$executeRaw`
      UPDATE "TakeawayPromo"
      SET "status" = 'EXHAUSTED'::"TakeawayPromoStatus",
          "exhaustedAt" = ${at}::timestamp,
          "updatedAt" = ${at}::timestamp
      WHERE "id" = ${promo.id}
        AND "status" = 'ACTIVE'
        AND "spentCents" + ${discountCents} > "budgetCents"
    `;
    if (updated > 0)
      this.logger.log(`[takeaway-promo] ${promo.id} exhausted: a discount of ${discountCents} did not fit`);
    return updated > 0;
  }

  /** The currencies the cart's place sells in. */
  private async currenciesAt(place: TakeawayPromoPlace): Promise<string[]> {
    if (place.currency) return [place.currency];
    if (place.storeId) {
      const store = await this.prisma.store.findUnique({
        where: { id: place.storeId },
        select: { currency: true, brandId: true },
      });
      // A store of another brand than the cart's says nothing about this cart.
      if (store && (!place.brandId || store.brandId === place.brandId)) return [store.currency];
    }
    if (!place.brandId) return [];
    const stores = await this.prisma.store.findMany({
      where: { brandId: place.brandId },
      select: { currency: true },
      distinct: ['currency'],
    });
    return stores.map((s) => s.currency);
  }
}

/** Codes are stored uppercase; the customer may type them any way. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function invalid(reasonCode: PromoErrorCode, reason: string): ValidPromoResultDto {
  return {
    valid: false,
    reason,
    reasonCode,
    promo: null,
    source: null,
    takeawayPromo: null,
    discountCents: 0,
    pointsMultiplier: 1,
  };
}
