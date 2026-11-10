import { PrismaClient } from '@prisma/client';

import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import { countedRedemptions, debtReport } from './takeaway-debt';
import { TakeawayPromoAdminService } from './takeaway-promo-admin.service';
import { TakeawayPromoService } from './takeaway-promo.service';
import { WelcomeBonusService } from './welcome-bonus.service';

/**
 * «Акции takeAway» on a real Postgres (docs/takeaway-promos.md §2.4–§2.6):
 * many customers checking out with the same promo at the same moment never
 * push `spentCents` past `budgetCents`, the order that takes the last of it
 * exhausts the promo, a customer cannot hold it twice, and a cancel gives
 * the budget and the welcome bonus back. Opt-in: set
 * TAKEAWAY_PROMO_IT_DATABASE_URL to a throwaway database with the
 * migrations applied (`prisma migrate deploy`). The suite adds rows with
 * ids starting `tpit-` and deletes them again. Never point it at a database
 * you care about.
 */
const url = process.env['TAKEAWAY_PROMO_IT_DATABASE_URL'];
const suite = url ? describe : describe.skip;

const BRAND = 'tpit-brand';
const STORE = 'tpit-store';
const CUSTOMERS = Array.from({ length: 12 }, (_, i) => `tpit-user-${i + 1}`);

