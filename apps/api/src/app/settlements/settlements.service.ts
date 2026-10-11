import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, type BrandPayout, type Currency } from '@prisma/client';
import {
  DEFAULT_COMMISSION_BPS,
  type CommissionRateHistory,
  type SettlementPayout,
  type SettlementPayoutPreview,
  type SettlementReport,
} from '@takeaway/shared-types';

import { addDays, localDay, resolveDateRange, startOfDay } from '../analytics/analytics-range';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { BrandScopeService } from '../auth/services/brand-scope.service';
import { codedConflict } from '../common/http/coded-conflict';
import { prevailingTimeZone } from '../common/time/time-zone';
import {
  rateAt,
  rateSourceFor,
  recordCommissionRate,
  syncCurrentCommission,
  type RatePoint,
} from '../plans/commission-history';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreatePayoutDto,
  MarkPayoutPaidDto,
  SetCommissionRateDto,
  SettlementQueryDto,
} from './dto/settlements.dto';
import {
  computeSettlement,
  periodFigures,
  planPayout,
  rateSpans,
  settlementBalance,
  type LedgerPayout,
  type SettlementOrderRow,
} from './settlement-math';

/** Period shown when the request names none. */
const DEFAULT_DAYS = 30;

/** Payment states in which the money reached the platform (some may have gone back since). */
const CAPTURED = Prisma.sql`('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED')`;

type Db = Prisma.TransactionClient;

interface BrandTerms {
  id: string;
  name: string;
  plan: 'BASIC' | 'PRO';
  commissionBps: number;
  currency: Currency;
}

interface RawOrderRow {
  id: string;
  settledAt: Date;
  subtotalCents: number;
  discountCents: number;
  pointsDiscountCents: number;
  giftCardCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  capturedCents: bigint | number;
  refundedCents: bigint | number;
  hasCapture: boolean;
}

/**
 * «Расчёты с брендами»: what the platform collected by card for a brand's
 * orders, its commission, what it owes the brand and what it has paid.
 * Definitions live in `settlement-math.ts` and docs/settlements.md; this
 * service reads the database and keeps the rate history and payouts.
 */
