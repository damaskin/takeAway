import { PrismaClient } from '@prisma/client';
import { needsOptionChoice } from '@takeaway/utils';

import { AdminBrandOptionsService } from '../admin/options/admin-brand-options.service';
import { AdminLegacyOptionsService } from '../admin/options/admin-legacy-options.service';
import { AdminOptionCatalogService } from '../admin/options/admin-option-catalog.service';
import { AdminProductOptionGroupsService } from '../admin/options/admin-product-option-groups.service';
import { CartChangedException } from '../cart/cart-changed.exception';
import { CartService, storeProductInclude } from '../cart/cart.service';
import type { KitchenLoadService } from '../kitchen/kitchen-load.service';
import type { StoreAvailabilityService } from '../kitchen/store-availability.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ProductOptionGroupsService } from './product-option-groups.service';

/**
 * The options catalog on a real Postgres: the seed of the migration, the
 * admin writes, the builder and the cart. Opt-in: set OPTIONS_IT_DATABASE_URL
 * to a throwaway database with the migrations applied (`prisma migrate
 * deploy`). The suite adds one brand, store, user and a few products with
 * ids starting `it-opt-`, and deletes them again; the catalog itself is only
 * read. Never point it at a database you care about.
 */
const url = process.env['OPTIONS_IT_DATABASE_URL'];
const suite = url ? describe : describe.skip;

const BRAND = 'it-opt-brand';
const STORE = 'it-opt-store';
const USER = 'it-opt-user';
const CATEGORY = 'it-opt-coffee';
const LATTE = 'it-opt-latte';
const LEGACY = 'it-opt-legacy';

