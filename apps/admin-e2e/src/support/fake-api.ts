import type { BrowserContext, Route } from '@playwright/test';

/**
 * A small in-memory stand-in for the admin API.
 *
 * The forms suite is about layout, not about persistence: it needs the app
 * to render a brand, a store, a category and a product so that every
 * add/edit form on every page has something to open against. Booting a
 * Postgres for that would buy nothing.
 *
 * The shapes are hand-kept in step with the DTOs in
 * `apps/admin/src/app/core`, so a change there shows up here as a page that
 * renders empty rather than as a silent pass.
 */

export const BRAND = {
  id: 'brand-1',
  slug: 'noname-coffee',
  name: 'NoName Coffee',
  currency: 'MDL',
  locale: 'RU',
  logoUrl: null,
  description: null,
  themeOverrides: null,
  moderationStatus: 'APPROVED',
  ownerId: 'user-1',
  contactPhone: '+37369123456',
  _count: { stores: 1, products: 1 },
};

export const STORE = {
  id: 'store-1',
  brandId: BRAND.id,
  slug: 'test',
  name: 'test',
  addressLine: 'str. Stefan cel Mare 123',
  city: 'Chisinau',
  country: 'MD',
  latitude: 47.0245,
  longitude: 28.8323,
  status: 'OPEN',
  currency: 'MDL',
  phone: '+37360123456',
  email: 'test@takeaway.md',
  minOrderCents: 0,
  timezone: 'Europe/Chisinau',
  workingHours: [],
};

export const CATEGORY = {
  id: 'cat-1',
  brandId: BRAND.id,
  slug: 'coffee',
  name: 'Coffee',
  description: null,
  sortOrder: 0,
  visible: true,
  // A drink: its products have no calories or nutrition to fill in (2026-11-06).
  kind: 'HOT_DRINKS',
  _count: { products: 1 },
};

export const PRODUCT = {
  id: 'product-1',
  brandId: BRAND.id,
  categoryId: CATEGORY.id,
  slug: 'flat-white',
  name: 'Flat White',
  description: null,
  basePriceCents: 2500,
  prepTimeSeconds: 120,
  visible: true,
  sortOrder: 0,
  imageUrls: [],
  calories: null,
  proteinsGrams: null,
  fatsGrams: null,
  carbsGrams: null,
  storeIds: [STORE.id],
};

const STAFF = {
  id: 'user-store-1',
  userId: 'user-2',
  storeId: STORE.id,
  role: 'STAFF',
  name: 'Ion',
  email: 'ion@takeaway.md',
  phone: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** The same person as the Staff page sees them: one role, a list of stores. */
export const STAFF_MEMBER = {
  userId: STAFF.userId,
  email: STAFF.email,
  login: null,
  phone: null,
  name: STAFF.name,
  role: 'STAFF',
  blocked: false,
  addedAt: STAFF.createdAt,
  stores: [{ id: STORE.id, name: STORE.name }],
  kdsPinStoreId: null,
  hasKdsPin: false,
  editable: true,
};

/** The roles a suite can sign in as; the platform team unless it says otherwise. */
export type FakeRole = 'SUPER_ADMIN' | 'BRAND_ADMIN' | 'MENU_EDITOR';

const USER = {
  id: 'user-1',
  email: 'owner@takeaway.md',
  name: 'Sam',
  role: 'SUPER_ADMIN' as FakeRole,
  locale: 'RU',
  phone: null,
  currency: 'MDL',
  telegramUserId: null,
};

/** One add-on of the library, used by the latte, at its usual price. */
export const OAT_MILK = {
  id: 'ing-oat',
  brandId: BRAND.id,
  name: 'Овсяное молоко',
  isAvailable: true,
  priceCents: 500,
  group: null,
  products: [{ id: PRODUCT.id, name: PRODUCT.name }],
};

/** The stop-list of the one store: the product on sale, the oat milk too. */
export const AVAILABILITY = {
  storeId: STORE.id,
  storeName: STORE.name,
  timezone: STORE.timezone,
  products: [
    {
      id: PRODUCT.id,
      name: PRODUCT.name,
      categoryId: CATEGORY.id,
      categoryName: CATEGORY.name,
      imageUrl: null,
      stop: null,
    },
  ],
  ingredients: [{ id: OAT_MILK.id, name: OAT_MILK.name, isAvailable: true, stop: null, productNames: [PRODUCT.name] }],
  // Catalog options the store uses (their group is on a product sold here) and the brand has.
  options: [
    {
      id: 'opt-vanilla',
      name: 'Ваниль',
      note: null,
      groupId: 'g-syrup',
      groupName: 'Сиропы',
      stop: null,
      productNames: [PRODUCT.name],
    },
  ],
};

const PERIOD = {
  from: '2026-09-28',
  to: '2026-10-04',
  days: 7,
  timeZone: 'Europe/Chisinau',
  previousFrom: '2026-09-21',
  previousTo: '2026-09-27',
};

/** Revenue is sales at menu prices less discounts; new and returning customers add up. */
function totals(revenueCents: number, orders: number) {
  const discountCents = Math.round(revenueCents * 0.05);
  const customers = Math.round(orders * 0.8);
  const newCustomers = Math.round(orders * 0.2);
  return {
    salesCents: revenueCents + discountCents,
    discountCents,
    revenueCents,
    giftCardCents: 0,
    orders,
    placed: orders + 2,
    customers,
    newCustomers,
    returningCustomers: customers - newCustomers,
    avgCheckCents: orders ? Math.round(revenueCents / orders) : null,
    cancelled: 1,
    expired: 1,
    cancelRatePercent: orders ? Math.round((2 / (orders + 2)) * 1000) / 10 : null,
    avgPickupSeconds: 150,
    activeUnits: 2,
    commissionCents: Math.round(revenueCents * 0.15),
  };
}

const DAILY = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map(
  (date, i) => ({
    date,
    revenueCents: 40_000 + i * 5_000,
    orders: 8 + i,
    customers: 6 + i,
    newCustomers: 1,
    cancelled: i % 3 === 0 ? 1 : 0,
    expired: 0,
    commissionCents: 6_000 + i * 750,
  }),
);

function storeRow(id: string, name: string, revenueCents: number, orders: number, previousOrders: number) {
  return {
    id,
    name,
    revenueCents,
    orders,
    sharePercent: 0,
    ordersSharePercent: 0,
    detailed: true,
    previousRevenueCents: Math.round(revenueCents * 0.9),
    previousOrders,
    revenueDeltaPercent: 11.1,
    avgCheckCents: orders ? Math.round(revenueCents / orders) : null,
    customers: Math.round(orders * 0.8),
    cancelled: 1,
    expired: 0,
    cancelRatePercent: 2,
    avgPickupSeconds: 140,
  };
}

/** A PRO brand with three stores: Center earns most, Mall takes most orders. */
export const BUSINESS_OVERVIEW = {
  period: PERIOD,
  currency: 'MDL',
  currencies: ['MDL'],
  current: totals(420_000, 77),
  previous: totals(380_000, 70),
  daily: DAILY,
  statuses: { PICKED_UP: 70, PAID: 2, IN_PROGRESS: 5, CANCELLED: 1, EXPIRED: 1 },
  byStore: [
    storeRow(STORE.id, 'Центр', 250_000, 30, 25),
    storeRow('store-2', 'Молл', 150_000, 40, 41),
    storeRow('store-3', 'Аэропорт', 20_000, 7, 3),
  ],
  storeComparison: true,
  byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, orders: hour >= 7 && hour <= 21 ? 5 : 0, revenueCents: 0 })),
  byWeekday: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, orders: 10 + i, revenueCents: 0 })),
};

