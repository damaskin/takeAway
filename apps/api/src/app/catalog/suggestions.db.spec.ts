import { type CategoryKind, PrismaClient } from '@prisma/client';

import { MemoryRedis } from '../auth/services/testing/memory-redis';
import { FeatureFlagsService } from '../config/feature-flags.service';
import type { KitchenLoadService } from '../kitchen/kitchen-load.service';
import type { StoreAvailabilityService } from '../kitchen/store-availability.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from './catalog.service';
import { SuggestionsService } from './suggestions.service';

/**
 * The co-purchase query on a real Postgres. Opt-in, like the analytics
 * suite: set ANALYTICS_IT_DATABASE_URL to a throwaway database with the
 * migrations applied (`prisma migrate deploy`). The suite adds one brand
 * with two stores, a small menu and its orders, all with ids starting
 * `it-sg-`, and deletes them again. Never point it at a database you care
 * about.
 */
const url = process.env['ANALYTICS_IT_DATABASE_URL'];
const suite = url ? describe : describe.skip;

const BRAND = 'it-sg-brand';
const CENTRE = 'it-sg-centre';
/** A new store of the brand, with two orders of its own. */
const FRESH = 'it-sg-fresh';
const USER = 'it-sg-user';
const DAY = 24 * 60 * 60 * 1000;

const p = (name: string) => `it-sg-${name}`;

/** [category, kind, visible, add-ons only, products]. */
const CATEGORIES: Array<[string, CategoryKind, boolean, boolean, string[]]> = [
  ['coffee', 'HOT_DRINKS', true, false, ['latte', 'americano']],
  ['pastry', 'BAKERY', true, false, ['croissant', 'cheesecake', 'cookie']],
  ['kitchen', 'FOOD', true, false, ['sandwich']],
  ['secret', 'FOOD', false, false, ['secret']],
  ['syrups', 'OTHER', true, true, ['syrup']],
];

interface Seed {
  storeId: string;
  lines: string[];
  times: number;
  daysAgo?: number;
  status?: 'PICKED_UP' | 'CANCELLED' | 'EXPIRED';
}

const SEEDS: Seed[] = [
  // The centre's 30 baskets with a latte.
  { storeId: CENTRE, lines: ['latte', 'croissant'], times: 12 },
  { storeId: CENTRE, lines: ['latte', 'cheesecake'], times: 6 },
  // Sold out at the centre today.
  { storeId: CENTRE, lines: ['latte', 'cookie'], times: 4 },
  // An add-on and a hidden dish: never on the menu.
  { storeId: CENTRE, lines: ['latte', 'syrup'], times: 3 },
  { storeId: CENTRE, lines: ['latte', 'secret'], times: 3 },
  // Twice is not «often».
  { storeId: CENTRE, lines: ['latte', 'sandwich'], times: 2 },
  // Not counted: cancelled, expired, older than 90 days, and a latte alone.
  { storeId: CENTRE, lines: ['latte', 'americano'], times: 5, status: 'CANCELLED' },
  { storeId: CENTRE, lines: ['latte', 'americano'], times: 5, status: 'EXPIRED' },
  { storeId: CENTRE, lines: ['latte', 'americano'], times: 5, daysAgo: 120 },
  { storeId: CENTRE, lines: ['latte'], times: 10 },
  // The new store's own two.
  { storeId: FRESH, lines: ['latte', 'cheesecake'], times: 2 },
];

