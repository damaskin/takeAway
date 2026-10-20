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
  // A shift is running: without one the store is shown closed, with no menu.
  acceptingOrders: true,
  fulfillmentTypes: ['TAKEAWAY'],
  pickupPointType: 'SHELF',
  busyMeter: 20,
  currentEtaSeconds: 420,
  openNow: true,
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
  // The product page matches this against the stores it lists to find one
  // that can actually make the item — `STORE.brandId` has to agree.
  brandId: 'brand-1',
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

/**
 * Something to eat from the same brand, in a bakery category. Only on the
 * menu when a test asks for kinds (`menuKinds`): the menu of an API without
 * them stays the one-category menu the other journeys were written against.
 */
export const CROISSANT = {
  ...PRODUCT,
  id: 'product-2',
  categoryId: 'cat-2',
  slug: 'croissant',
  name: 'Croissant',
  description: 'Butter croissant.',
  basePriceCents: 1200,
  caffeineLevel: null,
  categoryKind: 'BAKERY',
};

/** A product as the fake serves it: what the cart prices, plus whatever else the detail carries. */
export interface FakeProduct {
  id: string;
  slug: string;
  name: string;
  basePriceCents: number;
  prepTimeSeconds: number;
  variations: Array<{ id: string; priceDeltaCents: number }>;
  modifiers: Array<{ id: string; priceDeltaCents: number }>;
  [field: string]: unknown;
}

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
  /** Orders the app has created, newest last. `GET /orders/:id` answers with the last one. */
  readonly orders: Array<Record<string, unknown>>;
  /**
   * Puts an order on file as if checkout had placed it — `order-1`, code
   * 4832, a pickup in 8 minutes unless `patch` says otherwise — for tests
   * of the order page alone.
   */
  seedOrder(patch?: Record<string, unknown>): Record<string, unknown>;
  /** Cancels the app asked for, by order id. */
  readonly cancels: string[];
  /** What the app sent to add to the cart, in order. */
  readonly cartAdds: Array<Record<string, unknown>>;
  /** Card payments the app asked for, as sent. */
  readonly payments: Array<Record<string, unknown>>;
}

/** The customer's bound card, as `/payments/agroprombank/cards` lists it. */
export const CARD = {
  id: 'card-1',
  maskedPan: '9104 **** **** 1234',
  embossing: null,
  institute: null,
  instituteName: 'Агропромбанк',
  label: null,
  isDefault: true,
  cardState: 0,
  createdAt: '2026-09-01T10:00:00.000Z',
  lastUsedAt: null,
};

/**
 * Installs the fake API on a page and returns a handle to inspect what the
 * app actually sent — asserting on the created order is how a journey test
 * proves the checkout passed the right slot and totals through.
 */
