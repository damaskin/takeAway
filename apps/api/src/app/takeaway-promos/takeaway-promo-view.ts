import { BadRequestException, ConflictException } from '@nestjs/common';
import type { TakeawayPromo as TakeawayPromoRow } from '@prisma/client';
import {
  takeawayPromoEffectiveStatus,
  type TakeawayPromo,
  type TakeawayPromoAdminErrorCode,
  type TakeawayPromoLine,
} from '@takeaway/shared-types';

/**
 * A 400 / 409 of the platform admin's «Акции takeAway» screens, with a
 * stable `code` beside the English message (docs/takeaway-promos.md §4.1).
 */
export function takeawayPromoError(
  status: 400 | 409,
  code: TakeawayPromoAdminErrorCode,
  message: string,
): BadRequestException | ConflictException {
  const body = { statusCode: status, error: status === 409 ? 'Conflict' : 'Bad Request', code, message };
  return status === 409 ? new ConflictException(body) : new BadRequestException(body);
}

/** The admin's row of a promo: the stored fields plus what they mean now. */
export function toTakeawayPromoDto(row: TakeawayPromoRow, redemptionsCount: number, now = new Date()): TakeawayPromo {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    percent: row.percent,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    currency: row.currency,
    budgetCents: row.budgetCents,
    spentCents: row.spentCents,
    leftCents: Math.max(0, row.budgetCents - row.spentCents),
    status: row.status,
    effectiveStatus: takeawayPromoEffectiveStatus(row, now),
    isWelcome: row.isWelcome,
    redemptionsCount,
    editable: redemptionsCount === 0,
    createdAt: row.createdAt.toISOString(),
  };
}

/** What an order read needs of its takeAway promo: the redemption's snapshot and the promo's name. */
export const TAKEAWAY_LINE_SELECT = {
  code: true,
  percent: true,
  menuTotalCents: true,
  discountCents: true,
  promo: { select: { name: true } },
} as const;

export interface TakeawayLineSource {
  code: string;
  percent: number;
  menuTotalCents: number;
  discountCents: number;
  promo: { name: string };
}

/**
 * «Акция takeAway −10%: гость оплатил 90,00, ещё 10,00 компенсирует
 * takeAway». Read from the redemption, so a cancelled or expired order
 * (whose redemption is gone with the budget it gave back) has none.
 */
export function toTakeawayPromoLine(source: TakeawayLineSource | null | undefined): TakeawayPromoLine | null {
  if (!source) return null;
  return {
    code: source.code,
    name: source.promo.name,
    percent: source.percent,
    menuTotalCents: source.menuTotalCents,
    discountCents: source.discountCents,
    paidByGuestCents: source.menuTotalCents - source.discountCents,
  };
}

/** Prisma's unique-constraint violation. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}