suite('takeAway promos on Postgres', () => {
  let prisma: PrismaClient;
  let promos: TakeawayPromoService;
  let admin: TakeawayPromoAdminService;
  let orderNo = 0;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await cleanUp(prisma);
    await prisma.brand.create({ data: { id: BRAND, slug: BRAND, name: 'TPIT Coffee', currency: 'MDL' } });
    await prisma.store.create({
      data: {
        id: STORE,
        brandId: BRAND,
        slug: STORE,
        name: 'Центр',
        addressLine: 'Юности 12',
        city: 'Тирасполь',
        country: 'MD',
        latitude: 46.84,
        longitude: 29.66,
        currency: 'MDL',
        timezone: 'UTC',
      },
    });
    await prisma.user.createMany({ data: CUSTOMERS.map((id) => ({ id, name: id })) });
    promos = new TakeawayPromoService(prisma as unknown as PrismaService);
    admin = new TakeawayPromoAdminService(prisma as unknown as PrismaService);
  });

  afterEach(async () => {
    await prisma.welcomeBonus.deleteMany({ where: { userId: { in: CUSTOMERS } } });
    await prisma.takeawayPromoRedemption.deleteMany({ where: { storeId: STORE } });
    await prisma.order.deleteMany({ where: { storeId: STORE } });
    await prisma.takeawayPromo.deleteMany({ where: { code: { startsWith: 'TPIT' } } });
  });

  afterAll(async () => {
    await cleanUp(prisma);
    await prisma.$disconnect();
  });

  async function promo(code: string, budgetCents: number, extra: { isWelcome?: boolean } = {}) {
    const now = Date.now();
    return prisma.takeawayPromo.create({
      data: {
        name: code,
        code,
        percent: 10,
        startsAt: new Date(now - 60 * 60_000),
        endsAt: new Date(now + 24 * 60 * 60_000),
        currency: 'MDL',
        budgetCents,
        isWelcome: extra.isWelcome ?? false,
      },
    });
  }

  /** One checkout: the order and its share of the budget in one transaction, as POST /orders does it. */
  function checkout(
    promoRow: { id: string; code: string; isWelcome: boolean },
    userId: string,
    menuTotalCents = 10_000,
  ) {
    const n = ++orderNo;
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          id: `tpit-order-${n}`,
          userId,
          storeId: STORE,
          status: 'CREATED',
          pickupMode: 'ASAP',
          pickupAt: new Date(Date.now() + 15 * 60_000),
          subtotalCents: menuTotalCents,
          discountCents: menuTotalCents / 10,
          takeawayDiscountCents: menuTotalCents / 10,
          totalCents: menuTotalCents - menuTotalCents / 10,
          currency: 'MDL',
          orderCode: `tpit-${n}`,
          qrToken: `tpit-${n}`,
          couponCode: promoRow.code,
        },
      });
      // Hold the transaction open a little, so the checkouts really overlap.
      await new Promise((resolve) => setTimeout(resolve, 20));
      await promos.reserveForOrder(tx, {
        promoId: promoRow.id,
        code: promoRow.code,
        percent: 10,
        isWelcome: promoRow.isWelcome,
        userId,
        orderId: order.id,
        brandId: BRAND,
        storeId: STORE,
        currency: 'MDL',
        menuTotalCents,
        discountCents: menuTotalCents / 10,
      });
      return order;
    });
  }

  const codeOf = (r: PromiseSettledResult<unknown>) =>
    r.status === 'rejected' ? (r.reason as { response?: { code?: string } }).response?.code : 'OK';

  it('never takes more than the budget, whatever many customers check out at once — and exhausts on exactly 0', async () => {
    const row = await promo('TPIT-RUSH', 5_000);

    const results = await Promise.allSettled(CUSTOMERS.map((user) => checkout(row, user)));

    const codes = results.map(codeOf);
    expect(codes.filter((c) => c === 'OK')).toHaveLength(5);
    expect(codes.filter((c) => c === 'PROMO_LIMIT_REACHED')).toHaveLength(7);
    const after = await prisma.takeawayPromo.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ spentCents: 5_000, status: 'EXHAUSTED' });
    expect(after.exhaustedAt).toBeInstanceOf(Date);
    // A refused checkout left no order and no redemption behind.
    expect(await prisma.order.count({ where: { storeId: STORE } })).toBe(5);
    expect(await prisma.takeawayPromoRedemption.count({ where: { promoId: row.id } })).toBe(5);

    // A cancel gives D back; the promo stays exhausted until the admin switches it on (§2.5).
    const held = await prisma.takeawayPromoRedemption.findFirstOrThrow({ where: { promoId: row.id } });
    await prisma.$transaction((tx) => promos.releaseForOrder(tx, held.orderId));
    await expect(prisma.takeawayPromo.findUniqueOrThrow({ where: { id: row.id } })).resolves.toMatchObject({
      spentCents: 4_000,
      status: 'EXHAUSTED',
    });
    await expect(admin.updateStatus(row.id, { status: 'ACTIVE' })).resolves.toMatchObject({
      status: 'ACTIVE',
      leftCents: 1_000,
    });
  });

  it('exhausts a promo whose rest is too small for the next order (not exactly 0)', async () => {
    const row = await promo('TPIT-SHORT', 2_500);

    const results = await Promise.allSettled(CUSTOMERS.slice(0, 4).map((user) => checkout(row, user)));

    expect(results.map(codeOf).filter((c) => c === 'OK')).toHaveLength(2);
    await expect(prisma.takeawayPromo.findUniqueOrThrow({ where: { id: row.id } })).resolves.toMatchObject({
      spentCents: 2_000,
      status: 'ACTIVE',
    });
    // What OrdersService.create does after the refused transaction rolled back.
    await expect(promos.exhaustIfShort('tpit-short', 10_000)).resolves.toBe(true);
    await expect(prisma.takeawayPromo.findUniqueOrThrow({ where: { id: row.id } })).resolves.toMatchObject({
      status: 'EXHAUSTED',
    });
    // A smaller order would have fitted: nothing to exhaust for that one.
    const other = await promo('TPIT-FITS', 2_500);
    await expect(promos.exhaustIfShort('TPIT-FITS', 5_000)).resolves.toBe(false);
    await expect(prisma.takeawayPromo.findUniqueOrThrow({ where: { id: other.id } })).resolves.toMatchObject({
      status: 'ACTIVE',
    });
  });

  it('lets one customer hold a promo once, even with two checkouts at once', async () => {
    const row = await promo('TPIT-ONCE', 100_000);
    const user = CUSTOMERS[0] as string;

    const results = await Promise.allSettled([checkout(row, user), checkout(row, user)]);

    expect(results.map(codeOf).sort()).toEqual(['OK', 'PROMO_ALREADY_USED']);
    await expect(prisma.takeawayPromo.findUniqueOrThrow({ where: { id: row.id } })).resolves.toMatchObject({
      spentCents: 1_000,
    });
    await expect(
      promos.validate({ userId: user, code: 'tpit-once', subtotalCents: 10_000, place: { currency: 'MDL' } }),
    ).resolves.toMatchObject({ reasonCode: 'PROMO_ALREADY_USED' });
  });

  it('claims the welcome bonus with the order and frees it when the order is cancelled', async () => {
    const row = await promo('TPIT-WELCOME', 100_000, { isWelcome: true });
    const user = CUSTOMERS[1] as string;
    const welcome = new WelcomeBonusService(prisma as unknown as PrismaService, {} as NotificationsService);
    await expect(welcome.onCustomerCreated(user, { kind: 'telegram', telegramUserId: 424242 })).resolves.toBe(true);
    // Once per person: the same Telegram account on another profile gets nothing.
    await expect(
      welcome.onCustomerCreated(CUSTOMERS[2] as string, { kind: 'telegram', telegramUserId: 424242 }),
    ).resolves.toBe(false);
    await expect(welcome.listForUser(user)).resolves.toHaveLength(1);

    const order = await checkout(row, user);

    await expect(prisma.welcomeBonus.findUniqueOrThrow({ where: { userId: user } })).resolves.toMatchObject({
      orderId: order.id,
    });
    await expect(welcome.listForUser(user)).resolves.toEqual([]);

    await prisma.$transaction((tx) => promos.releaseForOrder(tx, order.id));
    await expect(prisma.welcomeBonus.findUniqueOrThrow({ where: { userId: user } })).resolves.toMatchObject({
      orderId: null,
    });
    await expect(prisma.takeawayPromo.findUniqueOrThrow({ where: { id: row.id } })).resolves.toMatchObject({
      spentCents: 0,
    });
  });

  it('counts an order as a debt only once it is accepted or paid, and freezes a used promo', async () => {
    const row = await promo('TPIT-DEBT', 100_000);
    const accepted = await checkout(row, CUSTOMERS[3] as string);
    await checkout(row, CUSTOMERS[4] as string);
    await prisma.order.update({ where: { id: accepted.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });

    const rows = await countedRedemptions(prisma, { brandId: BRAND });
    expect(rows.map((r) => r.orderId)).toEqual([accepted.id]);
    expect(debtReport(rows).rows).toEqual([
      expect.objectContaining({ brandId: BRAND, accruedCents: 1_000, debtCents: 1_000, brandName: 'TPIT Coffee' }),
    ]);

    await expect(admin.update(row.id, { percent: 20 })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TAKEAWAY_PROMO_USED' }),
    });
    await expect(admin.update(row.id, { budgetCents: 1_500 })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TAKEAWAY_PROMO_BUDGET' }),
    });
    await expect(admin.update(row.id, { budgetCents: 2_000 })).resolves.toMatchObject({ status: 'EXHAUSTED' });
  });
});

async function cleanUp(prisma: PrismaClient): Promise<void> {
  await prisma.welcomeBonus.deleteMany({ where: { userId: { in: CUSTOMERS } } });
  await prisma.takeawayPromoRedemption.deleteMany({ where: { storeId: STORE } });
  await prisma.order.deleteMany({ where: { storeId: STORE } });
  await prisma.takeawayPromo.deleteMany({ where: { code: { startsWith: 'TPIT' } } });
  await prisma.store.deleteMany({ where: { id: STORE } });
  await prisma.user.deleteMany({ where: { id: { in: CUSTOMERS } } });
  await prisma.brand.deleteMany({ where: { id: BRAND } });
}