suite('options catalog on Postgres', () => {
  let prisma: PrismaClient;
  let db: PrismaService;
  let builder: ProductOptionGroupsService;
  let cart: CartService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    db = prisma as unknown as PrismaService;
    builder = new ProductOptionGroupsService(db);
    cart = new CartService(
      db,
      {
        timings: () => ({ prepSeconds: 0, workSeconds: 0 }),
        quote: async () => ({ etaSeconds: 0 }),
      } as unknown as KitchenLoadService,
      { forStore: async () => ({ acceptingOrders: true }) } as unknown as StoreAvailabilityService,
      builder,
    );
    await cleanUp(prisma);

    await prisma.brand.create({
      data: { id: BRAND, slug: BRAND, name: 'IT Опции', currency: 'RUP', moderationStatus: 'APPROVED' },
    });
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
        timezone: 'Europe/Chisinau',
        currency: 'RUP',
      },
    });
    await prisma.user.create({ data: { id: USER, name: 'Гость' } });
    await prisma.category.create({
      data: { id: CATEGORY, brandId: BRAND, slug: CATEGORY, name: 'Кофе', kind: 'HOT_DRINKS' },
    });
    await prisma.product.createMany({
      data: [LATTE, LEGACY].map((id, i) => ({
        id,
        brandId: BRAND,
        categoryId: CATEGORY,
        slug: id,
        name: i === 0 ? 'Латте' : 'Раф',
        basePriceCents: 4500,
        sortOrder: i,
      })),
    });
    await prisma.productStore.createMany({
      data: [LATTE, LEGACY].map((productId) => ({ productId, storeId: STORE })),
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanUp(prisma);
    await prisma.$disconnect();
  });

  it('has the starting catalog of the spec', async () => {
    expect(await prisma.optionGroup.count()).toBeGreaterThanOrEqual(29);
    const ice = await prisma.optionGroup.findUnique({ where: { id: 'og_ice' }, include: { options: true } });
    expect(ice).toMatchObject({ kind: 'ADDON', type: 'C', showIfOptionId: 'oi_serving_cold' });
    expect(ice?.options).toEqual([expect.objectContaining({ name: 'Лёд', minQty: 0, maxQty: 3, defaultQty: 0 })]);
    expect(await prisma.optionItem.findUnique({ where: { id: 'oi_meat_portions_meat' } })).toMatchObject({
      minQty: 1,
      maxQty: 2,
      defaultQty: 1,
    });
    expect(await prisma.optionItem.findUnique({ where: { id: 'oi_coffee_size_m' } })).toMatchObject({
      name: 'M',
      note: '300–350 мл',
      isDefault: false,
    });
    expect(await prisma.optionItem.count({ where: { groupId: 'og_dish_sauce', isDefault: true } })).toBe(0);
    expect(await prisma.optionItem.count({ where: { groupId: 'og_syrups' } })).toBe(27);
  });

  it('builds what the store sells from the admin writes, and orders it through the cart', async () => {
    const products = new AdminProductOptionGroupsService(db);
    const brand = new AdminBrandOptionsService(db);

    await products.replace(null, LATTE, {
      groups: ['og_milk', 'og_coffee_size', 'og_serving', 'og_syrups', 'og_sugar', 'og_ice'].map((groupId, i) => ({
        groupId,
        sortOrder: i,
      })),
      overrides: [{ optionId: 'oi_coffee_size_l', priceCents: 1000, isDefault: null }],
    });
    await brand.update([BRAND], BRAND, 'oi_milk_oat', { priceCents: 1000 });
    await brand.update([BRAND], BRAND, 'oi_syrups_vanilla', { priceCents: 800 });
    await brand.update([BRAND], BRAND, 'oi_syrups_caramel', { enabled: false });
    await brand.stop([BRAND], STORE, 'oi_milk_coconut', {});

    const groups = (await builder.forProducts([LATTE, LEGACY], { brandId: BRAND, storeId: STORE })).get(LATTE) ?? [];
    expect(groups.map((g) => g.id)).toEqual([
      'og_coffee_size',
      'og_serving',
      'og_milk',
      'og_syrups',
      'og_sugar',
      'og_ice',
    ]);
    const option = (id: string) => groups.flatMap((g) => g.options).find((o) => o.id === id);
    expect(option('oi_coffee_size_l')?.priceCents).toBe(1000);
    expect(option('oi_milk_oat')?.priceCents).toBe(1000);
    expect(option('oi_milk_coconut')?.available).toBe(false);
    expect(option('oi_syrups_caramel')).toBeUndefined();
    expect(needsOptionChoice(groups)).toBe(true);

    const picks = [
      { optionId: 'oi_coffee_size_m', qty: 1 },
      { optionId: 'oi_serving_hot', qty: 1 },
      { optionId: 'oi_milk_oat', qty: 1 },
      { optionId: 'oi_syrups_vanilla', qty: 1 },
      { optionId: 'oi_sugar_sugar', qty: 2 },
    ];
    await cart.addItem(USER, { storeId: STORE, productId: LATTE, quantity: 1, options: picks });
    const view = await cart.addItem(USER, { storeId: STORE, productId: LATTE, quantity: 1, options: picks });
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({ quantity: 2, unitPriceCents: 4500 + 1000 + 800 });
    expect(view.items[0]?.options?.map((l) => l.name)).toEqual(['M', 'Горячий', 'Овсяное', 'Ваниль', 'Сахар']);

    await expect(
      cart.addItem(USER, {
        storeId: STORE,
        productId: LATTE,
        quantity: 1,
        options: [...picks, { optionId: 'oi_ice_ice', qty: 1 }],
      }),
    ).rejects.toMatchObject({ response: { code: 'OPTIONS_INVALID' } });

    // The brand raises the oat milk: checkout refuses once and fixes the cart.
    await brand.update([BRAND], BRAND, 'oi_milk_oat', { priceCents: 1200 });
    const checkout = async () => {
      const row = await prisma.cart.findUniqueOrThrow({
        where: { userId_storeId: { userId: USER, storeId: STORE } },
        include: { items: { include: { product: { include: storeProductInclude(STORE) } } } },
      });
      return cart.repriceForCheckout(row);
    };
    const err = await checkout().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CartChangedException);
    expect((err as CartChangedException).items).toEqual([
      expect.objectContaining({ reason: 'PRICE_CHANGED', unitPriceCents: 6500 }),
    ]);
    const [line] = await checkout();
    expect(line?.optionLines.map((l) => [l.name, l.totalCents])).toEqual([
      ['M', 0],
      ['Горячий', 0],
      ['Овсяное', 1200],
      ['Ваниль', 800],
      ['Сахар', 0],
    ]);

    // A group a product has cannot leave the catalog.
    await expect(new AdminOptionCatalogService(db).deleteGroup('og_milk')).rejects.toMatchObject({
      response: { code: 'OPTION_GROUP_IN_USE' },
    });
  });

  it("clears a brand's older options in one go, with the cart lines made of them", async () => {
    const ingredient = await prisma.ingredient.create({
      data: { brandId: BRAND, name: 'Овсяное молоко', priceCents: 60 },
    });
    const variation = await prisma.variation.create({
      data: { productId: LEGACY, type: 'MILK', name: 'Овсяное', ingredientId: ingredient.id },
    });
    await prisma.modifier.create({
      data: { productId: LEGACY, slug: 'it-opt-shot', name: 'Шот', ingredientId: ingredient.id },
    });
    await prisma.storeIngredientStop.create({ data: { storeId: STORE, ingredientId: ingredient.id } });
    const { id: cartId } = await prisma.cart.findUniqueOrThrow({
      where: { userId_storeId: { userId: USER, storeId: STORE } },
    });
    await prisma.cartItem.create({
      data: {
        cartId,
        productId: LEGACY,
        quantity: 1,
        variationIds: [variation.id],
        unitPriceCents: 4560,
        unitPrepSeconds: 0,
      },
    });

    const legacy = new AdminLegacyOptionsService(db);
    expect(await legacy.summary(BRAND)).toEqual({
      products: 1,
      variations: 1,
      modifiers: 1,
      categoryOptions: 0,
      ingredients: 1,
    });
    expect(await legacy.clear(BRAND)).toEqual({
      products: 1,
      variations: 1,
      modifiers: 1,
      categoryOptions: 0,
      ingredients: 1,
    });
    expect(await legacy.summary(BRAND)).toEqual({
      products: 0,
      variations: 0,
      modifiers: 0,
      categoryOptions: 0,
      ingredients: 0,
    });
    // The legacy line left; the catalog latte stayed, and the cart was re-totalled.
    const left = await prisma.cart.findUniqueOrThrow({ where: { id: cartId }, include: { items: true } });
    expect(left.items.map((i) => i.productId)).toEqual([LATTE]);
    expect(left.subtotalCents).toBe(2 * 6500);
  });
});

async function cleanUp(prisma: PrismaClient): Promise<void> {
  await prisma.cart.deleteMany({ where: { userId: USER } });
  await prisma.product.deleteMany({ where: { brandId: BRAND } });
  await prisma.category.deleteMany({ where: { brandId: BRAND } });
  await prisma.ingredient.deleteMany({ where: { brandId: BRAND } });
  await prisma.store.deleteMany({ where: { id: STORE } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.brand.deleteMany({ where: { id: BRAND } });
}
