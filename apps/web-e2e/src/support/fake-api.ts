import type { Page, Route } from '@playwright/test';

/**
 * A small in-memory stand-in for the API, wired through Playwright's route
 * interception.
 *
 * The point is to exercise the *customer journey* — catalogue, cart,
 * pickup slots, totals, order status — deterministically, in CI, without a
 * Postgres and a Redis. It is not a contract test: the shapes here are
 * hand-kept in step with the DTOs, and a change there will show up as a
 * failing journey rather than a silent pass.
 *
 * It carries real state between calls, so adding to the cart genuinely
 * changes the total the checkout renders. A pile of static fixtures would
 * pass while the app quietly failed to wire two screens together.
 */

export const STORE = {
  id: 'store-1',
  brandId: 'brand-1',
  slug: 'dubai-marina',
  name: 'takeAway Marina',
  addressLine: 'Marina Walk',
  city: 'Dubai',
  country: 'AE',
  latitude: 25.078,
  longitude: 55.141,
  status: 'OPEN',
  fulfillmentTypes: ['TAKEAWAY'],
  pickupPointType: 'SHELF',
  busyMeter: 20,
  currentEtaSeconds: 420,
  // 5% VAT already inside the price, as in the UAE.
  taxRateBps: 500,
  taxIncludedInPrice: true,
  currency: 'AED',
  heroImageUrl: null,
  distanceMeters: null,
  timezone: 'Asia/Dubai',
  phone: null,
  email: null,
  minOrderCents: 0,
  galleryUrls: [],
  workingHours: [],
  brand: { id: 'brand-1', slug: 'takeaway', name: 'takeAway', logoUrl: null, themeOverrides: null },
};

/**
 * Shaped to `ProductDetail` in @takeaway/shared-types. Every array field is
 * present even when empty: the product template reads `.length` on
 * allergens and modifiers, and an omitted key throws during change
 * detection rather than rendering an empty section.
 */
export const PRODUCT = {
  id: 'product-1',
  categoryId: 'cat-1',
  slug: 'flat-white',
  name: 'Flat White',
  description: 'Double ristretto, steamed milk.',
  basePriceCents: 1800,
  prepTimeSeconds: 120,
  caffeineLevel: 2,
  calories: 120,
  proteinsGrams: 6,
  fatsGrams: 5,
  carbsGrams: 9,
  allergens: [],
  dietTags: [],
  imageUrls: [],
  sortOrder: 0,
  onStopList: false,
  variations: [],
  modifiers: [],
};

interface CartItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  unitPrepSeconds: number;
  variationIds: string[];
  modifiers: Record<string, number>;
  notes: string | null;
}

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Next four quarter-hour slots, the first one already full. */
function slots(): unknown[] {
  const SLOT_MS = 15 * 60 * 1000;
  const start = Math.ceil(Date.now() / SLOT_MS) * SLOT_MS;
  return Array.from({ length: 4 }, (_, i) => ({
    startsAt: new Date(start + i * SLOT_MS).toISOString(),
    endsAt: new Date(start + (i + 1) * SLOT_MS).toISOString(),
    taken: i === 0 ? 8 : 1,
    capacity: 8,
    available: i !== 0,
  }));
}

export interface FakeApi {
  /** Orders the app has created, newest last. */
  readonly orders: Array<Record<string, unknown>>;
}

/**
 * Installs the fake API on a page and returns a handle to inspect what the
 * app actually sent — asserting on the created order is how a journey test
 * proves the checkout passed the right slot and totals through.
 */