/** Regulars who stopped ordering: two now, one in the period before. */
export const CHURN = {
  from: PERIOD.from,
  to: PERIOD.to,
  timeZone: PERIOD.timeZone,
  window: 14,
  count: 2,
  lostRevenueCents: 9_000,
  previous: { count: 1, lostRevenueCents: 4_000 },
  countDeltaPercent: 100,
  customers: [
    {
      userId: 'customer-1',
      name: 'Анна',
      phone: null,
      orders: 6,
      totalCents: 27_000,
      avgCheckCents: 4_500,
      lastOrderAt: '2026-09-12T08:30:00.000Z',
      daysSinceLastOrder: 22,
      visits: 6,
      visitIntervalDays: 11,
      lostRevenueCents: 9_000,
    },
  ],
};

export const PLATFORM_OVERVIEW = {
  period: PERIOD,
  currency: 'MDL',
  currencies: ['MDL'],
  current: totals(12_500, 4),
  previous: totals(10_000, 3),
  daily: DAILY,
  statuses: { PICKED_UP: 3, CANCELLED: 1 },
  byBrand: [
    {
      ...storeRow(BRAND.id, BRAND.name, 12_500, 4, 3),
      currency: 'MDL',
      plan: 'PRO',
      commissionBps: 1500,
      commissionCents: 1_875,
      previousCommissionCents: 1_500,
      stores: 1,
      moderationStatus: 'APPROVED',
    },
    {
      ...storeRow('brand-2', 'Новая кофейня', 0, 0, 0),
      currency: 'MDL',
      plan: 'BASIC',
      commissionBps: 1000,
      commissionCents: 0,
      previousCommissionCents: 0,
      stores: 0,
      moderationStatus: 'PENDING',
    },
  ],
  byHour: BUSINESS_OVERVIEW.byHour,
  byWeekday: BUSINESS_OVERVIEW.byWeekday,
};

/** Signs the browser in before the app boots, the way a real session is. */
export async function signIn(context: BrowserContext, role: FakeRole = 'SUPER_ADMIN'): Promise<void> {
  await context.addInitScript(
    (user) => {
      localStorage.setItem(
        'takeaway.admin.session',
        JSON.stringify({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          accessTokenExpiresInSeconds: 3600,
          refreshTokenExpiresInSeconds: 86_400,
          user,
          mustChangePassword: false,
        }),
      );
    },
    { ...USER, role },
  );
}

/** Customers' reviews of their orders — «Отзывы», the platform admin's page. */
export const ORDER_REVIEWS = [
  {
    id: 'rev-1',
    rating: 2,
    comment: 'Латте был холодный',
    createdAt: '2026-11-06T09:30:00.000Z',
    orderId: 'order-1',
    orderCode: '1234',
    brand: { id: BRAND.id, name: BRAND.name },
    store: { id: STORE.id, name: STORE.name },
    customer: {
      id: 'user-9',
      name: 'Иван',
      email: 'ivan@example.com',
      phone: null,
      telegramUserId: '777',
      deleted: false,
    },
  },
  {
    id: 'rev-2',
    rating: 5,
    comment: null,
    createdAt: '2026-11-05T08:00:00.000Z',
    orderId: 'order-2',
    orderCode: '5678',
    brand: { id: BRAND.id, name: BRAND.name },
    store: { id: STORE.id, name: STORE.name },
    customer: { id: 'user-8', name: null, email: null, phone: null, telegramUserId: null, deleted: true },
  },
];

