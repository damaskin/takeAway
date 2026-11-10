import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, TakeawayPromo as TakeawayPromoRow } from '@prisma/client';
import type {
  CreateTakeawayPromoInput,
  TakeawayDebtReport,
  TakeawayPromo,
  TakeawayPromoReport,
  UpdateTakeawayPromoInput,
  UpdateTakeawayPromoStatusInput,
} from '@takeaway/shared-types';
import { isValidTakeawayPromoPercent } from '@takeaway/utils';

import { PrismaService } from '../prisma/prisma.service';
import { countedRedemptions, debtReport, promoReportFigures } from './takeaway-debt';
import { normalizeCode } from './takeaway-promo.service';
import { isUniqueViolation, takeawayPromoError, toTakeawayPromoDto } from './takeaway-promo-view';

type Db = Pick<Prisma.TransactionClient, 'promo' | 'takeawayPromo'>;
type RowWithCount = TakeawayPromoRow & { _count: { redemptions: number } };

const WITH_COUNT = { _count: { select: { redemptions: true } } } as const;
/** Largest amount an Int column holds. */
const MAX_INT = 2_147_483_647;

/**
 * The platform admin's «Акции takeAway» (docs/takeaway-promos.md §4.1):
 * the promos, their edit rules (§2.7), switching on and off, the per-promo
 * report and takeAway's debt to every brand. SUPER_ADMIN only — the
 * controller says so.
 */
