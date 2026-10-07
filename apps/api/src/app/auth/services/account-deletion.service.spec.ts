import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';

import type { MailService } from '../../mail/mail.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RealtimeGateway } from '../../realtime/realtime.gateway';
import type { StorageService } from '../../storage/storage.service';
import type { UsersService } from '../../users/users.service';
import { AuthService } from '../auth.service';
import {
  AccountDeletionService,
  BRAND_OWNER_DELETION_REFUSED,
  STAFF_DELETION_REFUSED,
} from './account-deletion.service';
import type { KdsPinService } from './kds-pin.service';
import type { AppleTokenRevocationService } from './apple-token-revocation.service';
import type { OAuthIdentityService } from './oauth-identity.service';
import type { PasswordService } from './password.service';
import type { TelegramService } from './telegram.service';
import type { TokensService } from './tokens.service';

interface FakeUser {
  id: string;
  role: Role;
  name: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  dateOfBirth: Date | null;
  telegramUserId: bigint | null;
  passwordHash: string | null;
  passwordMustChange: boolean;
  referralCode: string | null;
  referredByUserId: string | null;
  kdsPinHash: string | null;
  kdsPinStoreId: string | null;
  notifyOrderUpdates: boolean;
  notifyPromotions: boolean;
  blockedAt: Date | null;
  locale: 'EN' | 'RU';
  currency: 'USD';
}

type Row = Record<string, unknown>;

interface Tables {
  users: FakeUser[];
  brands: Row[];
  oauthAccounts: Row[];
  devices: Row[];
  carts: Row[];
  cartItems: Row[];
  cardTokens: Row[];
  cardBindings: Row[];
  passwordResetTokens: Row[];
  userStores: Row[];
  loyaltyAccounts: Row[];
  pointsLedger: Row[];
  orders: Row[];
  orderEvents: Row[];
  payments: Row[];
  referrals: Row[];
  promoRedemptions: Row[];
  giftCards: Row[];
  feedback: Row[];
}

function user(id: string, extra: Partial<FakeUser> = {}): FakeUser {
  return {
    id,
    role: Role.CUSTOMER,
    name: null,
    email: null,
    phone: null,
    avatarUrl: null,
    dateOfBirth: null,
    telegramUserId: null,
    passwordHash: null,
    passwordMustChange: false,
    referralCode: null,
    referredByUserId: null,
    kdsPinHash: null,
    kdsPinStoreId: null,
    notifyOrderUpdates: true,
    notifyPromotions: true,
    blockedAt: null,
    locale: 'EN',
    currency: 'USD',
    ...extra,
  };
}

/** An order row with every column deletion looks at; personal ones empty unless given. */
function order(id: string, userId: string, extra: Row = {}): Row {
  return {
    id,
    userId,
    storeId: 'store-1',
    status: 'PICKED_UP',
    fulfillmentType: 'PICKUP',
    orderCode: `C-${id}`,
    customerName: null,
    customerPhone: null,
    notes: null,
    deliveryAddressLine: null,
    deliveryCity: null,
    deliveryNotes: null,
    deliveryLatitude: null,
    deliveryLongitude: null,
    deliveryFeeCents: 0,
    deliveryDistanceM: null,
    subtotalCents: 1000,
    totalCents: 1000,
    currency: 'MDL',
    createdAt: new Date('2026-09-20T08:00:00Z'),
    ...extra,
  };
}