/** `GET /admin/order-reviews` over {@link ORDER_REVIEWS}, with its brand and rating filters. */
function orderReviewsPage(params: URLSearchParams) {
  const brandId = params.get('brandId');
  const rating = params.get('rating');
  const inScope = ORDER_REVIEWS.filter((r) => !brandId || r.brand.id === brandId);
  const items = inScope.filter((r) => !rating || r.rating === Number(rating));
  const ratingCounts = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } as Record<string, number>;
  for (const r of inScope) ratingCounts[String(r.rating)] = (ratingCounts[String(r.rating)] ?? 0) + 1;
  const stars = inScope.reduce((sum, r) => sum + r.rating, 0);
  return {
    items,
    total: items.length,
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 25),
    count: inScope.length,
    averageRating: inScope.length ? Math.round((stars / inScope.length) * 10) / 10 : null,
    ratingCounts,
  };
}

/** A takeAway promo order: 100 at the menu, −10 % that takeAway pays (docs/takeaway-promos.md). */
export const TAKEAWAY_PROMO_ORDER = {
  id: 'order-promo',
  orderCode: '1048',
  takeawayPromo: {
    code: 'HELLO10',
    name: 'Приветственный бонус',
    percent: 10,
    menuTotalCents: 10_000,
    discountCents: 1_000,
    paidByGuestCents: 9_000,
  },
};

/**
 * An order paid partly with loyalty points: 50 at the menu, 20 in points that
 * takeAway compensates to the brand, 30 by card. The list says what takeAway
 * funds (`takeawayFundedCents`); the detail does not carry the points yet.
 */
export const POINTS_ORDER = {
  id: 'order-points',
  orderCode: '1050',
  totalCents: 3_000,
  pointsCents: 2_000,
};

/** What the order detail panel reads for a reviewed order, the takeAway promo order or the points order. */
function adminOrderDetail(id: string): Record<string, unknown> {
  if (id === POINTS_ORDER.id) {
    return {
      ...adminOrderDetail('order-plain'),
      id,
      orderCode: POINTS_ORDER.orderCode,
      status: 'ACCEPTED',
      subtotalCents: 5_000,
      discountCents: POINTS_ORDER.pointsCents,
      totalCents: POINTS_ORDER.totalCents,
      refundableCents: POINTS_ORDER.totalCents,
    };
  }
  if (id === TAKEAWAY_PROMO_ORDER.id) {
    return {
      ...adminOrderDetail('order-plain'),
      id,
      orderCode: TAKEAWAY_PROMO_ORDER.orderCode,
      status: 'ACCEPTED',
      subtotalCents: 10_000,
      discountCents: 1_000,
      totalCents: 9_000,
      couponCode: 'HELLO10',
      refundableCents: 9_000,
      takeawayPromo: TAKEAWAY_PROMO_ORDER.takeawayPromo,
    };
  }
  const review = ORDER_REVIEWS.find((r) => r.orderId === id);
  return {
    id,
    orderCode: review?.orderCode ?? '0000',
    status: 'PICKED_UP',
    fulfillmentType: 'PICKUP',
    pickupMode: 'ASAP',
    pickupAt: '2026-11-06T09:15:00.000Z',
    createdAt: '2026-11-06T09:00:00.000Z',
    storeId: STORE.id,
    storeName: STORE.name,
    storeTimezone: STORE.timezone,
    customerName: 'Иван',
    customerPhone: null,
    customerEmail: null,
    notes: null,
    currency: 'MDL',
    subtotalCents: 2500,
    discountCents: 0,
    taxCents: 0,
    deliveryFeeCents: 0,
    giftCardCents: 0,
    totalCents: 2500,
    couponCode: null,
    giftCardCode: null,
    refundedCents: 0,
    refundableCents: 2500,
    items: [
      {
        id: 'item-1',
        name: PRODUCT.name,
        variations: [],
        modifierLines: [],
        notes: null,
        quantity: 1,
        unitPriceCents: 2500,
        totalCents: 2500,
      },
    ],
    payments: [],
    events: [],
  };
}

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

// ─── Options catalog («Добавки и варианты», docs/option-groups.md) ──────────

interface FakeOption {
  id: string;
  groupId: string;
  name: string;
  note: string | null;
  isDefault: boolean;
  minQty: number | null;
  maxQty: number | null;
  defaultQty: number | null;
  sortOrder: number;
}

interface FakeGroup {
  id: string;
  kind: 'VARIANT' | 'ADDON';
  type: 'A' | 'B' | 'C';
  name: string;
  minSelect: number | null;
  maxSelect: number | null;
  showIfOptionId: string | null;
  sortOrder: number;
  options: FakeOption[];
}

interface FakeSetting {
  optionId: string;
  priceCents: number;
  enabled: boolean;
  stoppedStoreIds: string[];
}

interface FakeProductGroups {
  groups: Array<{ groupId: string; sortOrder: number }>;
  overrides: Array<{ optionId: string; priceCents: number | null; isDefault: boolean | null }>;
}

function fakeOption(
  groupId: string,
  id: string,
  name: string,
  sortOrder: number,
  extra: Partial<FakeOption> = {},
): FakeOption {
  return {
    id,
    groupId,
    name,
    note: null,
    isDefault: false,
    minQty: null,
    maxQty: null,
    defaultQty: null,
    sortOrder,
    ...extra,
  };
}

