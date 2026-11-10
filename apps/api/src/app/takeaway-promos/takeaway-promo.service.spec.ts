import type { TakeawayPromo, WelcomeBonus } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import { TakeawayPromoService, type TakeawayReservation } from './takeaway-promo.service';

const NOW = new Date('2026-11-10T12:00:00Z');
const day = (offset: number) => new Date(NOW.getTime() + offset * 24 * 60 * 60_000);

const promoRow = (over: Partial<TakeawayPromo> = {}): TakeawayPromo => ({
  id: 'tp-1',
  name: 'Осенняя акция',
  code: 'AUTUMN10',
  percent: 10,
  startsAt: day(-1),
  endsAt: day(30),
  currency: 'MDL',
  budgetCents: 100_000,
  spentCents: 0,
  status: 'ACTIVE',
  exhaustedAt: null,
  isWelcome: false,
  createdById: 'admin-1',
  createdAt: day(-2),
  updatedAt: day(-2),
  ...over,
});

const bonusRow = (over: Partial<WelcomeBonus> = {}): WelcomeBonus => ({
  id: 'wb-1',
  promoId: 'tp-1',
  userId: 'user-1',
  identityHash: 'hash',
  expiresAt: day(5),
  orderId: null,
  notifiedAt: null,
  createdAt: day(-2),
  ...over,
});

/** The SQL of a tagged `$executeRaw` call, its values as `?`. */
const sqlOf = (call: unknown[]) => (call[0] as string[]).join('?').replace(/\s+/g, ' ');

