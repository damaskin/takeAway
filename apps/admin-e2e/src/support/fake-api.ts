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

/** What the order detail panel reads for a reviewed order. */
function adminOrderDetail(id: string) {
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

/** `role` must match the one {@link signIn} used: `/auth/me` answers with it. */
export async function installFakeApi(context: BrowserContext, role: FakeRole = 'SUPER_ADMIN'): Promise<void> {
  const options = optionsCatalog();
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');

    const handled = await options(route, path);
    if (handled !== null) return handled;

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