/** A slice of the seed (spec §7): coffee sizes and serving, milk, syrups, sugar, ice on iced. */
function seedOptionGroups(): FakeGroup[] {
  const group = (g: Omit<FakeGroup, 'minSelect' | 'maxSelect' | 'showIfOptionId'> & Partial<FakeGroup>): FakeGroup => ({
    minSelect: null,
    maxSelect: null,
    showIfOptionId: null,
    ...g,
  });
  return [
    group({
      id: 'g-size',
      kind: 'VARIANT',
      type: 'A',
      name: 'Размер (кофе)',
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 0,
      options: [
        fakeOption('g-size', 'opt-s', 'S', 0, { note: '150–250 мл' }),
        fakeOption('g-size', 'opt-m', 'M', 1, { note: '300–350 мл', isDefault: true }),
        fakeOption('g-size', 'opt-l', 'L', 2, { note: '400–450 мл' }),
      ],
    }),
    group({
      id: 'g-serve',
      kind: 'VARIANT',
      type: 'A',
      name: 'Подача',
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 1,
      options: [
        fakeOption('g-serve', 'opt-hot', 'Горячий', 0, { isDefault: true }),
        fakeOption('g-serve', 'opt-cold', 'Холодный', 1),
      ],
    }),
    group({
      id: 'g-milk',
      kind: 'ADDON',
      type: 'A',
      name: 'Молоко',
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 2,
      options: [
        fakeOption('g-milk', 'opt-cow', 'Коровье', 0, { isDefault: true }),
        fakeOption('g-milk', 'opt-oat', 'Овсяное', 1),
      ],
    }),
    group({
      id: 'g-syrup',
      kind: 'ADDON',
      type: 'A',
      name: 'Сиропы',
      minSelect: 0,
      maxSelect: 2,
      sortOrder: 3,
      options: [fakeOption('g-syrup', 'opt-vanilla', 'Ваниль', 0), fakeOption('g-syrup', 'opt-caramel', 'Карамель', 1)],
    }),
    group({
      id: 'g-sugar',
      kind: 'ADDON',
      type: 'C',
      name: 'Сахар',
      sortOrder: 4,
      options: [fakeOption('g-sugar', 'opt-sugar', 'Сахар', 0, { minQty: 0, maxQty: 3, defaultQty: 0 })],
    }),
    group({
      id: 'g-ice',
      kind: 'ADDON',
      type: 'C',
      name: 'Лёд',
      showIfOptionId: 'opt-cold',
      sortOrder: 5,
      options: [fakeOption('g-ice', 'opt-ice', 'Лёд', 0, { minQty: 0, maxQty: 3, defaultQty: 0 })],
    }),
  ];
}

/**
 * The catalog endpoints over one in-memory state per browser context, so a
 * suite sees what it created: SUPER_ADMIN's groups and options, the brand's
 * prices, switches and store stops, a product's attached groups and the
 * brand's old options. Answers null for a path it does not own.
 */