suite('store suggestions on Postgres', () => {
  let prisma: PrismaClient;
  let suggestions: SuggestionsService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const db = prisma as unknown as PrismaService;
    // getMenu reads neither the kitchen nor the delivery flag.
    const catalog = new CatalogService(
      db,
      { deliveryEnabled: true } as FeatureFlagsService,
      {} as KitchenLoadService,
      {} as StoreAvailabilityService,
    );
    suggestions = new SuggestionsService(db, new MemoryRedis().asService(), catalog);
    await cleanUp(prisma);

    await prisma.brand.create({
      data: { id: BRAND, slug: BRAND, name: 'IT Качели', currency: 'RUP', moderationStatus: 'APPROVED' },
    });
    const store = (id: string, name: string) => ({
      id,
      brandId: BRAND,
      slug: id,
      name,
      addressLine: 'Юности 12',
      city: 'Тирасполь',
      country: 'MD',
      latitude: 46.84,
      longitude: 29.66,
      timezone: 'Europe/Chisinau',
      currency: 'RUP' as const,
    });
    await prisma.store.createMany({ data: [store(CENTRE, 'Центр'), store(FRESH, 'Новая')] });
    await prisma.user.create({ data: { id: USER, name: 'Гость' } });

    for (const [i, [name, kind, visible, addOnsOnly, products]] of CATEGORIES.entries()) {
      await prisma.category.create({
        data: { id: p(name), brandId: BRAND, slug: p(name), name, kind, visible, addOnsOnly, sortOrder: i },
      });
      await prisma.product.createMany({
        data: products.map((product, j) => ({
          id: p(product),
          brandId: BRAND,
          categoryId: p(name),
          slug: p(product),
          name: product,
          basePriceCents: 1000,
          sortOrder: j,
        })),
      });
    }
    const all = CATEGORIES.flatMap(([, , , , products]) => products);
    await prisma.productStore.createMany({
      data: [
        ...all.map((product) => ({ productId: p(product), storeId: CENTRE })),
        // The new store has no kitchen: no sandwich.
        ...all
          .filter((product) => product !== 'sandwich')
          .map((product) => ({ productId: p(product), storeId: FRESH })),
      ],
    });
    await prisma.stopListEntry.create({ data: { storeId: CENTRE, productId: p('cookie') } });

    let n = 0;
    for (const seed of SEEDS) {
      for (let t = 0; t < seed.times; t++) {
        const id = p(`o${n++}`);
        const createdAt = new Date(Date.now() - (seed.daysAgo ?? 1) * DAY);
        await prisma.order.create({
          data: {
            id,
            userId: USER,
            storeId: seed.storeId,
            status: seed.status ?? 'PICKED_UP',
            pickupAt: createdAt,
            createdAt,
            subtotalCents: 1000 * seed.lines.length,
            totalCents: 1000 * seed.lines.length,
            currency: 'RUP',
            orderCode: id,
            qrToken: id,
            items: {
              create: seed.lines.map((product) => ({
                productSnapshot: { id: p(product), name: product },
                quantity: 1,
                unitPriceCents: 1000,
                totalCents: 1000,
              })),
            },
          },
        });
      }
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanUp(prisma);
    await prisma.$disconnect();
  });

  it("ranks what the store's customers bought with a latte, only what it can sell now", async () => {
    await expect(suggestions.suggest(CENTRE, [p('latte')])).resolves.toEqual({
      productIds: [p('croissant'), p('cheesecake')],
      source: 'copurchase',
    });
  });

  it("answers a new store from the brand's orders, with its own menu and stop list", async () => {
    await expect(suggestions.suggest(FRESH, [p('latte')])).resolves.toEqual({
      productIds: [p('croissant'), p('cheesecake'), p('cookie')],
      source: 'copurchase',
    });
  });

  it('falls back to the menu rule where too few orders hold the product', async () => {
    // No counted order has an americano: bakery and food next to a drink.
    await expect(suggestions.suggest(CENTRE, [p('americano')])).resolves.toEqual({
      productIds: [p('croissant'), p('sandwich'), p('cheesecake')],
      source: 'rule',
    });
    // Twelve croissant baskets are not enough, and the rule offers nothing next to food.
    await expect(suggestions.suggest(CENTRE, [p('croissant')])).resolves.toEqual({ productIds: [], source: 'rule' });
  });
});

async function cleanUp(prisma: PrismaClient): Promise<void> {
  const stores = { in: [CENTRE, FRESH] };
  await prisma.order.deleteMany({ where: { storeId: stores } });
  await prisma.stopListEntry.deleteMany({ where: { storeId: stores } });
  await prisma.productStore.deleteMany({ where: { storeId: stores } });
  await prisma.product.deleteMany({ where: { brandId: BRAND } });
  await prisma.category.deleteMany({ where: { brandId: BRAND } });
  await prisma.store.deleteMany({ where: { id: stores } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.brand.deleteMany({ where: { id: BRAND } });
}