function harness(opts: { promo?: TakeawayPromo | null; bonus?: WelcomeBonus | null; used?: boolean } = {}) {
  const prisma = {
    takeawayPromo: { findUnique: jest.fn().mockResolvedValue(opts.promo === undefined ? promoRow() : opts.promo) },
    welcomeBonus: { findUnique: jest.fn().mockResolvedValue(opts.bonus ?? null) },
    takeawayPromoRedemption: { findUnique: jest.fn().mockResolvedValue(opts.used ? { id: 'r-0' } : null) },
    store: {
      findUnique: jest.fn().mockResolvedValue({ currency: 'MDL', brandId: 'brand-1' }),
      findMany: jest.fn().mockResolvedValue([{ currency: 'MDL' }]),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const tx = {
    takeawayPromoRedemption: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    takeawayPromo: { update: jest.fn().mockResolvedValue({}) },
    welcomeBonus: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const service = new TakeawayPromoService(prisma as unknown as PrismaService);
  return { service, prisma, tx };
}

const check = (service: TakeawayPromoService, over: Partial<Parameters<TakeawayPromoService['validate']>[0]> = {}) =>
  service.validate(
    { userId: 'user-1', code: 'autumn10', subtotalCents: 1_555, place: { currency: 'MDL' }, ...over },
    NOW,
  );

describe('TakeawayPromoService.validate (docs/takeaway-promos.md §4.3)', () => {
  it('answers a takeAway code with its source, the promo and D = P × s / 100 half up', async () => {
    const { service, prisma } = harness();

    await expect(check(service)).resolves.toEqual({
      valid: true,
      reason: null,
      reasonCode: null,
      promo: null,
      source: 'TAKEAWAY',
      takeawayPromo: { id: 'tp-1', code: 'AUTUMN10', name: 'Осенняя акция', percent: 10, isWelcome: false },
      // 15,55 at 10 % → 1,56 (the guest pays 13,99).
      discountCents: 156,
      pointsMultiplier: 1,
    });
    expect(prisma.takeawayPromo.findUnique).toHaveBeenCalledWith({ where: { code: 'AUTUMN10' } });
  });

  it('is null for a code no takeAway promo has — the caller says PROMO_UNKNOWN', async () => {
    const { service } = harness({ promo: null });
    await expect(check(service)).resolves.toBeNull();
  });

  it.each([
    ['switched off', { status: 'DISABLED' as const }, 'PROMO_INACTIVE'],
    ['before its start', { startsAt: day(1) }, 'PROMO_NOT_STARTED'],
    ['past its end', { endsAt: day(-0.5) }, 'PROMO_EXPIRED'],
    ['exhausted', { status: 'EXHAUSTED' as const }, 'PROMO_LIMIT_REACHED'],
    ['short of budget for this order', { budgetCents: 1_000, spentCents: 900 }, 'PROMO_LIMIT_REACHED'],
  ])('refuses a promo %s', async (_label, over, reasonCode) => {
    const { service } = harness({ promo: promoRow(over) });
    await expect(check(service)).resolves.toMatchObject({ valid: false, reasonCode, source: null, discountCents: 0 });
  });

  it('takes the last of the budget exactly', async () => {
    const { service } = harness({ promo: promoRow({ budgetCents: 1_000, spentCents: 844 }) });
    await expect(check(service)).resolves.toMatchObject({ valid: true, discountCents: 156 });
  });

  it('refuses another currency with PROMO_NOT_HERE and names the promo currency', async () => {
    const { service } = harness();
    await expect(check(service, { place: { currency: 'RUP' } })).resolves.toMatchObject({
      valid: false,
      reasonCode: 'PROMO_NOT_HERE',
      currency: 'MDL',
    });
  });

  it('reads the currency from the store, or else from the brand’s stores', async () => {
    const { service, prisma } = harness();
    prisma.store.findUnique.mockResolvedValue({ currency: 'RUP', brandId: 'brand-1' });
    await expect(check(service, { place: { storeId: 's-1', brandId: 'brand-1' } })).resolves.toMatchObject({
      reasonCode: 'PROMO_NOT_HERE',
    });

    prisma.store.findMany.mockResolvedValue([{ currency: 'RUP' }, { currency: 'MDL' }]);
    await expect(check(service, { place: { brandId: 'brand-1' } })).resolves.toMatchObject({ valid: true });
    // A store of another brand says nothing about this cart.
    prisma.store.findUnique.mockResolvedValue({ currency: 'RUP', brandId: 'brand-2' });
    await expect(check(service, { place: { storeId: 's-9', brandId: 'brand-1' } })).resolves.toMatchObject({
      valid: true,
    });
  });

  it('lets a customer use a promo once', async () => {
    const { service } = harness({ used: true });
    await expect(check(service)).resolves.toMatchObject({ reasonCode: 'PROMO_ALREADY_USED' });
  });

  it('lets a guest preview a promo (the once-per-customer rule waits for the order)', async () => {
    const { service, prisma } = harness({ used: true });
    await expect(check(service, { userId: null })).resolves.toMatchObject({ valid: true });
    expect(prisma.takeawayPromoRedemption.findUnique).not.toHaveBeenCalled();
  });

  describe('a welcome code', () => {
    const welcome = promoRow({ isWelcome: true, code: 'WELCOME10' });

    it('works for the customer holding an unused, unexpired bonus for it', async () => {
      const { service } = harness({ promo: welcome, bonus: bonusRow() });
      await expect(check(service, { code: 'welcome10' })).resolves.toMatchObject({
        valid: true,
        takeawayPromo: { isWelcome: true },
      });
    });

    it.each([
      ['a guest', null, null, 'PROMO_NOT_ELIGIBLE'],
      ['a customer without a bonus', 'user-1', null, 'PROMO_NOT_ELIGIBLE'],
      ['a bonus of another welcome promo', 'user-1', bonusRow({ promoId: 'tp-old' }), 'PROMO_NOT_ELIGIBLE'],
      ['a used bonus', 'user-1', bonusRow({ orderId: 'order-0' }), 'PROMO_ALREADY_USED'],
      ['a bonus past its 7 days', 'user-1', bonusRow({ expiresAt: day(-1) }), 'PROMO_EXPIRED'],
    ])('refuses %s', async (_label, userId, bonus, reasonCode) => {
      const { service } = harness({ promo: welcome, bonus });
      await expect(check(service, { userId, code: 'WELCOME10' })).resolves.toMatchObject({
        valid: false,
        reasonCode,
      });
    });
  });
});

const reservation = (over: Partial<TakeawayReservation> = {}): TakeawayReservation => ({
  promoId: 'tp-1',
  code: 'AUTUMN10',
  percent: 10,
  isWelcome: false,
  userId: 'user-1',
  orderId: 'order-1',
  brandId: 'brand-1',
  storeId: 'store-1',
  currency: 'MDL',
  menuTotalCents: 10_000,
  discountCents: 1_000,
  ...over,
});

describe('TakeawayPromoService.reserveForOrder (§2.4)', () => {
  it('records the debt, then takes D with one conditional update that also exhausts on exactly 0', async () => {
    const { service, tx } = harness();

    await service.reserveForOrder(tx as never, reservation(), NOW);

    expect(tx.takeawayPromoRedemption.create).toHaveBeenCalledWith({
      data: {
        promoId: 'tp-1',
        userId: 'user-1',
        orderId: 'order-1',
        brandId: 'brand-1',
        storeId: 'store-1',
        currency: 'MDL',
        code: 'AUTUMN10',
        percent: 10,
        menuTotalCents: 10_000,
        discountCents: 1_000,
      },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const call = tx.$executeRaw.mock.calls[0] as unknown[];
    const sql = sqlOf(call);
    expect(sql).toContain('SET "spentCents" = "spentCents" + ?');
    expect(sql).toContain(`CASE WHEN "spentCents" + ? = "budgetCents" THEN 'EXHAUSTED'`);
    expect(sql).toContain(`"status" = 'ACTIVE'`);
    expect(sql).toContain('"startsAt" <= ?::timestamp AND "endsAt" >= ?::timestamp');
    expect(sql).toContain('AND "spentCents" + ? <= "budgetCents"');
    expect(call.slice(1)).toEqual(expect.arrayContaining([1_000, 'tp-1', NOW.toISOString()]));
    expect(tx.welcomeBonus.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a second order of the same customer with PROMO_ALREADY_USED, not an order-code retry', async () => {
    const { service, tx } = harness();
    tx.takeawayPromoRedemption.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    await expect(service.reserveForOrder(tx as never, reservation(), NOW)).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'PROMO_ALREADY_USED' }),
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('answers PROMO_LIMIT_REACHED when the update matched nothing (the budget, a switch-off, the end)', async () => {
    const { service, tx } = harness();
    tx.$executeRaw.mockResolvedValue(0);

    await expect(service.reserveForOrder(tx as never, reservation(), NOW)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PROMO_LIMIT_REACHED' }),
    });
  });

  it('claims the welcome bonus for the order in the same transaction', async () => {
    const { service, tx } = harness();

    await service.reserveForOrder(tx as never, reservation({ isWelcome: true }), NOW);

    expect(tx.welcomeBonus.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', promoId: 'tp-1', orderId: null, expiresAt: { gt: NOW } },
      data: { orderId: 'order-1' },
    });
  });

  it.each([
    ['gone', null, 'PROMO_NOT_ELIGIBLE'],
    ['used by another order meanwhile', bonusRow({ orderId: 'order-0' }), 'PROMO_ALREADY_USED'],
    ['expired meanwhile', bonusRow({ expiresAt: NOW }), 'PROMO_EXPIRED'],
  ])('refuses a welcome bonus %s', async (_label, bonus, code) => {
    const { service, tx } = harness();
    tx.welcomeBonus.updateMany.mockResolvedValue({ count: 0 });
    tx.welcomeBonus.findUnique.mockResolvedValue(bonus);

    await expect(service.reserveForOrder(tx as never, reservation({ isWelcome: true }), NOW)).rejects.toMatchObject({
      response: expect.objectContaining({ code }),
    });
  });
});

describe('TakeawayPromoService.releaseForOrder', () => {
  it('deletes the redemption, gives D back to the budget and frees the welcome bonus', async () => {
    const { service, tx } = harness();
    tx.takeawayPromoRedemption.findUnique.mockResolvedValue({ id: 'r-1', promoId: 'tp-1', discountCents: 1_000 });

    await service.releaseForOrder(tx as never, 'order-1');

    expect(tx.welcomeBonus.updateMany).toHaveBeenCalledWith({ where: { orderId: 'order-1' }, data: { orderId: null } });
    expect(tx.takeawayPromoRedemption.deleteMany).toHaveBeenCalledWith({ where: { id: 'r-1' } });
    // Status untouched: an exhausted promo stays exhausted (§2.5).
    expect(tx.takeawayPromo.update).toHaveBeenCalledWith({
      where: { id: 'tp-1' },
      data: { spentCents: { decrement: 1_000 } },
    });
  });

  it('does nothing more for an order without a takeAway promo', async () => {
    const { service, tx } = harness();

    await service.releaseForOrder(tx as never, 'order-1');

    expect(tx.takeawayPromoRedemption.deleteMany).not.toHaveBeenCalled();
    expect(tx.takeawayPromo.update).not.toHaveBeenCalled();
  });

  it('gives nothing back twice', async () => {
    const { service, tx } = harness();
    tx.takeawayPromoRedemption.findUnique.mockResolvedValue({ id: 'r-1', promoId: 'tp-1', discountCents: 1_000 });
    tx.takeawayPromoRedemption.deleteMany.mockResolvedValue({ count: 0 });

    await service.releaseForOrder(tx as never, 'order-1');

    expect(tx.takeawayPromo.update).not.toHaveBeenCalled();
  });
});

describe('TakeawayPromoService.exhaustIfShort (§2.5)', () => {
  it('exhausts an active promo whose budget cannot take this order’s discount', async () => {
    const { service, prisma } = harness();

    await expect(service.exhaustIfShort('autumn10', 10_000, NOW)).resolves.toBe(true);

    const call = prisma.$executeRaw.mock.calls[0] as unknown[];
    expect(sqlOf(call)).toContain(`SET "status" = 'EXHAUSTED'`);
    expect(sqlOf(call)).toContain('AND "spentCents" + ? > "budgetCents"');
    expect(call.slice(1)).toEqual(expect.arrayContaining(['tp-1', 1_000]));
  });

  it('leaves a brand’s code and a promo already off alone', async () => {
    const none = harness({ promo: null });
    await expect(none.service.exhaustIfShort('BRAND15', 10_000, NOW)).resolves.toBe(false);
    expect(none.prisma.$executeRaw).not.toHaveBeenCalled();

    const off = harness({ promo: promoRow({ status: 'DISABLED' }) });
    await expect(off.service.exhaustIfShort('AUTUMN10', 10_000, NOW)).resolves.toBe(false);
    expect(off.prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
