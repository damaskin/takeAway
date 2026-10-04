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
  caffeineLevel: null,
  calories: null,
  proteinsGrams: null,
  fatsGrams: null,
  carbsGrams: null,
  allergens: [],
  dietTags: [],
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

const USER = {
  id: 'user-1',
  email: 'owner@takeaway.md',
  name: 'Sam',
  role: 'SUPER_ADMIN',
  locale: 'RU',
  phone: null,
  currency: 'MDL',
  telegramUserId: null,
};

/** One add-in of the library, used by the latte. */
export const OAT_MILK = {
  id: 'ing-oat',
  brandId: BRAND.id,
  name: 'Овсяное молоко',
  isAvailable: true,
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
};

const PERIOD = {
  from: '2026-09-28',
  to: '2026-10-04',
  days: 7,
  timeZone: 'Europe/Chisinau',
  previousFrom: '2026-09-21',
  previousTo: '2026-09-27',
};

function totals(revenueCents: number, orders: number) {
  return {
    revenueCents,
    orders,
    placed: orders + 2,
    customers: Math.round(orders * 0.8),
    newCustomers: Math.round(orders * 0.2),
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
export async function signIn(context: BrowserContext): Promise<void> {
  await context.addInitScript((user) => {
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
  }, USER);
}

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

export async function installFakeApi(context: BrowserContext): Promise<void> {
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');

    if (path === '/config/features') {
      return json(route, {
        deliveryEnabled: true,
        loyaltyEnabled: true,
        giftCardsEnabled: true,
        campaignsEnabled: true,
        posIntegrationsEnabled: true,
      });
    }
    if (path === '/auth/me') return json(route, USER);

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
    if (path === '/admin/platform/overview') return json(route, PLATFORM_OVERVIEW);
    if (path === '/admin/analytics/order-statuses') {
      return json(route, {
        days: 7,
        live: { CREATED: 0, PAID: 1, ACCEPTED: 0, IN_PROGRESS: 1, READY: 0, OUT_FOR_DELIVERY: 0 },
        liveTotal: 2,
        period: { total: 4, completed: 3, cancelled: 1, expired: 0, completionRatePercent: 75, byStatus: {} },
      });
    }
    if (path.startsWith('/admin/orders')) return json(route, { items: [], total: 0 });
    if (path.startsWith('/admin/pos/status')) return json(route, { connections: [] });

    // Every remaining list endpoint answers empty rather than hanging.
    return json(route, []);
  });
}