@Injectable()
export class TakeawayPromoAdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** Newest first. */
  async list(now = new Date()): Promise<TakeawayPromo[]> {
    const rows = await this.prisma.takeawayPromo.findMany({ orderBy: { createdAt: 'desc' }, include: WITH_COUNT });
    return rows.map((r) => toTakeawayPromoDto(r, r._count.redemptions, now));
  }

  async get(id: string, now = new Date()): Promise<TakeawayPromo> {
    const row = await this.read(this.prisma, id);
    return toTakeawayPromoDto(row, row._count.redemptions, now);
  }

  async create(input: CreateTakeawayPromoInput, createdById: string, now = new Date()): Promise<TakeawayPromo> {
    const code = normalizeCode(input.code);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    const isWelcome = input.isWelcome ?? false;
    assertDates(startsAt, endsAt);
    assertPercent(input.percent);
    assertBudget(input.budgetCents, 0);
    await this.assertCodeFree(this.prisma, code, null);
    if (isWelcome && endsAt >= now) await this.assertWelcomeFree(this.prisma, null, now);

    try {
      const row = await this.prisma.takeawayPromo.create({
        data: {
          name: input.name.trim(),
          code,
          percent: input.percent,
          startsAt,
          endsAt,
          currency: input.currency as TakeawayPromoRow['currency'],
          budgetCents: input.budgetCents,
          isWelcome,
          createdById,
        },
      });
      return toTakeawayPromoDto(row, 0, now);
    } catch (err) {
      throw isUniqueViolation(err) ? codeTaken(code) : err;
    }
  }

  /**
   * §2.7: unused, every field may change; used (an order holds it), only
   * the name, the end and the budget — never below what was spent. Sending
   * a frozen field unchanged is fine (the form posts all of them). The row
   * is locked first, so the first order and this edit cannot cross: a
   * checkout's redemption waits on the lock, and the edit sees it if it
   * came first.
   */
  async update(id: string, input: UpdateTakeawayPromoInput, now = new Date()): Promise<TakeawayPromo> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "TakeawayPromo" WHERE "id" = ${id} FOR UPDATE`;
        const current = await this.read(tx, id);
        const next = {
          name: input.name?.trim() ?? current.name,
          code: input.code !== undefined ? normalizeCode(input.code) : current.code,
          percent: input.percent ?? current.percent,
          startsAt: input.startsAt !== undefined ? new Date(input.startsAt) : current.startsAt,
          endsAt: input.endsAt !== undefined ? new Date(input.endsAt) : current.endsAt,
          currency: (input.currency ?? current.currency) as TakeawayPromoRow['currency'],
          budgetCents: input.budgetCents ?? current.budgetCents,
          isWelcome: input.isWelcome ?? current.isWelcome,
        };

        if (current._count.redemptions > 0) {
          const frozen = [
            next.code !== current.code && 'code',
            next.percent !== current.percent && 'percent',
            next.currency !== current.currency && 'currency',
            next.startsAt.getTime() !== current.startsAt.getTime() && 'startsAt',
            next.isWelcome !== current.isWelcome && 'isWelcome',
          ].filter((f): f is string => typeof f === 'string');
          if (frozen.length > 0) {
            throw takeawayPromoError(
              409,
              'TAKEAWAY_PROMO_USED',
              `The promo has orders already: ${frozen.join(', ')} can no longer change`,
            );
          }
        }
        assertDates(next.startsAt, next.endsAt);
        assertPercent(next.percent);
        assertBudget(next.budgetCents, current.spentCents);
        if (next.code !== current.code) await this.assertCodeFree(tx, next.code, id);
        if (next.isWelcome && current.status === 'ACTIVE' && next.endsAt >= now) {
          await this.assertWelcomeFree(tx, id, now);
        }

        // A budget cut down to what was spent leaves nothing: the promo stops,
        // as when the last order took it (§2.5).
        const exhaust = current.status === 'ACTIVE' && next.budgetCents <= current.spentCents;
        const row = await tx.takeawayPromo.update({
          where: { id },
          data: { ...next, ...(exhaust ? { status: 'EXHAUSTED', exhaustedAt: now } : {}) },
          include: WITH_COUNT,
        });
        return toTakeawayPromoDto(row, row._count.redemptions, now);
      });
    } catch (err) {
      throw isUniqueViolation(err) ? codeTaken(input.code ?? '') : err;
    }
  }

  /**
   * Switch off, or back on. Back on needs budget left (an exhausted promo
   * stays exhausted until the admin raises the budget — 409
   * TAKEAWAY_PROMO_BUDGET), a promo not past its end (409
   * TAKEAWAY_PROMO_STATUS: move the end first) and, for a welcome promo, no
   * other live one. Orders already placed are never touched.
   */
  async updateStatus(id: string, input: UpdateTakeawayPromoStatusInput, now = new Date()): Promise<TakeawayPromo> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "TakeawayPromo" WHERE "id" = ${id} FOR UPDATE`;
      const current = await this.read(tx, id);
      if (current.status === input.status) return toTakeawayPromoDto(current, current._count.redemptions, now);

      if (input.status === 'ACTIVE') {
        if (current.spentCents >= current.budgetCents) {
          throw takeawayPromoError(409, 'TAKEAWAY_PROMO_BUDGET', 'Nothing is left of the budget — raise it first');
        }
        if (current.endsAt < now) {
          throw takeawayPromoError(409, 'TAKEAWAY_PROMO_STATUS', 'The promo is past its end — move the end date first');
        }
        if (current.isWelcome) await this.assertWelcomeFree(tx, id, now);
      }

      const row = await tx.takeawayPromo.update({
        where: { id },
        data: { status: input.status, ...(input.status === 'ACTIVE' ? { exhaustedAt: null } : {}) },
        include: WITH_COUNT,
      });
      return toTakeawayPromoDto(row, row._count.redemptions, now);
    });
  }

  /** Counted orders only (paid by card or accepted, not cancelled), by brand, store and UTC day. */
  async report(id: string, now = new Date()): Promise<TakeawayPromoReport> {
    const row = await this.read(this.prisma, id);
    const rows = await countedRedemptions(this.prisma, { promoId: id });
    return { promo: toTakeawayPromoDto(row, row._count.redemptions, now), ...promoReportFigures(rows) };
  }

  /** takeAway's debt to every brand with promo orders, now; totals per currency. */
  async debt(): Promise<TakeawayDebtReport> {
    return debtReport(await countedRedemptions(this.prisma));
  }

  private async read(db: Db, id: string): Promise<RowWithCount> {
    const row = await db.takeawayPromo.findUnique({ where: { id }, include: WITH_COUNT });
    if (!row) throw new NotFoundException('Promo not found');
    return row;
  }

  /** One code field for both kinds (§2.1): no brand's promo and no other takeAway promo may hold it, any case. */
  private async assertCodeFree(db: Db, code: string, selfId: string | null): Promise<void> {
    const [brand, own] = await Promise.all([
      db.promo.findFirst({ where: { code: { equals: code, mode: 'insensitive' } }, select: { id: true } }),
      db.takeawayPromo.findUnique({ where: { code }, select: { id: true } }),
    ]);
    if (brand || (own && own.id !== selfId)) throw codeTaken(code);
  }

  /**
   * At most one live welcome promo — ACTIVE and not past its end — so a new
   * customer gets one bonus, from a promo nobody has to guess.
   */
  private async assertWelcomeFree(db: Db, selfId: string | null, now: Date): Promise<void> {
    const other = await db.takeawayPromo.findFirst({
      where: {
        isWelcome: true,
        status: 'ACTIVE',
        endsAt: { gte: now },
        ...(selfId ? { id: { not: selfId } } : {}),
      },
      select: { name: true, code: true },
    });
    if (other) {
      throw takeawayPromoError(
        409,
        'TAKEAWAY_PROMO_WELCOME_TAKEN',
        `«${other.name}» (${other.code}) is the welcome promo already — switch it off first`,
      );
    }
  }
}

function codeTaken(code: string) {
  return takeawayPromoError(
    409,
    'TAKEAWAY_PROMO_CODE_TAKEN',
    `The code ${code.toUpperCase()} is already used by a promo`,
  );
}

function assertDates(startsAt: Date, endsAt: Date): void {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw takeawayPromoError(400, 'TAKEAWAY_PROMO_DATES', 'endsAt must be later than startsAt');
  }
}

function assertPercent(percent: number): void {
  if (!isValidTakeawayPromoPercent(percent)) {
    throw takeawayPromoError(400, 'TAKEAWAY_PROMO_PERCENT', 'percent must be a whole number from 1 to 99');
  }
}

function assertBudget(budgetCents: number, spentCents: number): void {
  if (!Number.isInteger(budgetCents) || budgetCents < 1 || budgetCents > MAX_INT) {
    throw takeawayPromoError(
      400,
      'TAKEAWAY_PROMO_BUDGET',
      'The budget must be a whole amount of at least 1 minor unit',
    );
  }
  if (budgetCents < spentCents) {
    throw takeawayPromoError(400, 'TAKEAWAY_PROMO_BUDGET', `The budget cannot go below what was spent (${spentCents})`);
  }
}