/** A customer with something in every table deletion has an opinion on, next to a bystander. */
function seed(): Tables {
  return {
    users: [
      user('ana', {
        name: 'Ana Customer',
        email: 'ana@example.com',
        phone: '+37377700000',
        avatarUrl: 'https://cdn.takeaway.md/avatars/ana.jpg',
        dateOfBirth: new Date('1990-05-01T00:00:00Z'),
        telegramUserId: 777n,
        referralCode: 'ANA123',
        referredByUserId: 'bob',
      }),
      user('bob', { name: 'Bob', email: 'bob@example.com', telegramUserId: 888n, referralCode: 'BOB456' }),
    ],
    brands: [{ id: 'brand-1', ownerId: 'owner' }],
    oauthAccounts: [
      { id: 'oa-1', userId: 'ana', provider: 'GOOGLE', providerUserId: 'google-sub' },
      { id: 'oa-2', userId: 'ana', provider: 'APPLE', providerUserId: 'apple-sub' },
      { id: 'oa-3', userId: 'bob', provider: 'GOOGLE', providerUserId: 'bob-google' },
    ],
    devices: [
      { id: 'dev-1', userId: 'ana', pushToken: 'fcm-ana' },
      { id: 'dev-2', userId: 'bob', pushToken: 'fcm-bob' },
    ],
    carts: [
      { id: 'cart-1', userId: 'ana' },
      { id: 'cart-2', userId: 'bob' },
    ],
    cartItems: [
      { id: 'ci-1', cartId: 'cart-1' },
      { id: 'ci-2', cartId: 'cart-2' },
    ],
    cardTokens: [
      { id: 'card-1', userId: 'ana', maskedPan: '9104 **** **** 1234' },
      { id: 'card-2', userId: 'bob', maskedPan: '9104 **** **** 9999' },
    ],
    cardBindings: [{ id: 'bind-1', userId: 'ana', phone: '77712345', cardTokenId: 'card-1' }],
    passwordResetTokens: [{ id: 'prt-1', userId: 'ana' }],
    userStores: [],
    loyaltyAccounts: [
      { id: 'la-ana', userId: 'ana', pointsBalance: 420, lifetimePoints: 900, tier: 'GOLD' },
      { id: 'la-bob', userId: 'bob', pointsBalance: 50, lifetimePoints: 50, tier: 'SILVER' },
    ],
    pointsLedger: [
      { id: 'pl-1', loyaltyAccountId: 'la-ana', userId: 'ana', orderId: 'order-1', type: 'EARN', amount: 900 },
      { id: 'pl-2', loyaltyAccountId: 'la-ana', userId: 'ana', orderId: 'order-2', type: 'SPEND', amount: -480 },
    ],
    orders: [
      order('order-1', 'ana', {
        customerName: 'Ana Customer',
        customerPhone: '+37377700000',
        notes: 'oat milk, please',
        totalCents: 4500,
      }),
      order('order-2', 'ana', {
        status: 'OUT_FOR_DELIVERY',
        fulfillmentType: 'DELIVERY',
        customerName: 'Ana Customer',
        deliveryAddressLine: 'str. 25 Octombrie 12, ap. 5',
        deliveryCity: 'Tiraspol',
        deliveryNotes: 'Entrance 2, door code 1234',
        deliveryLatitude: 46.8403,
        deliveryLongitude: 29.6433,
        deliveryFeeCents: 1500,
        deliveryDistanceM: 2300,
        totalCents: 1200,
      }),
      order('order-3', 'bob', {
        customerName: 'Bob',
        customerPhone: '+37377711111',
        fulfillmentType: 'DELIVERY',
        deliveryAddressLine: 'Bob street 1',
        deliveryCity: 'Tiraspol',
        deliveryLatitude: 46.1,
        deliveryLongitude: 29.1,
      }),
    ],
    orderEvents: [
      { id: 'ev-1', orderId: 'order-1', type: 'STATUS_CHANGED', payload: { from: 'CREATED', to: 'PAID' } },
      {
        id: 'ev-2',
        orderId: 'order-1',
        type: 'CUSTOMER_NEARBY',
        payload: { distanceM: 180.4, lat: 46.84, lng: 29.63 },
      },
      { id: 'ev-3', orderId: 'order-1', type: 'CUSTOMER_HERE', payload: { distanceM: 12.1, lat: 46.841, lng: 29.631 } },
      { id: 'ev-4', orderId: 'order-3', type: 'CUSTOMER_HERE', payload: { distanceM: 5, lat: 46.1, lng: 29.1 } },
    ],
    payments: [
      { id: 'pay-1', orderId: 'order-1', cardTokenId: 'card-1', invoiceId: 'INV-1', amountCents: 4500 },
      { id: 'pay-2', orderId: 'order-9', cardTokenId: 'card-2', invoiceId: 'INV-9', amountCents: 300 },
    ],
    referrals: [
      { id: 'ref-1', referrerId: 'bob', refereeId: 'ana', status: 'REWARDED' },
      { id: 'ref-2', referrerId: 'ana', refereeId: 'carl', status: 'PENDING' },
    ],
    promoRedemptions: [{ id: 'pr-1', userId: 'ana', orderId: 'order-1', discountCents: 500 }],
    giftCards: [{ id: 'gc-1', purchaserUserId: 'ana', code: 'GIFT1', balanceCents: 1000 }],
    feedback: [
      { id: 'fb-1', userId: 'ana', kind: 'SUGGESTION', message: 'Add oat milk', contact: '@ana_tg' },
      { id: 'fb-2', userId: 'bob', kind: 'REVIEW', message: 'Great coffee', contact: 'bob@example.com' },
    ],
  };
}