export async function installFakeApi(
  page: Page,
  opts: {
    pointsBalance?: number;
    /** False = switched on but outside working hours, as the API reports it. */
    storeOpenNow?: boolean;
    /** False = no shift running: the store is shown closed, with no menu. */
    storeAcceptingOrders?: boolean;
    /** Card payments on the deployment; on unless a test switches them off. */
    cardPayments?: boolean;
    /** The customer's bound cards; one by default. */
    cards?: Array<typeof CARD>;
    /** The drink as the product endpoint and the menu describe it; `PRODUCT` by default. */
    product?: FakeProduct;
    /** The menu says what each category is, and has a bakery: the API with category kinds. */
    menuKinds?: boolean;
    /**
     * What the store's customers bought together with anything, best first
     * (`GET /stores/:id/suggestions` with `source: copurchase`). Without it
     * the endpoint is missing, as on an API from before it.
     */
    copurchase?: string[];
    /** Delivery switched on for the deployment (DELIVERY_ENABLED) and offered by the store. */
    delivery?: boolean;
    /** Store fields as the API reports them, over the defaults: a pause, a closing time, a phone. */
    store?: Record<string, unknown>;
    /** `POST /orders/:id/cancel` answers 409 ORDER_NOT_CANCELLABLE with this reason. */
    cancelRefusal?: 'ACCEPTED' | 'CHARGED';
  } = {},
): Promise<FakeApi> {
  const acceptingOrders = opts.storeAcceptingOrders ?? STORE.acceptingOrders;
  const store = {
    ...STORE,
    acceptingOrders,
    openNow: acceptingOrders ? (opts.storeOpenNow ?? STORE.openNow) : false,
    ...(opts.delivery ? { fulfillmentTypes: ['TAKEAWAY', 'DELIVERY'] } : {}),
    ...opts.store,
  };
  const drink: FakeProduct = opts.product ?? PRODUCT;
  const products: FakeProduct[] = opts.menuKinds ? [drink, CROISSANT] : [drink];
  const items: CartItem[] = [];
  const cartAdds: Array<Record<string, unknown>> = [];
  const orders: Array<Record<string, unknown>> = [];
  const payments: Array<Record<string, unknown>> = [];
  const cancels: string[] = [];
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

  const newOrder = (patch: Record<string, unknown>): Record<string, unknown> => {
    const subtotalCents = cart().subtotalCents;
    return {
      id: 'order-1',
      orderCode: '4832',
      status: 'CREATED',
      fulfillmentType: 'PICKUP',
      pickupMode: 'ASAP',
      pickupAt: new Date(Date.now() + 8 * 60_000).toISOString(),
      storeId: STORE.id,
      storeName: STORE.name,
      storeTimezone: STORE.timezone,
      storeLatitude: 0,
      storeLongitude: 0,
      storeAddress: STORE.addressLine,
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
      readyAt: null,
      cancelledAt: null,
      readyEstimateAt: null,
      canCancel: true,
      ...patch,
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
    if (path === '/stores') return json(route, [store]);
    if (path.match(/^\/stores\/[^/]+\/pickup-slots$/)) return json(route, slots());
    if (path.match(/^\/stores\/[^/]+\/suggestions$/)) {
      if (!opts.copurchase) return json(route, { statusCode: 404 }, 404);
      const inHand = (url.searchParams.get('productIds') ?? '').split(',');
      return json(route, { productIds: opts.copurchase.filter((id) => !inHand.includes(id)), source: 'copurchase' });
    }
    if (path.match(/^\/stores\/[^/]+\/menu$/)) {
      const coffee = {
        id: 'cat-1',
        slug: 'coffee',
        name: 'Coffee',
        description: null,
        iconUrl: null,
        sortOrder: 0,
        availableFrom: null,
        availableTo: null,
        products: [drink],
      };
      const bakery = { ...coffee, id: 'cat-2', slug: 'bakery', name: 'Bakery', sortOrder: 1, products: [CROISSANT] };
      return json(route, {
        storeId: STORE.id,
        storeSlug: STORE.slug,
        categories: opts.menuKinds
          ? [
              { ...coffee, kind: 'HOT_DRINKS' },
              { ...bakery, kind: 'BAKERY' },
            ]
          : [coffee],
      });
    }
    if (path.match(/^\/stores\/[^/]+$/)) return json(route, store);
    const productPath = path.match(/^\/products\/([^/]+)$/);
    if (productPath) {
      const found = products.find((p) => p.slug === productPath[1] || p.id === productPath[1]);
      return found ? json(route, found) : json(route, { statusCode: 404 }, 404);
    }

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

    // ── Config & payments ───────────────────────────────────────────────
    if (path === '/config/features') {
      return json(route, {
        deliveryEnabled: opts.delivery ?? false,
        agroprombankEnabled: opts.cardPayments ?? true,
        cardPaymentFlow: (opts.cardPayments ?? true) ? 'token' : 'none',
        support: { email: null, telegram: null },
      });
    }
    if (path === '/payments/agroprombank/cards' && method === 'GET') return json(route, opts.cards ?? [CARD]);
    if (path === '/payments/agroprombank/pay' && method === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      payments.push(body);
      // Held, not taken: the store's accept is what captures it.
      return json(route, { paymentId: 'pay-1', status: 'REQUIRES_ACTION', amountCents: 0 });
    }

    // ── Cart ────────────────────────────────────────────────────────────
    if (path === '/cart' && method === 'GET') return json(route, cart());
    const itemPath = path.match(/^\/cart\/items\/([^/]+)$/);
    if (itemPath && method === 'PATCH') {
      const item = items.find((i) => i.id === itemPath[1]);
      const body = request.postDataJSON() as { quantity?: number };
      if (item && body.quantity) item.quantity = body.quantity;
      return json(route, cart());
    }
    if (itemPath && method === 'DELETE') {
      const index = items.findIndex((i) => i.id === itemPath[1]);
      if (index >= 0) items.splice(index, 1);
      return json(route, cart());
    }
    if (path === '/cart/items' && method === 'POST') {
      const body = request.postDataJSON() as {
        productId: string;
        quantity: number;
        variationIds?: string[];
        modifiers?: Record<string, number>;
        notes?: string;
      };
      cartAdds.push(body);
      // Like the server: the same product with the same options is one line.
      const same = items.find((i) => i.productId === body.productId);
      if (same) {
        same.quantity += body.quantity ?? 1;
        return json(route, cart());
      }
      const product = products.find((p) => p.id === body.productId) ?? drink;
      const variationIds = body.variationIds ?? [];
      const modifiers = body.modifiers ?? {};
      const unitPriceCents =
        product.basePriceCents +
        product.variations.filter((v) => variationIds.includes(v.id)).reduce((sum, v) => sum + v.priceDeltaCents, 0) +
        product.modifiers.reduce((sum, m) => sum + (modifiers[m.id] ?? 0) * m.priceDeltaCents, 0);
      items.push({
        id: `item-${nextId++}`,
        productId: product.id,
        productName: product.name,
        quantity: body.quantity ?? 1,
        unitPriceCents,
        unitPrepSeconds: product.prepTimeSeconds,
        variationIds,
        modifiers,
        notes: body.notes ?? null,
      });
      return json(route, cart());
    }

    // ── Orders ──────────────────────────────────────────────────────────
    if (path === '/orders' && method === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      const order = newOrder({
        fulfillmentType: body['fulfillmentType'] ?? 'PICKUP',
        pickupMode: body['pickupMode'] ?? 'ASAP',
        ...(body['pickupAt'] ? { pickupAt: body['pickupAt'] } : {}),
        // Echoed so the test can assert what checkout actually sent.
        _request: body,
      });
      orders.push(order);
      items.length = 0;
      return json(route, order, 201);
    }
    const cancelPath = path.match(/^\/orders\/([^/]+)\/cancel$/);
    if (cancelPath && method === 'POST') {
      cancels.push(cancelPath[1] ?? '');
      const order = orders[orders.length - 1];
      if (!order) return json(route, { statusCode: 404 }, 404);
      if (opts.cancelRefusal) {
        // The kitchen took it (or the money went) a moment before the tap.
        Object.assign(order, opts.cancelRefusal === 'ACCEPTED' ? { status: 'ACCEPTED' } : {}, { canCancel: false });
        return json(
          route,
          {
            statusCode: 409,
            code: 'ORDER_NOT_CANCELLABLE',
            reason: opts.cancelRefusal,
            message: 'The order can no longer be cancelled',
          },
          409,
        );
      }
      Object.assign(order, { status: 'CANCELLED', canCancel: false, cancelledAt: new Date().toISOString() });
      return json(route, order);
    }
    if (path.match(/^\/orders\/[^/]+$/) && method === 'GET') {
      return json(route, orders[orders.length - 1] ?? {}, orders.length > 0 ? 200 : 404);
    }
    if (path.startsWith('/me/orders')) return json(route, orders);

    // Anything unmapped answers empty rather than hanging the page.
    return json(route, {});
  });

  const seedOrder = (patch: Record<string, unknown> = {}): Record<string, unknown> => {
    const order = newOrder(patch);
    orders.push(order);
    return order;
  };

  return { orders, payments, cartAdds, cancels, seedOrder };
}
