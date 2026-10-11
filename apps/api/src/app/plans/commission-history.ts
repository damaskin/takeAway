import { NotFoundException } from '@nestjs/common';
import type { BrandCommissionRate, CommissionRateSource, Prisma } from '@prisma/client';
import { DEFAULT_COMMISSION_BPS, type BrandPlan } from '@takeaway/shared-types';

/**
 * A brand's platform commission over time (`BrandCommissionRate`).
 *
 * Each row applies from its `effectiveFrom` until the next row's. The first
 * row also covers anything before it, so the timeline has no holes: an order
 * always has exactly one rate. `Brand.commissionBps` mirrors the row in force
 * now — the dashboards and the plan card read it — and every change goes
 * through {@link recordCommissionRate} so the two cannot drift.
 */

/** One point of the timeline: from `effectiveFrom` on, `bps` applies. */
export interface RatePoint {
  effectiveFrom: Date;
  bps: number;
}

/**
 * The rate in force at `at`. `timeline` must be sorted by `effectiveFrom`,
 * oldest first. Before the first row the first row applies; with no rows at
 * all, `fallbackBps` (the brand's current rate) does.
 */
export function rateAt(timeline: readonly RatePoint[], at: Date, fallbackBps: number): number {
  const first = timeline[0];
  if (!first) return fallbackBps;
  const t = at.getTime();
  let found = first;
  let lo = 0;
  let hi = timeline.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const point = timeline[mid];
    if (!point) break;
    if (point.effectiveFrom.getTime() <= t) {
      found = point;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found.bps;
}

/** PLAN when `bps` is the plan's default, INDIVIDUAL otherwise. */
export function rateSourceFor(plan: BrandPlan, bps: number): CommissionRateSource {
  return bps === DEFAULT_COMMISSION_BPS[plan] ? 'PLAN' : 'INDIVIDUAL';
}

export interface CommissionRateChange {
  brandId: string;
  bps: number;
  source: CommissionRateSource;
  effectiveFrom: Date;
  note?: string | null;
  createdById?: string | null;
}

/**
 * Records a rate from `effectiveFrom` on and refreshes `Brand.commissionBps`.
 * Run it inside the transaction that changes anything else about the brand's
 * terms.
 *
 * A brand created before rates were recorded (or one that never had its rate
 * changed) has no history: the rate it has now is written first, from the
 * day it was created, so a change from today on does not rewrite the past.
 * A second rate on the same instant replaces the first — that is how a
 * mistyped rate is corrected.
 */
export async function recordCommissionRate(
  tx: Prisma.TransactionClient,
  change: CommissionRateChange,
  now: Date = new Date(),
): Promise<BrandCommissionRate> {
  const brand = await tx.brand.findUnique({
    where: { id: change.brandId },
    select: { commissionBps: true, plan: true, createdAt: true },
  });
  if (!brand) throw new NotFoundException('Brand not found');

  const recorded = await tx.brandCommissionRate.count({ where: { brandId: change.brandId } });
  if (recorded === 0 && change.effectiveFrom.getTime() > brand.createdAt.getTime()) {
    await tx.brandCommissionRate.create({
      data: {
        brandId: change.brandId,
        bps: brand.commissionBps,
        source: rateSourceFor(brand.plan, brand.commissionBps),
        effectiveFrom: brand.createdAt,
      },
    });
  }

  const row = await tx.brandCommissionRate.upsert({
    where: { brandId_effectiveFrom: { brandId: change.brandId, effectiveFrom: change.effectiveFrom } },
    create: {
      brandId: change.brandId,
      bps: change.bps,
      source: change.source,
      effectiveFrom: change.effectiveFrom,
      note: change.note ?? null,
      createdById: change.createdById ?? null,
    },
    update: {
      bps: change.bps,
      source: change.source,
      note: change.note ?? null,
      createdById: change.createdById ?? null,
    },
  });
  await syncCurrentCommission(tx, change.brandId, now);
  return row;
}

/**
 * Copies the rate in force at `now` onto `Brand.commissionBps`. Returns it,
 * or null when the brand has no history (the column then stays as it is).
 */
export async function syncCurrentCommission(
  tx: Prisma.TransactionClient,
  brandId: string,
  now: Date = new Date(),
): Promise<number | null> {
  const timeline = await tx.brandCommissionRate.findMany({
    where: { brandId },
    orderBy: { effectiveFrom: 'asc' },
    select: { effectiveFrom: true, bps: true },
  });
  if (timeline.length === 0) return null;
  const bps = rateAt(timeline, now, 0);
  await tx.brand.update({ where: { id: brandId }, data: { commissionBps: bps } });
  return bps;
}