/**
 * Just enough of Prisma, in memory, for deletion and sign-in to run for real.
 * Like Prisma, reads and writes hand back copies, never the stored row.
 */
function fakeDb(t: Tables) {
  let seq = 0;
  const copy = <T extends object>(row: T | null | undefined): T | null => (row ? { ...row } : null);
  const findUser = (where: { id?: string; email?: string; telegramUserId?: bigint }) =>
    t.users.find(
      (u) =>
        (where.id !== undefined && u.id === where.id) ||
        (where.email !== undefined && u.email === where.email) ||
        (where.telegramUserId !== undefined && u.telegramUserId === where.telegramUserId),
    ) ?? null;
  const assertUnique = (u: FakeUser | null, data: Partial<FakeUser>) => {
    for (const key of ['email', 'telegramUserId', 'referralCode', 'phone'] as const) {
      if (data[key] != null && t.users.some((o) => o !== u && o[key] === data[key])) {
        throw new Error(`unique violation on ${key}`);
      }
    }
  };
  const createUser = (data: Partial<FakeUser> & { oauthAccounts?: { create: Row } }): FakeUser => {
    const { oauthAccounts, ...fields } = data;
    assertUnique(null, fields);
    const created = user(`new-${++seq}`, fields);
    t.users.push(created);
    if (oauthAccounts) t.oauthAccounts.push({ id: `oa-new-${seq}`, userId: created.id, ...oauthAccounts.create });
    return { ...created };
  };
  /** Removes the rows of `table` owned by `userId`; returns them. */
  const removeByUser = (table: Row[], userId: string): Row[] => {
    const removed = table.filter((r) => r['userId'] === userId);
    for (const r of removed) table.splice(table.indexOf(r), 1);
    return removed;
  };
  const deleteManyByUser = (table: Row[]) => ({
    deleteMany: jest.fn(async ({ where }: { where: { userId: string } }) => ({
      count: removeByUser(table, where.userId).length,
    })),
  });

  const db: Record<string, unknown> = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: never }) => copy(findUser(where))),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) => {
        const u = findUser(where);
        if (!u) throw new Error('record not found');
        assertUnique(u, data);
        return copy(Object.assign(u, data));
      }),
      create: jest.fn(async ({ data }: { data: Partial<FakeUser> }) => createUser(data)),
      upsert: jest.fn(
        async ({
          where,
          update,
          create,
        }: {
          where: { telegramUserId: bigint };
          update: Partial<FakeUser>;
          create: Partial<FakeUser>;
        }) => {
          const u = findUser(where);
          if (!u) return createUser(create);
          const patch = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined));
          return copy(Object.assign(u, patch));
        },
      ),
    },
    brand: {
      count: jest.fn(
        async ({ where }: { where: { ownerId: string } }) =>
          t.brands.filter((b) => b['ownerId'] === where.ownerId).length,
      ),
    },
    oAuthAccount: {
      ...deleteManyByUser(t.oauthAccounts),
      findUnique: jest.fn(
        async ({ where }: { where: { provider_providerUserId: { provider: string; providerUserId: string } } }) => {
          const { provider, providerUserId } = where.provider_providerUserId;
          const a = t.oauthAccounts.find((x) => x['provider'] === provider && x['providerUserId'] === providerUserId);
          return a ? { ...a, user: copy(findUser({ id: a['userId'] as string })) } : null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: `oa-new-${++seq}`, ...data };
        t.oauthAccounts.push(row);
        return copy(row);
      }),
    },
    device: {
      ...deleteManyByUser(t.devices),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: `dev-new-${++seq}`, ...data };
        t.devices.push(row);
        return copy(row);
      }),
    },
    cart: {
      // CartItem → Cart is ON DELETE CASCADE in the database.
      deleteMany: jest.fn(async ({ where }: { where: { userId: string } }) => {
        const removed = removeByUser(t.carts, where.userId);
        const ids = new Set(removed.map((c) => c['id']));
        for (let i = t.cartItems.length - 1; i >= 0; i--) {
          if (ids.has(t.cartItems[i]?.['cartId'])) t.cartItems.splice(i, 1);
        }
        return { count: removed.length };
      }),
    },
    cardToken: {
      // Payment.cardTokenId and CardBindingRequest.cardTokenId are ON DELETE SET NULL.
      deleteMany: jest.fn(async ({ where }: { where: { userId: string } }) => {
        const removed = removeByUser(t.cardTokens, where.userId);
        const ids = new Set(removed.map((c) => c['id']));
        for (const r of [...t.payments, ...t.cardBindings]) if (ids.has(r['cardTokenId'])) r['cardTokenId'] = null;
        return { count: removed.length };
      }),
    },
    cardBindingRequest: deleteManyByUser(t.cardBindings),
    passwordResetToken: deleteManyByUser(t.passwordResetTokens),
    userStore: deleteManyByUser(t.userStores),
    loyaltyAccount: {
      findUnique: jest.fn(async ({ where }: { where: { userId: string } }) =>
        copy(t.loyaltyAccounts.find((a) => a['userId'] === where.userId)),
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) =>
        copy(Object.assign(t.loyaltyAccounts.find((a) => a['id'] === where.id) as Row, data)),
      ),
    },
    pointsLedger: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: `pl-new-${++seq}`, ...data };
        t.pointsLedger.push(row);
        return copy(row);
      }),
    },
    order: {
      updateMany: jest.fn(async ({ where, data }: { where: { userId: string }; data: Row }) => {
        const mine = t.orders.filter((o) => o['userId'] === where.userId);
        for (const o of mine) Object.assign(o, data);
        return { count: mine.length };
      }),
    },
    feedback: {
      updateMany: jest.fn(async ({ where, data }: { where: { userId: string }; data: Row }) => {
        const mine = t.feedback.filter((f) => f['userId'] === where.userId);
        for (const f of mine) Object.assign(f, data);
        return { count: mine.length };
      }),
    },
    orderEvent: {
      findMany: jest.fn(async ({ where }: { where: { order: { userId: string }; type: { in: string[] } } }) => {
        const orderIds = new Set(t.orders.filter((o) => o['userId'] === where.order.userId).map((o) => o['id']));
        return t.orderEvents
          .filter((e) => orderIds.has(e['orderId']) && where.type.in.includes(e['type'] as string))
          .map((e) => ({ id: e['id'], payload: structuredClone(e['payload']) }));
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) =>
        copy(Object.assign(t.orderEvents.find((e) => e['id'] === where.id) as Row, data)),
      ),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(db)),
  };
  return db;
}