@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly brandScope: BrandScopeService,
  ) {}

  // ── Report ────────────────────────────────────────────────────────────────

  async report(user: AuthenticatedUser, query: SettlementQueryDto, now: Date = new Date()): Promise<SettlementReport> {
    const brandId = await this.brandFor(user, query.brandId);
    const brand = await this.brandTerms(this.prisma, brandId);
    const timeZone = await this.timeZoneOf(this.prisma, brandId);
    const range = resolveDateRange({ from: query.from, to: query.to, days: query.days }, timeZone, DEFAULT_DAYS, now);
    const currency = (query.currency as Currency | undefined) ?? brand.currency;
    const dayOf = (instant: Date) => localDay(instant, timeZone);

    const [currencies, timeline, payouts, rows] = await Promise.all([
      this.currenciesOf(brand),
      this.timeline(this.prisma, brandId),
      this.payouts(this.prisma, brandId, currency),
      this.orderRows(this.prisma, brandId, currency, range.end),
    ]);

    const days: string[] = [];
    for (let day = range.from; day <= range.to; day = addDays(day, 1)) days.push(day);
    const computed = computeSettlement(
      rows,
      timeline,
      brand.commissionBps,
      { start: range.start, end: range.end, days },
      dayOf,
    );
    const ledger = payouts.map(toLedger);

    return {
      brand: {
        id: brand.id,
        name: brand.name,
        plan: brand.plan,
        currentBps: brand.commissionBps,
        planBps: DEFAULT_COMMISSION_BPS[brand.plan],
      },
      currency,
      currencies,
      period: { from: range.from, to: range.to, days: range.days, timeZone },
      totals: computed.totals,
      days: computed.days,
      rates: rateSpans(
        timeline,
        { bps: brand.commissionBps, source: rateSourceFor(brand.plan, brand.commissionBps) },
        range.start,
        range.end,
        dayOf,
      ),
      balance: settlementBalance({
        accruedBeforeCents: computed.accruedBeforeCents,
        payableCents: computed.totals.payableCents,
        payouts: ledger,
        start: range.start,
        end: range.end,
      }),
      nextPayout: this.preview({
        to: range.to,
        today: dayOf(now),
        timeZone,
        end: range.end,
        rows,
        timeline,
        fallbackBps: brand.commissionBps,
        accruedBeforeEndCents: computed.accruedBeforeEndCents,
        firstSettledDay: computed.firstSettledDay,
        payouts: ledger,
      }),
      payouts: payouts.map(toPayoutDto),
    };
  }

  // ── Commission rates ──────────────────────────────────────────────────────

  async rates(user: AuthenticatedUser, requestedBrandId?: string): Promise<CommissionRateHistory> {
    const brandId = await this.brandFor(user, requestedBrandId);
    return this.history(brandId);
  }

  /**
   * A rate from the start of `effectiveFrom` (a day in the brand's time zone)
   * on. Without `bps` the brand goes back to its plan's rate. A date in the
   * past rewrites the settlements from then on; payouts already fixed keep
   * their amounts and the difference shows up in the balance.
   */
  async setRate(
    user: AuthenticatedUser,
    dto: SetCommissionRateDto,
    now: Date = new Date(),
  ): Promise<CommissionRateHistory> {
    const brand = await this.brandTerms(this.prisma, dto.brandId);
    const timeZone = await this.timeZoneOf(this.prisma, brand.id);
    const bps = dto.bps ?? DEFAULT_COMMISSION_BPS[brand.plan];
    await this.prisma.$transaction((tx) =>
      recordCommissionRate(
        tx,
        {
          brandId: brand.id,
          bps,
          source: dto.bps === null || dto.bps === undefined ? 'PLAN' : rateSourceFor(brand.plan, bps),
          effectiveFrom: startOfDay(validDay(dto.effectiveFrom, 'effectiveFrom'), timeZone),
          note: dto.note ?? null,
          createdById: user.id,
        },
        now,
      ),
    );
    return this.history(brand.id);
  }

  async deleteRate(id: string, now: Date = new Date()): Promise<CommissionRateHistory> {
    const row = await this.prisma.brandCommissionRate.findUnique({ where: { id }, select: { brandId: true } });
    if (!row) throw new NotFoundException('Commission rate not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.brandCommissionRate.delete({ where: { id } });
      await syncCurrentCommission(tx, row.brandId, now);
    });
    return this.history(row.brandId);
  }

  /**
   * A rate dated in the future takes over on its day; this copies it onto
   * `Brand.commissionBps`, which the dashboards and the plan card read.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'commission-rate-sync' })
  async syncCurrentRates(now: Date = new Date()): Promise<number> {
    const rows = await this.prisma.brandCommissionRate.findMany({
      orderBy: [{ brandId: 'asc' }, { effectiveFrom: 'asc' }],
      select: { brandId: true, effectiveFrom: true, bps: true },
    });
    const timelines = new Map<string, RatePoint[]>();
    for (const row of rows) {
      const list = timelines.get(row.brandId) ?? [];
      list.push(row);
      timelines.set(row.brandId, list);
    }
    if (timelines.size === 0) return 0;
    const brands = await this.prisma.brand.findMany({
      where: { id: { in: [...timelines.keys()] } },
      select: { id: true, commissionBps: true },
    });
    let changed = 0;
    for (const brand of brands) {
      const bps = rateAt(timelines.get(brand.id) ?? [], now, brand.commissionBps);
      if (bps === brand.commissionBps) continue;
      await this.prisma.brand.update({ where: { id: brand.id }, data: { commissionBps: bps } });
      changed += 1;
    }
    if (changed > 0) this.logger.log(`commission rate changed for ${changed} brand(s)`);
    return changed;
  }

  // ── Payouts ───────────────────────────────────────────────────────────────

  /**
   * «Зафиксировать выплату»: fixes the balance owed at the end of `to` as a
   * PENDING payout. Serialised per brand and currency, so two clicks cannot
   * fix the same money twice.
   */
  async createPayout(user: AuthenticatedUser, dto: CreatePayoutDto, now: Date = new Date()): Promise<SettlementPayout> {
    const brand = await this.brandTerms(this.prisma, dto.brandId);
    const timeZone = await this.timeZoneOf(this.prisma, brand.id);
    const currency = dto.currency as Currency;
    const to = validDay(dto.to, 'to');
    const end = startOfDay(addDays(to, 1), timeZone);
    const lockKey = `brand-payout:${brand.id}:${currency}`;

    const created = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS "locked" FROM (SELECT pg_advisory_xact_lock(hashtext(${lockKey}))) AS l`;
        const [timeline, payouts, rows] = await Promise.all([
          this.timeline(tx, brand.id),
          this.payouts(tx, brand.id, currency),
          this.orderRows(tx, brand.id, currency, end),
        ]);
        const dayOf = (instant: Date) => localDay(instant, timeZone);
        const computed = computeSettlement(rows, timeline, brand.commissionBps, { start: end, end, days: [] }, dayOf);
        const preview = this.preview({
          to,
          today: dayOf(now),
          timeZone,
          end,
          rows,
          timeline,
          fallbackBps: brand.commissionBps,
          accruedBeforeEndCents: computed.accruedBeforeEndCents,
          firstSettledDay: computed.firstSettledDay,
          payouts: payouts.map(toLedger),
        });
        if (preview.blocked === 'OVERLAP') {
          throw codedConflict('PAYOUT_OVERLAP', `A payout already settles up to ${preview.lastSettledDay}`);
        }
        if (preview.blocked === 'PERIOD_OPEN') {
          throw codedConflict('PAYOUT_PERIOD_OPEN', `${to} has not ended yet in ${timeZone}`);
        }
        if (preview.blocked === 'NOTHING_DUE' || preview.periodFrom === null) {
          throw codedConflict('PAYOUT_NOTHING_DUE', 'Nothing is owed to the brand at the end of the period');
        }
        return tx.brandPayout.create({
          data: {
            brandId: brand.id,
            currency,
            periodFrom: dateOnly(preview.periodFrom),
            periodTo: dateOnly(to),
            timeZone,
            periodEnd: end,
            amountCents: preview.amountCents,
            cardNetCents: preview.cardNetCents,
            commissionCents: preview.commissionCents,
            reference: dto.reference ?? null,
            comment: dto.comment ?? null,
            createdById: user.id,
          },
        });
      },
      { timeout: 20_000 },
    );
    this.logger.log(
      `payout fixed brand=${brand.id} ${created.currency} ${toDay(created.periodFrom)}..${toDay(created.periodTo)} amount=${created.amountCents}`,
    );
    return toPayoutDto(created);
  }

  async markPaid(
    user: AuthenticatedUser,
    id: string,
    dto: MarkPayoutPaidDto,
    now: Date = new Date(),
  ): Promise<SettlementPayout> {
    const result = await this.prisma.brandPayout.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'PAID',
        paidAt: dto.paidAt ? new Date(dto.paidAt) : now,
        paidById: user.id,
        ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
        ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
      },
    });
    const payout = await this.prisma.brandPayout.findUnique({ where: { id } });
    if (!payout) throw new NotFoundException('Payout not found');
    if (result.count === 0) throw codedConflict('PAYOUT_ALREADY_PAID', 'This payout is already marked as paid');
    return toPayoutDto(payout);
  }

  /**
   * Takes back a payout fixed by mistake. Only a pending one, and only the
   * latest: payouts follow each other, and a hole in the middle would leave
   * days nobody settles.
   */
  async deletePayout(id: string): Promise<void> {
    const payout = await this.prisma.brandPayout.findUnique({ where: { id } });
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status !== 'PENDING') throw codedConflict('PAYOUT_PAID', 'A paid payout cannot be removed');
    const latest = await this.prisma.brandPayout.findFirst({
      where: { brandId: payout.brandId, currency: payout.currency },
      orderBy: { periodEnd: 'desc' },
      select: { id: true },
    });
    if (latest?.id !== id) throw codedConflict('PAYOUT_NOT_LATEST', 'Only the latest payout can be removed');
    await this.prisma.brandPayout.deleteMany({ where: { id, status: 'PENDING' } });
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  /**
   * Every counted order of the brand in `currency` settled before `end`, with
   * its captured card money. An order counts once a payment for it was
   * captured (even if refunded since) or once the store accepted it; a
   * cancelled or expired order with no captured payment never does.
   */
  private async orderRows(db: Db, brandId: string, currency: Currency, end: Date): Promise<SettlementOrderRow[]> {
    const endAt = Prisma.sql`${end.toISOString()}::timestamp`;
    const rows = await db.$queryRaw<RawOrderRow[]>`
      SELECT o."id" AS "id",
             COALESCE(o."acceptedAt", pay."firstCapturedAt") AS "settledAt",
             o."subtotalCents" AS "subtotalCents",
             o."discountCents" AS "discountCents",
             o."pointsDiscountCents" AS "pointsDiscountCents",
             o."giftCardCents" AS "giftCardCents",
             o."deliveryFeeCents" AS "deliveryFeeCents",
             o."totalCents" AS "totalCents",
             COALESCE(pay."capturedCents", 0)::bigint AS "capturedCents",
             COALESCE(pay."refundedCents", 0)::bigint AS "refundedCents",
             (pay."firstCapturedAt" IS NOT NULL) AS "hasCapture"
      FROM "Order" o
      JOIN "Store" s ON s."id" = o."storeId"
      LEFT JOIN LATERAL (
        SELECT SUM(p."amountCents") AS "capturedCents",
               SUM(LEAST(p."refundedCents", p."amountCents")) AS "refundedCents",
               MIN(p."createdAt") AS "firstCapturedAt"
        FROM "Payment" p
        WHERE p."orderId" = o."id"
          AND p."currency" = o."currency"
          AND p."status" IN ${CAPTURED}
      ) pay ON TRUE
      WHERE s."brandId" = ${brandId}
        AND o."currency" = ${currency}::"Currency"
        AND o."createdAt" < ${endAt}
        AND (
          pay."firstCapturedAt" IS NOT NULL
          OR (o."acceptedAt" IS NOT NULL AND o."status" NOT IN ('CANCELLED', 'EXPIRED'))
        )
        AND COALESCE(o."acceptedAt", pay."firstCapturedAt") < ${endAt}
    `;
    return rows.map((r) => ({
      id: r.id,
      settledAt: r.settledAt,
      subtotalCents: r.subtotalCents,
      discountCents: r.discountCents,
      pointsDiscountCents: r.pointsDiscountCents,
      giftCardCents: r.giftCardCents,
      deliveryFeeCents: r.deliveryFeeCents,
      totalCents: r.totalCents,
      capturedCents: Number(r.capturedCents),
      refundedCents: Number(r.refundedCents),
      hasCapture: r.hasCapture,
    }));
  }

  private timeline(db: Db, brandId: string) {
    return db.brandCommissionRate.findMany({
      where: { brandId },
      orderBy: { effectiveFrom: 'asc' },
      select: { effectiveFrom: true, bps: true, source: true },
    });
  }

  private payouts(db: Db, brandId: string, currency: Currency): Promise<BrandPayout[]> {
    return db.brandPayout.findMany({ where: { brandId, currency }, orderBy: { periodEnd: 'desc' } });
  }

  /** Every currency the brand settled orders or payouts in, its own first. */
  private async currenciesOf(brand: BrandTerms): Promise<string[]> {
    const [orders, payouts] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          store: { brandId: brand.id },
          OR: [
            { acceptedAt: { not: null } },
            { payments: { some: { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } } },
          ],
        },
        distinct: ['currency'],
        select: { currency: true },
      }),
      this.prisma.brandPayout.findMany({
        where: { brandId: brand.id },
        distinct: ['currency'],
        select: { currency: true },
      }),
    ]);
    const others = new Set<string>([...orders, ...payouts].map((r) => r.currency));
    others.delete(brand.currency);
    return [brand.currency, ...[...others].sort()];
  }

  private async history(brandId: string): Promise<CommissionRateHistory> {
    const brand = await this.brandTerms(this.prisma, brandId);
    const [timeZone, rows] = await Promise.all([
      this.timeZoneOf(this.prisma, brandId),
      this.prisma.brandCommissionRate.findMany({ where: { brandId }, orderBy: { effectiveFrom: 'asc' } }),
    ]);
    return {
      brandId,
      plan: brand.plan,
      planBps: DEFAULT_COMMISSION_BPS[brand.plan],
      currentBps: brand.commissionBps,
      timeZone,
      rates: rows.map((row, i) => ({
        id: row.id,
        bps: row.bps,
        source: row.source,
        effectiveFrom: row.effectiveFrom.toISOString(),
        effectiveTo: rows[i + 1]?.effectiveFrom.toISOString() ?? null,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  private preview(input: {
    to: string;
    today: string;
    timeZone: string;
    end: Date;
    rows: readonly SettlementOrderRow[];
    timeline: readonly RatePoint[];
    fallbackBps: number;
    accruedBeforeEndCents: number;
    firstSettledDay: string | null;
    payouts: readonly LedgerPayout[];
  }): SettlementPayoutPreview {
    const last = input.payouts.reduce<LedgerPayout | null>(
      (latest, p) => (!latest || p.periodEnd > latest.periodEnd ? p : latest),
      null,
    );
    const plan = planPayout({
      to: input.to,
      today: input.today,
      lastSettledDay: last?.periodTo ?? null,
      firstSettledDay: input.firstSettledDay,
      accruedBeforeEndCents: input.accruedBeforeEndCents,
      committedCents: input.payouts.reduce((sum, p) => sum + p.amountCents, 0),
      nextDay: (day) => addDays(day, 1),
    });
    const figures =
      plan.periodFrom && plan.periodFrom <= input.to
        ? periodFigures(
            input.rows,
            input.timeline,
            input.fallbackBps,
            startOfDay(plan.periodFrom, input.timeZone),
            input.end,
          )
        : { cardNetCents: 0, commissionCents: 0 };
    return {
      periodFrom: plan.periodFrom,
      periodTo: input.to,
      amountCents: plan.amountCents,
      cardNetCents: figures.cardNetCents,
      commissionCents: figures.commissionCents,
      blocked: plan.blocked,
      lastSettledDay: last?.periodTo ?? null,
    };
  }

  // ── Scope ─────────────────────────────────────────────────────────────────

  /**
   * The brand a request is about. A platform admin names it; a brand owner
   * sees only their own and gets it by default.
   */
  private async brandFor(user: AuthenticatedUser, requested?: string): Promise<string> {
    const scope = await this.brandScope.resolveBrandIds(user);
    if (scope === null) {
      if (!requested) throw new BadRequestException('brandId is required');
      return requested;
    }
    if (requested) {
      if (!scope.includes(requested)) throw new ForbiddenException('That brand is outside your account');
      return requested;
    }
    const own = scope[0];
    if (!own) throw new NotFoundException('No brand on this account');
    return own;
  }

  private async brandTerms(db: Db, brandId: string): Promise<BrandTerms> {
    const brand = await db.brand.findUnique({
      where: { id: brandId },
      select: { id: true, name: true, plan: true, commissionBps: true, currency: true },
    });
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  /** The zone most of the brand's stores keep — the same days the dashboards count. */
  private async timeZoneOf(db: Db, brandId: string): Promise<string> {
    const stores = await db.store.findMany({ where: { brandId }, select: { timezone: true } });
    return prevailingTimeZone(stores.map((s) => s.timezone)) ?? 'UTC';
  }
}

function toLedger(p: BrandPayout): LedgerPayout {
  return { periodEnd: p.periodEnd, periodTo: toDay(p.periodTo), amountCents: p.amountCents, status: p.status };
}

function toPayoutDto(p: BrandPayout): SettlementPayout {
  return {
    id: p.id,
    brandId: p.brandId,
    currency: p.currency,
    periodFrom: toDay(p.periodFrom),
    periodTo: toDay(p.periodTo),
    timeZone: p.timeZone,
    amountCents: p.amountCents,
    cardNetCents: p.cardNetCents,
    commissionCents: p.commissionCents,
    status: p.status,
    paidAt: p.paidAt?.toISOString() ?? null,
    reference: p.reference,
    comment: p.comment,
    createdAt: p.createdAt.toISOString(),
  };
}

/** A `@db.Date` column comes back as UTC midnight of that day. */
function toDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateOnly(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** `2026-02-30` passes the pattern but is no day; refuse it rather than roll it over. */
function validDay(day: string, field: string): string {
  if (addDays(day, 0) !== day) throw new BadRequestException(`${field} must be a date like 2026-10-04`);
  return day;
}