function optionsCatalog() {
  const groups = seedOptionGroups();
  const settings = new Map<string, FakeSetting>([
    ['opt-oat', { optionId: 'opt-oat', priceCents: 1000, enabled: true, stoppedStoreIds: [] }],
  ]);
  const products = new Map<string, FakeProductGroups>();
  let legacy = { products: 1, variations: 0, modifiers: 1, categoryOptions: 0, ingredients: 1 };
  let nextId = 1;

  const productCount = (groupId: string) =>
    [...products.values()].filter((c) => c.groups.some((g) => g.groupId === groupId)).length;
  const listed = () => groups.map((g) => ({ ...g, productCount: productCount(g.id) }));
  const findOption = (id: string) => groups.flatMap((g) => g.options).find((o) => o.id === id);
  const setting = (optionId: string): FakeSetting =>
    settings.get(optionId) ?? { optionId, priceCents: 0, enabled: true, stoppedStoreIds: [] };

  return async (route: Route, path: string): Promise<void | null> => {
    const method = route.request().method();
    const body = () => (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    let m: RegExpExecArray | null;

    if (path === '/admin/option-groups') {
      if (method === 'POST') {
        const created: FakeGroup = {
          minSelect: null,
          maxSelect: null,
          showIfOptionId: null,
          sortOrder: groups.length,
          ...(body() as Partial<FakeGroup>),
          id: `g-new-${nextId++}`,
          options: [],
        } as FakeGroup;
        groups.push(created);
        return json(route, { ...created, productCount: 0 }, 201);
      }
      return json(route, listed());
    }
    if ((m = /^\/admin\/option-groups\/([^/]+)\/options$/.exec(path)) && method === 'POST') {
      const group = groups.find((g) => g.id === m?.[1]);
      if (!group) return json(route, { statusCode: 404, message: 'Not found' }, 404);
      const created = fakeOption(
        group.id,
        `opt-new-${nextId++}`,
        '',
        group.options.length,
        body() as Partial<FakeOption>,
      );
      group.options.push(created);
      return json(route, created, 201);
    }
    if ((m = /^\/admin\/option-groups\/([^/]+)$/.exec(path))) {
      const index = groups.findIndex((g) => g.id === m?.[1]);
      const group = groups[index];
      if (!group) return json(route, { statusCode: 404, message: 'Not found' }, 404);
      if (method === 'DELETE') {
        if (productCount(group.id) > 0) {
          return json(
            route,
            {
              statusCode: 409,
              error: 'Conflict',
              code: 'OPTION_GROUP_IN_USE',
              message: 'The group is attached to products',
            },
            409,
          );
        }
        groups.splice(index, 1);
        return route.fulfill({ status: 204 });
      }
      Object.assign(group, body());
      return json(route, { ...group, productCount: productCount(group.id) });
    }
    if ((m = /^\/admin\/option-items\/([^/]+)$/.exec(path))) {
      const option = findOption(m[1] ?? '');
      const group = groups.find((g) => g.id === option?.groupId);
      if (!option || !group) return json(route, { statusCode: 404, message: 'Not found' }, 404);
      if (method === 'DELETE') {
        group.options = group.options.filter((o) => o.id !== option.id);
        return route.fulfill({ status: 204 });
      }
      Object.assign(option, body());
      return json(route, option);
    }
    if (/^\/admin\/brands\/[^/]+\/options$/.test(path)) {
      return json(route, { groups: listed(), settings: [...settings.values()] });
    }
    if ((m = /^\/admin\/brands\/[^/]+\/options\/([^/]+)$/.exec(path)) && method === 'PATCH') {
      const optionId = m[1] ?? '';
      const next = { ...setting(optionId), ...(body() as Partial<FakeSetting>) };
      settings.set(optionId, next);
      return json(route, next);
    }
    if ((m = /^\/admin\/stores\/([^/]+)\/option-stops\/([^/]+)$/.exec(path))) {
      const storeId = m[1] ?? '';
      const optionId = m[2] ?? '';
      const current = setting(optionId);
      const others = current.stoppedStoreIds.filter((id) => id !== storeId);
      if (method === 'DELETE') {
        settings.set(optionId, { ...current, stoppedStoreIds: others });
        return route.fulfill({ status: 204 });
      }
      settings.set(optionId, { ...current, stoppedStoreIds: [...others, storeId] });
      return json(route, { expiresAt: (body()['expiresAt'] as string | null | undefined) ?? null });
    }
    if ((m = /^\/admin\/products\/([^/]+)\/option-groups$/.exec(path))) {
      const productId = m[1] ?? '';
      if (method === 'PUT') {
        const config = body() as unknown as FakeProductGroups;
        products.set(productId, config);
        return json(route, config);
      }
      return json(route, products.get(productId) ?? { groups: [], overrides: [] });
    }
    if (/^\/admin\/brands\/[^/]+\/legacy-options$/.test(path)) return json(route, legacy);
    if (/^\/admin\/brands\/[^/]+\/legacy-options\/clear$/.test(path) && method === 'POST') {
      const deleted = legacy;
      legacy = { products: 0, variations: 0, modifiers: 0, categoryOptions: 0, ingredients: 0 };
      return json(route, deleted);
    }
    return null;
  };
}

// ─── «Акции takeAway» and settlements (docs/settlements.md) ──────────────────

/**
 * A week of settlements (since 2026-11-14 guests pay the brand directly): a
 * takeAway promo order — 90 by card + 10 takeAway compensates — and a points
 * order — 30 by card + 20 in points. Commission 15 % of the full 150 is 22,50,
 * compensation 30: takeAway owes the brand 7,50.
 */
function settlementTotals() {
  return {
    orders: 2,
    cardOrders: 2,
    zeroTotalOrders: 0,
    unpaidOrders: 0,
    unpaidTotalCents: 0,
    salesCents: 15_000,
    promoDiscountCents: 0,
    pointsDiscountCents: 2_000,
    giftCardCents: 0,
    deliveryFeeCents: 0,
    capturedCents: 12_000,
    refundedCents: 0,
    cardNetCents: 12_000,
    takeawayCompensationCents: 1_000,
    pointsCompensationCents: 2_000,
    compensationCents: 3_000,
    commissionBaseCents: 15_000,
    commissionCents: 2_250,
    netCents: -750,
  };
}

/** What every period before the one on screen left: the brand was owed 12,00. */
const SETTLED_BEFORE_CENTS = -1_200;

type FakeSettlementStatus = 'PENDING' | 'PAID' | 'CONFIRMED' | 'DISPUTED';
type FakeDirection = 'BRAND_TO_TAKEAWAY' | 'TAKEAWAY_TO_BRAND';

interface FakeSettlement {
  id: string;
  brandId: string;
  currency: string;
  periodFrom: string;
  periodTo: string;
  timeZone: string;
  direction: FakeDirection;
  amountCents: number;
  cardNetCents: number;
  commissionCents: number;
  compensationCents: number;
  pointsCompensationCents: number;
  status: FakeSettlementStatus;
  paidAt: string | null;
  confirmedAt: string | null;
  disputedAt: string | null;
  disputeComment: string | null;
  reference: string | null;
  comment: string | null;
  createdAt: string;
}

/** The earlier settlement: takeAway paid the brand 12,00 for 26.10–01.11, and the brand has yet to confirm it. */
export const EARLIER_SETTLEMENT: FakeSettlement = {
  id: 'settlement-1',
  brandId: BRAND.id,
  currency: 'RUP',
  periodFrom: '2026-10-26',
  periodTo: '2026-11-01',
  timeZone: STORE.timezone,
  direction: 'TAKEAWAY_TO_BRAND',
  amountCents: 1_200,
  cardNetCents: 16_000,
  commissionCents: 3_000,
  compensationCents: 3_000,
  pointsCompensationCents: 1_200,
  status: 'PAID',
  paidAt: '2026-11-03T09:00:00.000Z',
  confirmedAt: null,
  disputedAt: null,
  disputeComment: null,
  reference: 'ПП-31',
  comment: null,
  createdAt: '2026-11-02T09:00:00.000Z',
};

/** Positive — the brand pays takeAway. */
const signedOf = (s: FakeSettlement) => (s.direction === 'BRAND_TO_TAKEAWAY' ? s.amountCents : -s.amountCents);
const sum = (list: FakeSettlement[]) => list.reduce((total, s) => total + signedOf(s), 0);

/**
 * `/admin/settlements` and its settlement routes over one in-memory list per
 * browser context, with the API's rules kept simple: a new settlement takes
 * the balance not fixed yet, the payer marks it paid, the receiver confirms
 * it or says it did not arrive, only the latest pending one can be removed.
 * Answers null for a path it does not own.
 */
function settlements() {
  const list: FakeSettlement[] = [{ ...EARLIER_SETTLEMENT }];
  let nextId = 2;

  const report = (params: URLSearchParams) => {
    const from = params.get('from') ?? '2026-11-02';
    const to = params.get('to') ?? '2026-11-08';
    const totals = settlementTotals();
    const confirmed = (s: FakeSettlement) => s.status === 'CONFIRMED';
    const inPeriod = (s: FakeSettlement) => s.periodTo >= from && s.periodTo <= to;
    const before = (s: FakeSettlement) => s.periodTo < from;
    const opening = SETTLED_BEFORE_CENTS - sum(list.filter((s) => before(s) && confirmed(s)));
    const settled = sum(list.filter((s) => inPeriod(s) && confirmed(s)));
    const last = list.reduce<FakeSettlement | null>((l, s) => (!l || s.periodTo > l.periodTo ? s : l), null);
    const net = SETTLED_BEFORE_CENTS + totals.netCents - sum(list);
    return {
      brand: { id: BRAND.id, name: BRAND.name, plan: 'PRO', currentBps: 1500, planBps: 1500 },
      currency: 'RUP',
      currencies: ['RUP'],
      period: { from, to, days: 7, timeZone: STORE.timezone },
      totals,
      days: [{ date: from, ...totals }],
      rates: [{ bps: 1500, source: 'PLAN', from, to }],
      balance: {
        openingCents: opening,
        netCents: totals.netCents,
        settledCents: settled,
        openCents: sum(list.filter((s) => inPeriod(s) && !confirmed(s))),
        closingCents: opening + totals.netCents - settled,
        closingOpenCents: sum(list.filter((s) => (before(s) || inPeriod(s)) && !confirmed(s))),
      },
      nextPayout: {
        periodFrom: last ? dayAfter(last.periodTo) : from,
        periodTo: to,
        direction: net > 0 ? 'BRAND_TO_TAKEAWAY' : net < 0 ? 'TAKEAWAY_TO_BRAND' : null,
        amountCents: Math.abs(net),
        netCents: net,
        cardNetCents: totals.cardNetCents,
        commissionCents: totals.commissionCents,
        compensationCents: totals.takeawayCompensationCents,
        pointsCompensationCents: totals.pointsCompensationCents,
        blocked: last && to <= last.periodTo ? 'OVERLAP' : net === 0 ? 'NOTHING_DUE' : null,
        lastSettledDay: last?.periodTo ?? null,
      },
      // Newest period first.
      payouts: [...list].sort((a, b) => b.periodTo.localeCompare(a.periodTo)),
    };
  };

  return async (route: Route, path: string, params: URLSearchParams): Promise<void | null> => {
    const method = route.request().method();
    const body = () => (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    const refuse = (code: string, status = 409) =>
      json(route, { statusCode: status, error: 'Conflict', code, message: code }, status);
    let m: RegExpExecArray | null;

    if (path === '/admin/settlements') return json(route, report(params));
    if (path === '/admin/settlements/payouts' && method === 'POST') {
      const input = body();
      const preview = report(new URLSearchParams({ to: String(input['to'] ?? '') })).nextPayout;
      if (preview.blocked || !preview.direction) return refuse(`PAYOUT_${preview.blocked ?? 'NOTHING_DUE'}`);
      const created: FakeSettlement = {
        id: `settlement-${nextId++}`,
        brandId: BRAND.id,
        currency: 'RUP',
        periodFrom: preview.periodFrom,
        periodTo: preview.periodTo,
        timeZone: STORE.timezone,
        direction: preview.direction as FakeDirection,
        amountCents: preview.amountCents,
        cardNetCents: preview.cardNetCents,
        commissionCents: preview.commissionCents,
        compensationCents: preview.compensationCents,
        pointsCompensationCents: preview.pointsCompensationCents,
        status: 'PENDING',
        paidAt: null,
        confirmedAt: null,
        disputedAt: null,
        disputeComment: null,
        reference: typeof input['reference'] === 'string' ? input['reference'] : null,
        comment: typeof input['comment'] === 'string' ? input['comment'] : null,
        createdAt: new Date().toISOString(),
      };
      list.push(created);
      return json(route, created, 201);
    }
    if ((m = /^\/admin\/settlements\/payouts\/([^/]+)\/paid$/.exec(path)) && method === 'PATCH') {
      const found = list.find((s) => s.id === m?.[1]);
      if (!found) return json(route, { statusCode: 404, message: 'Payout not found' }, 404);
      if (found.status !== 'PENDING' && found.status !== 'DISPUTED') return refuse('PAYOUT_STATUS');
      const input = body();
      Object.assign(found, {
        status: 'PAID',
        paidAt: new Date().toISOString(),
        disputedAt: null,
        disputeComment: null,
        ...(typeof input['reference'] === 'string' ? { reference: input['reference'] } : {}),
      });
      return json(route, found);
    }
    if ((m = /^\/admin\/settlements\/payouts\/([^/]+)\/confirm$/.exec(path)) && method === 'PATCH') {
      const found = list.find((s) => s.id === m?.[1]);
      if (!found) return json(route, { statusCode: 404, message: 'Payout not found' }, 404);
      const input = body();
      if (input['received'] === true) {
        if (found.status === 'CONFIRMED') return refuse('PAYOUT_STATUS');
        Object.assign(found, { status: 'CONFIRMED', confirmedAt: new Date().toISOString() });
      } else {
        if (found.status !== 'PAID') return refuse('PAYOUT_STATUS');
        Object.assign(found, {
          status: 'DISPUTED',
          disputedAt: new Date().toISOString(),
          disputeComment: typeof input['comment'] === 'string' ? input['comment'] : null,
        });
      }
      return json(route, found);
    }
    if ((m = /^\/admin\/settlements\/payouts\/([^/]+)$/.exec(path)) && method === 'DELETE') {
      const index = list.findIndex((s) => s.id === m?.[1]);
      if (index < 0) return json(route, { statusCode: 404, message: 'Payout not found' }, 404);
      if (list[index]?.status !== 'PENDING') return refuse('PAYOUT_PAID');
      list.splice(index, 1);
      return route.fulfill({ status: 204 });
    }
    return null;
  };
}

/** `YYYY-MM-DD` of the next calendar day. */
function dayAfter(day: string): string {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function brandTakeawayPromos(params: URLSearchParams) {
  const from = params.get('from') ?? '2026-11-02';
  return {
    brandId: BRAND.id,
    currency: 'RUP',
    period: { from, to: params.get('to') ?? from, timeZone: STORE.timezone },
    orders: 1,
    menuTotalCents: 10_000,
    paidByGuestCents: 9_000,
    compensationAccruedCents: 1_000,
    compensationRepaidCents: 0,
    currentDebtCents: 1_000,
    items: [
      {
        orderId: TAKEAWAY_PROMO_ORDER.id,
        orderCode: TAKEAWAY_PROMO_ORDER.orderCode,
        storeId: STORE.id,
        storeName: STORE.name,
        settledAt: `${from}T10:04:00.000Z`,
        promoName: 'Приветственный',
        percent: 10,
        menuTotalCents: 10_000,
        paidByGuestCents: 9_000,
        compensationCents: 1_000,
        status: 'ACCRUED',
        payoutId: null,
        repaidAt: null,
      },
    ],
  };
}

const COMMISSION_HISTORY = {
  brandId: BRAND.id,
  plan: 'PRO',
  planBps: 1500,
  currentBps: 1500,
  timeZone: STORE.timezone,
  rates: [],
};

interface FakeTakeawayPromo {
  id: string;
  name: string;
  code: string;
  percent: number;
  startsAt: string;
  endsAt: string;
  currency: string;
  budgetCents: number;
  spentCents: number;
  leftCents: number;
  status: 'ACTIVE' | 'DISABLED' | 'EXHAUSTED';
  effectiveStatus: string;
  isWelcome: boolean;
  redemptionsCount: number;
  editable: boolean;
  createdAt: string;
}

/**
 * `/admin/takeaway-promos` over one in-memory list per browser context, with
 * the API's code rule: a code a brand promo already has (NONAME10 here) is
 * refused with TAKEAWAY_PROMO_CODE_TAKEN. Answers null for a path it does not own.
 */
function takeawayPromos() {
  const promos: FakeTakeawayPromo[] = [
    {
      id: 'tp-autumn',
      name: 'Осенняя',
      code: 'AUTUMN15',
      percent: 15,
      startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2026-10-31T21:00:00.000Z',
      currency: 'RUP',
      budgetCents: 100_000,
      spentCents: 100_000,
      leftCents: 0,
      status: 'EXHAUSTED',
      effectiveStatus: 'EXHAUSTED',
      isWelcome: false,
      redemptionsCount: 64,
      editable: false,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ];
  const brandCodes = ['NONAME10'];
  let nextId = 1;

  return async (route: Route, path: string): Promise<void | null> => {
    const method = route.request().method();
    const body = () => (route.request().postDataJSON() ?? {}) as Partial<FakeTakeawayPromo>;
    let m: RegExpExecArray | null;

    if (path === '/admin/takeaway-promos/debt') {
      return json(route, {
        rows: [
          {
            brandId: BRAND.id,
            brandName: BRAND.name,
            currency: 'RUP',
            accruedCents: 101_000,
            inPayoutCents: 0,
            repaidCents: 100_000,
            debtCents: 1_000,
          },
        ],
        totals: [{ currency: 'RUP', accruedCents: 101_000, repaidCents: 100_000, inPayoutCents: 0, debtCents: 1_000 }],
      });
    }
    if (path === '/admin/takeaway-promos') {
      if (method === 'POST') {
        const input = body();
        const code = String(input.code ?? '').toUpperCase();
        if (brandCodes.includes(code) || promos.some((p) => p.code === code)) {
          return json(
            route,
            { statusCode: 409, error: 'Conflict', code: 'TAKEAWAY_PROMO_CODE_TAKEN', message: 'The code is taken' },
            409,
          );
        }
        const budgetCents = Number(input.budgetCents ?? 0);
        const created: FakeTakeawayPromo = {
          id: `tp-new-${nextId++}`,
          name: String(input.name ?? ''),
          code,
          percent: Number(input.percent ?? 0),
          startsAt: String(input.startsAt ?? ''),
          endsAt: String(input.endsAt ?? ''),
          currency: String(input.currency ?? 'RUP'),
          budgetCents,
          spentCents: 0,
          leftCents: budgetCents,
          status: 'ACTIVE',
          effectiveStatus: 'ACTIVE',
          isWelcome: Boolean(input.isWelcome),
          redemptionsCount: 0,
          editable: true,
          createdAt: new Date().toISOString(),
        };
        promos.unshift(created);
        return json(route, created, 201);
      }
      return json(route, promos);
    }
    if ((m = /^\/admin\/takeaway-promos\/([^/]+)\/status$/.exec(path)) && method === 'PATCH') {
      const promo = promos.find((p) => p.id === m?.[1]);
      if (!promo) return json(route, { statusCode: 404, message: 'Not found' }, 404);
      const status = (body() as { status?: 'ACTIVE' | 'DISABLED' }).status ?? 'DISABLED';
      Object.assign(promo, { status, effectiveStatus: status });
      return json(route, promo);
    }
    if ((m = /^\/admin\/takeaway-promos\/([^/]+)\/report$/.exec(path))) {
      const promo = promos.find((p) => p.id === m?.[1]);
      if (!promo) return json(route, { statusCode: 404, message: 'Not found' }, 404);
      return json(route, {
        promo,
        orders: 0,
        customers: 0,
        menuTotalCents: 0,
        discountCents: 0,
        byBrand: [],
        byStore: [],
        byDay: [],
      });
    }
    if ((m = /^\/admin\/takeaway-promos\/([^/]+)$/.exec(path))) {
      const promo = promos.find((p) => p.id === m?.[1]);
      if (!promo) return json(route, { statusCode: 404, message: 'Not found' }, 404);
      if (method === 'PATCH') {
        Object.assign(promo, body());
        promo.leftCents = promo.budgetCents - promo.spentCents;
      }
      return json(route, promo);
    }
    return null;
  };
}

/** `role` must match the one {@link signIn} used: `/auth/me` answers with it. */
export async function installFakeApi(context: BrowserContext, role: FakeRole = 'SUPER_ADMIN'): Promise<void> {
  const options = optionsCatalog();
  const promos = takeawayPromos();
  const settled = settlements();
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');

    const handled = await options(route, path);
    if (handled !== null) return handled;
    const promoHandled = await promos(route, path);
    if (promoHandled !== null) return promoHandled;

    const settlementHandled = await settled(route, path, url.searchParams);
    if (settlementHandled !== null) return settlementHandled;
    if (path === '/admin/settlements/rates') return json(route, COMMISSION_HISTORY);
    if (path === '/admin/settlements/takeaway-promos') return json(route, brandTakeawayPromos(url.searchParams));

    if (path === '/config/features') {
      return json(route, {
        deliveryEnabled: true,
        loyaltyEnabled: true,
        giftCardsEnabled: true,
        campaignsEnabled: true,
        posIntegrationsEnabled: true,
      });
    }
    if (path === '/auth/me') return json(route, { ...USER, role });
    // «Забыли пароль?»: a server with the Telegram bot and no SMTP yet — production today.
    if (path === '/auth/password/forgot') return json(route, { channels: ['telegram'], linkTtlMinutes: 60 });
    if (path === '/auth/password/reset') return route.fulfill({ status: 204 });

    if (path === '/admin/brands' || path === '/admin/brands/mine') return json(route, [BRAND]);
    if (path === '/my-brand') return json(route, BRAND);

    if (path === '/admin/stores') return json(route, [STORE]);
    if (/^\/admin\/stores\/[^/]+$/.test(path)) return json(route, STORE);
    if (/^\/admin\/stores\/[^/]+\/availability$/.test(path)) return json(route, AVAILABILITY);
    if (/^\/admin\/stores\/[^/]+\/stop-list$/.test(path) && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { productId: string; expiresAt?: string };
      return json(route, { id: 'stop-1', storeId: STORE.id, reason: null, expiresAt: null, ...body }, 201);
    }
    if (/^\/admin\/stores\/[^/]+\/(stop-list|ingredient-stops)\/[^/]+$/.test(path)) {
      if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 });
      return json(route, { expiresAt: null });
    }
    if (path === '/admin/staff') return json(route, [STAFF_MEMBER]);
    if (/^\/admin\/staff\/[^/]+$/.test(path)) return json(route, STAFF_MEMBER);
    if (path.endsWith('/staff')) return json(route, [STAFF]);
    if (path.endsWith('/owner')) return json(route, null);

    if (path === '/admin/categories') return json(route, [CATEGORY]);
    if (path === '/admin/products') return json(route, [PRODUCT]);
    if (path === '/admin/products/stores') return json(route, [{ id: STORE.id, name: STORE.name, status: 'OPEN' }]);
    if (/^\/admin\/products\/[^/]+$/.test(path)) return json(route, { ...PRODUCT, variations: [], modifiers: [] });

    if (path === '/admin/ingredients') return json(route, [OAT_MILK]);
    if (/^\/admin\/ingredients\/[^/]+$/.test(path) && route.request().method() === 'PATCH') {
      return json(route, { ...OAT_MILK, ...(route.request().postDataJSON() as object) });
    }

    if (path === '/admin/analytics/overview') return json(route, BUSINESS_OVERVIEW);
    if (path === '/admin/analytics/churn') return json(route, CHURN);
    if (path === '/admin/platform/overview') return json(route, PLATFORM_OVERVIEW);
    if (path === '/admin/analytics/order-statuses') {
      return json(route, {
        days: 7,
        live: { CREATED: 0, PAID: 1, ACCEPTED: 0, IN_PROGRESS: 1, READY: 0, OUT_FOR_DELIVERY: 0 },
        liveTotal: 2,
        period: { total: 4, completed: 3, cancelled: 1, expired: 0, completionRatePercent: 75, byStatus: {} },
      });
    }
    if (path === '/admin/orders') return json(route, []);
    if (/^\/admin\/orders\/[^/]+$/.test(path)) return json(route, adminOrderDetail(path.split('/').pop() ?? ''));
    if (path === '/admin/order-reviews') {
      return json(route, orderReviewsPage(new URL(route.request().url()).searchParams));
    }
    if (path.startsWith('/admin/pos/status')) return json(route, { connections: [] });

    // Every remaining list endpoint answers empty rather than hanging.
    return json(route, []);
  });
}
