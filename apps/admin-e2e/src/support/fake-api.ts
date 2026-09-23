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
    if (path.endsWith('/staff')) return json(route, [STAFF]);
    if (path.endsWith('/owner')) return json(route, null);

    if (path === '/admin/categories') return json(route, [CATEGORY]);
    if (path === '/admin/products') return json(route, [PRODUCT]);
    if (/^\/admin\/products\/[^/]+$/.test(path)) return json(route, { ...PRODUCT, variations: [], modifiers: [] });

    if (path === '/admin/analytics/summary') {
      return json(route, {
        days: 7,
        revenueCents: 12_500,
        orders: 4,
        avgPickupSeconds: 0,
        nps: null,
        revenueDeltaPercent: null,
        ordersDeltaPercent: null,
        pickupDeltaSeconds: null,
      });
    }
    if (path.startsWith('/admin/orders')) return json(route, { items: [], total: 0 });
    if (path.startsWith('/admin/pos/status')) return json(route, { connections: [] });

    // Every remaining list endpoint answers empty rather than hanging.
    return json(route, []);
  });
}