export async function installFakeApi(page: Page, opts: { pointsBalance?: number } = {}): Promise<FakeApi> {
  const items: CartItem[] = [];
  const orders: Array<Record<string, unknown>> = [];
  let nextId = 1;

  const cart = () => {
    const subtotalCents = items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
    const longestPrep = items.reduce((max, i) => Math.max(max, i.unitPrepSeconds), 0);
    return {
      id: 'cart-1',
      storeId: STORE.id,
      currency: STORE.currency,
      subtotalCents,
      // Mirrors the server: store overhead plus the longest single item.
      etaSeconds: items.length === 0 ? 0 : 420 + longestPrep,
      items: items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productName: i.productName,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        totalCents: i.unitPriceCents * i.quantity,
        variationIds: i.variationIds,
        modifiers: i.modifiers,
        notes: i.notes,
      })),
    };
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = request.method();

    // ── Auth ────────────────────────────────────────────────────────────
    if (path === '/auth/me') {
      return json(route, {
        id: 'user-1',
        phone: null,
        email: 'sam@example.com',
        name: 'Sam',
        locale: 'EN',
        currency: 'AED',
        role: 'CUSTOMER',
        telegramUserId: null,
      });
    }

    // ── Catalogue ───────────────────────────────────────────────────────
    if (path === '/stores') return json(route, [STORE]);
    if (path.match(/^\/stores\/[^/]+\/pickup-slots$/)) return json(route, slots());
    if (path.match(/^\/stores\/[^/]+\/menu$/)) {
      return json(route, {
        storeId: STORE.id,
        storeSlug: STORE.slug,
        categories: [
          {
            id: 'cat-1',
            slug: 'coffee',
            name: 'Coffee',
            description: null,
            iconUrl: null,
            sortOrder: 0,
            availableFrom: null,
            availableTo: null,
            products: [PRODUCT],
          },
        ],
      });
    }
    if (path.match(/^\/stores\/[^/]+$/)) return json(route, STORE);
    if (path.match(/^\/products\/[^/]+$/)) return json(route, PRODUCT);

    // ── Loyalty ─────────────────────────────────────────────────────────
    if (path === '/loyalty/me') {
      return json(route, {
        userId: 'user-1',
        pointsBalance: opts.pointsBalance ?? 0,
        lifetimePoints: opts.pointsBalance ?? 0,
        tier: 'SILVER',
        nextTier: 'GOLD',
        pointsToNextTier: 1500,
        tierProgressPercent: 0,
        recent: [],
      });
    }
    if (path === '/loyalty/redeem/quote') {
      const body = request.postDataJSON() as { points: number; payableCents: number };
      const affordable = Math.min(body.points, opts.pointsBalance ?? 0, body.payableCents);
      const points = affordable >= 100 ? Math.floor(affordable) : 0;
      return json(route, {
        points,
        discountCents: points,
        balance: opts.pointsBalance ?? 0,
        pointValueCents: 1,
        minPoints: 100,
      });
    }

    // ── Cart ────────────────────────────────────────────────────────────
    if (path === '/cart' && method === 'GET') return json(route, cart());
    if (path === '/cart/items' && method === 'POST') {
      const body = request.postDataJSON() as { productId: string; quantity: number };
      items.push({
        id: `item-${nextId++}`,
        productId: body.productId,
        productName: PRODUCT.name,
        quantity: body.quantity ?? 1,
        unitPriceCents: PRODUCT.basePriceCents,
        unitPrepSeconds: PRODUCT.prepTimeSeconds,
        variationIds: [],
        modifiers: {},
        notes: null,
      });
      return json(route, cart());
    }

    // ── Orders ──────────────────────────────────────────────────────────
    if (path === '/orders' && method === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      const subtotalCents = cart().subtotalCents;
      const order = {
        id: 'order-1',
        orderCode: '4832',
        status: 'CREATED',
        fulfillmentType: body['fulfillmentType'] ?? 'PICKUP',
        pickupMode: body['pickupMode'] ?? 'ASAP',
        pickupAt: (body['pickupAt'] as string) ?? new Date(Date.now() + 8 * 60_000).toISOString(),
        storeId: STORE.id,
        storeName: STORE.name,
        currency: STORE.currency,
        subtotalCents,
        discountCents: 0,
        taxCents: Math.round((subtotalCents * 500) / 10_500),
        deliveryFeeCents: 0,
        giftCardCents: 0,
        totalCents: subtotalCents,
        qrToken: 'qr-token',
        etaSeconds: 480,
        items: cart().items,
        createdAt: new Date().toISOString(),
        // Echoed so the test can assert what checkout actually sent.
        _request: body,
      };
      orders.push(order);
      items.length = 0;
      return json(route, order, 201);
    }
    if (path.match(/^\/orders\/[^/]+$/) && method === 'GET') {
      return json(route, orders[orders.length - 1] ?? {}, orders.length > 0 ? 200 : 404);
    }
    if (path.startsWith('/me/orders')) return json(route, orders);

    // Anything unmapped answers empty rather than hanging the page.
    return json(route, {});
  });

  return { orders };
}