function setup(tables: Tables = seed()) {
  const db = fakeDb(tables);
  const tokens = {
    revokeAll: jest.fn(async () => 2),
    issue: jest.fn(async () => ({
      accessToken: 'a',
      refreshToken: 'r',
      accessTokenExpiresInSeconds: 1,
      refreshTokenExpiresInSeconds: 1,
    })),
  };
  const storage = { deleteByPublicUrl: jest.fn(async () => true) };
  const realtime = { disconnectUser: jest.fn() };
  const apple = { revokeAuthorizationCode: jest.fn(async () => 'revoked' as const) };
  const svc = new AccountDeletionService(
    db as unknown as PrismaService,
    tokens as unknown as TokensService,
    storage as unknown as StorageService,
    realtime as unknown as RealtimeGateway,
    apple as unknown as AppleTokenRevocationService,
  );
  return { svc, db, t: tables, tokens, storage, realtime, apple };
}

/** Structured copy for before/after comparisons (bigint and Date survive). */
function snapshot(t: Tables): Tables {
  return structuredClone(t);
}

describe('AccountDeletionService', () => {
  it('turns the customer into an anonymised, blocked tombstone', async () => {
    const { svc, t } = setup();
    await svc.deleteOwnAccount('ana');

    const ana = t.users.find((u) => u.id === 'ana');
    expect(ana).toMatchObject({
      role: Role.CUSTOMER,
      name: null,
      email: null,
      phone: null,
      avatarUrl: null,
      dateOfBirth: null,
      telegramUserId: null,
      passwordHash: null,
      referralCode: null,
      kdsPinHash: null,
      kdsPinStoreId: null,
      notifyOrderUpdates: false,
      notifyPromotions: false,
    });
    expect(ana?.blockedAt).toBeInstanceOf(Date);
    // The referral that brought Ana in is programme history, not profile data.
    expect(ana?.referredByUserId).toBe('bob');
  });

  it('removes identities, devices, carts, saved cards and reset tokens — only the customer’s own', async () => {
    const { svc, t } = setup();
    await svc.deleteOwnAccount('ana');

    expect(t.oauthAccounts.map((a) => a['id'])).toEqual(['oa-3']);
    expect(t.devices.map((d) => d['id'])).toEqual(['dev-2']);
    expect(t.carts.map((c) => c['id'])).toEqual(['cart-2']);
    expect(t.cartItems.map((i) => i['id'])).toEqual(['ci-2']);
    expect(t.cardTokens.map((c) => c['id'])).toEqual(['card-2']);
    expect(t.cardBindings).toEqual([]);
    expect(t.passwordResetTokens).toEqual([]);
    expect(t.users.find((u) => u.id === 'bob')).toMatchObject({ email: 'bob@example.com', telegramUserId: 888n });
  });

  it('anonymises every order of the customer and keeps what the business accounts with', async () => {
    const { svc, t } = setup();
    const before = snapshot(t);
    await svc.deleteOwnAccount('ana');

    const personal = {
      customerName: null,
      customerPhone: null,
      deliveryAddressLine: null,
      deliveryCity: null,
      deliveryNotes: null,
      deliveryLatitude: null,
      deliveryLongitude: null,
    };
    // Same rows, same ids, amounts, statuses, store, times, fee and distance —
    // only the person is gone. The in-flight delivery is included.
    expect(t.orders).toEqual([
      { ...before.orders[0], ...personal },
      { ...before.orders[1], ...personal },
      before.orders[2],
    ]);
    expect(t.orders[0]).toMatchObject({ notes: 'oat milk, please', totalCents: 4500, status: 'PICKED_UP' });
    expect(t.orders[1]).toMatchObject({ deliveryFeeCents: 1500, deliveryDistanceM: 2300 });
  });

  it('drops the coordinates from arrival pings and keeps their kind and distance', async () => {
    const { svc, t } = setup();
    const before = snapshot(t);
    await svc.deleteOwnAccount('ana');

    expect(t.orderEvents).toEqual([
      before.orderEvents[0],
      { id: 'ev-2', orderId: 'order-1', type: 'CUSTOMER_NEARBY', payload: { distanceM: 180.4 } },
      { id: 'ev-3', orderId: 'order-1', type: 'CUSTOMER_HERE', payload: { distanceM: 12.1 } },
      // Someone else's order keeps its event as it was.
      before.orderEvents[3],
    ]);
  });

  it('leaves payments, promo redemptions, referrals and gift cards in place', async () => {
    const { svc, t } = setup();
    const before = snapshot(t);
    await svc.deleteOwnAccount('ana');

    expect(t.promoRedemptions).toEqual(before.promoRedemptions);
    expect(t.referrals).toEqual(before.referrals);
    expect(t.giftCards).toEqual(before.giftCards);
    // The payment stays whole; only the link to the deleted card is cut.
    expect(t.payments).toEqual([{ ...before.payments[0], cardTokenId: null }, before.payments[1]]);
  });

  it('keeps the customer’s feedback but clears the contact typed into it', async () => {
    const { svc, t } = setup();
    const before = snapshot(t);
    await svc.deleteOwnAccount('ana');

    expect(t.feedback).toEqual([{ ...before.feedback[0], contact: null }, before.feedback[1]]);
  });

  it('keeps the loyalty ledger and forfeits the balance with a matching ledger row', async () => {
    const { svc, t } = setup();
    await svc.deleteOwnAccount('ana');

    expect(t.loyaltyAccounts.find((a) => a['userId'] === 'ana')).toMatchObject({
      pointsBalance: 0,
      lifetimePoints: 900,
      tier: 'GOLD',
    });
    expect(t.pointsLedger.map((e) => e['id'])).toEqual(['pl-1', 'pl-2', expect.any(String)]);
    expect(t.pointsLedger[2]).toMatchObject({
      loyaltyAccountId: 'la-ana',
      userId: 'ana',
      type: 'EXPIRE',
      amount: -420,
    });
    expect(t.loyaltyAccounts.find((a) => a['userId'] === 'bob')).toMatchObject({ pointsBalance: 50 });
  });

  it('writes no ledger row when there is no balance to forfeit', async () => {
    const tables = seed();
    tables.loyaltyAccounts = [];
    const { svc, t } = setup(tables);
    await svc.deleteOwnAccount('ana');
    expect(t.pointsLedger).toHaveLength(2);
  });

  it('revokes every session, drops open sockets and removes the stored avatar', async () => {
    const { svc, tokens, realtime, storage } = setup();
    await svc.deleteOwnAccount('ana');

    expect(tokens.revokeAll).toHaveBeenCalledWith('ana');
    expect(realtime.disconnectUser).toHaveBeenCalledWith('ana');
    expect(storage.deleteByPublicUrl).toHaveBeenCalledWith('https://cdn.takeaway.md/avatars/ana.jpg');
  });

  it('still succeeds when the clean-up after the commit fails', async () => {
    const { svc, t, tokens, storage, realtime } = setup();
    tokens.revokeAll.mockRejectedValueOnce(new Error('redis down'));
    realtime.disconnectUser.mockImplementationOnce(() => {
      throw new Error('gateway not ready');
    });
    storage.deleteByPublicUrl.mockRejectedValueOnce(new Error('AccessDenied'));

    await expect(svc.deleteOwnAccount('ana')).resolves.toBeUndefined();
    expect(t.users.find((u) => u.id === 'ana')?.blockedAt).toBeInstanceOf(Date);
  });

  it.each([Role.STAFF, Role.STORE_MANAGER, Role.MENU_EDITOR, Role.BRAND_ADMIN, Role.SUPER_ADMIN, Role.RIDER])(
    'refuses a %s account and changes nothing',
    async (role) => {
      const tables = seed();
      (tables.users[0] as FakeUser).role = role;
      const { svc, t, tokens } = setup(tables);
      const before = snapshot(t);

      const attempt = svc.deleteOwnAccount('ana');
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      await expect(attempt).rejects.toThrow(STAFF_DELETION_REFUSED);
      expect(t).toEqual(before);
      expect(tokens.revokeAll).not.toHaveBeenCalled();
    },
  );

  it('refuses a customer who owns a brand and changes nothing', async () => {
    const tables = seed();
    tables.brands.push({ id: 'brand-2', ownerId: 'ana' });
    const { svc, t, tokens } = setup(tables);
    const before = snapshot(t);

    const attempt = svc.deleteOwnAccount('ana');
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attempt).rejects.toThrow(BRAND_OWNER_DELETION_REFUSED);
    expect(t).toEqual(before);
    expect(tokens.revokeAll).not.toHaveBeenCalled();
  });

  describe('Sign in with Apple', () => {
    it('revokes the Apple grant with the code before the transaction starts', async () => {
      const { svc, db, apple } = setup();
      await svc.deleteOwnAccount('ana', { appleAuthorizationCode: 'apple-code' });

      expect(apple.revokeAuthorizationCode).toHaveBeenCalledWith('apple-code', 'ana');
      const transaction = db['$transaction'] as jest.Mock;
      expect(apple.revokeAuthorizationCode.mock.invocationCallOrder[0]).toBeLessThan(
        transaction.mock.invocationCallOrder[0] as number,
      );
    });

    it('does not call Apple without a code', async () => {
      const { svc, apple } = setup();
      await svc.deleteOwnAccount('ana');
      await svc.deleteOwnAccount('bob', { appleAuthorizationCode: '   ' });
      expect(apple.revokeAuthorizationCode).not.toHaveBeenCalled();
    });

    it('never tells Apple about an account it then refuses to delete', async () => {
      const tables = seed();
      (tables.users[0] as FakeUser).role = Role.BRAND_ADMIN;
      tables.brands.push({ id: 'brand-2', ownerId: 'bob' });
      const { svc, apple } = setup(tables);

      await expect(svc.deleteOwnAccount('ana', { appleAuthorizationCode: 'code' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(svc.deleteOwnAccount('bob', { appleAuthorizationCode: 'code' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(apple.revokeAuthorizationCode).not.toHaveBeenCalled();
    });

    it('still deletes the account when the revocation blows up', async () => {
      const { svc, t, apple } = setup();
      apple.revokeAuthorizationCode.mockRejectedValueOnce(new Error('unexpected'));

      await expect(svc.deleteOwnAccount('ana', { appleAuthorizationCode: 'code' })).resolves.toBeUndefined();
      expect(t.users.find((u) => u.id === 'ana')?.blockedAt).toBeInstanceOf(Date);
    });
  });

  describe('signing in again afterwards', () => {
    function authService(db: Record<string, unknown>, tokens: unknown) {
      const oauth = {
        verify: jest.fn(async (provider: 'GOOGLE' | 'APPLE') => ({
          provider,
          providerUserId: provider === 'GOOGLE' ? 'google-sub' : 'apple-sub',
          email: 'ana@example.com',
          emailVerified: true,
          isPrivateEmail: false,
          name: 'Ana',
          locale: null,
        })),
        verifyTelegram: jest.fn(async () => ({ id: 777, firstName: 'Ana', lastName: null, username: null })),
      };
      return new AuthService(
        db as unknown as PrismaService,
        {} as UsersService,
        tokens as TokensService,
        {} as TelegramService,
        oauth as unknown as OAuthIdentityService,
        {} as PasswordService,
        {} as KdsPinService,
        {} as MailService,
        {} as ConfigService,
      );
    }

    it.each(['GOOGLE', 'APPLE'] as const)('with the same %s account opens a new, empty customer', async (provider) => {
      const { svc, db, t, tokens } = setup();
      await svc.deleteOwnAccount('ana');

      const session = await authService(db, tokens).loginWithOAuth(provider, 'id-token');

      expect(session.user.id).not.toBe('ana');
      expect(session.user.role).toBe(Role.CUSTOMER);
      expect(t.orders.filter((o) => o['userId'] === session.user.id)).toEqual([]);
      expect(t.oauthAccounts.find((a) => a['userId'] === 'ana')).toBeUndefined();
    });

    it('with the same Telegram account opens a new, empty customer', async () => {
      const { svc, db, t, tokens } = setup();
      await svc.deleteOwnAccount('ana');

      const session = await authService(db, tokens).loginWithTelegramIdToken('id-token');

      expect(session.user.id).not.toBe('ana');
      expect(session.user.telegramUserId).toBe('777');
      expect(t.users.find((u) => u.id === 'ana')?.telegramUserId).toBeNull();
      expect(t.orders.filter((o) => o['userId'] === session.user.id)).toEqual([]);
    });
  });
});
