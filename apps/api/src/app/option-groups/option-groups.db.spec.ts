import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { needsOptionChoice } from '@takeaway/utils';

import { AdminCatalogService } from '../admin/catalog/admin-catalog.service';
import { AdminBrandOptionsService } from '../admin/options/admin-brand-options.service';
import { AdminOptionCatalogService } from '../admin/options/admin-option-catalog.service';
import { AdminProductOptionGroupsService } from '../admin/options/admin-product-option-groups.service';
import type { PasswordService } from '../auth/services/password.service';
import { listedProductCounts } from '../brand-owner/brand-onboarding';
import { CartChangedException } from '../cart/cart-changed.exception';
import { CartService, storeProductInclude } from '../cart/cart.service';
import { CatalogService } from '../catalog/catalog.service';
import type { FeatureFlagsService } from '../config/feature-flags.service';
import type { KitchenLoadService } from '../kitchen/kitchen-load.service';
import type { StoreAvailabilityService } from '../kitchen/store-availability.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StoreAvailabilityNotifier } from '../realtime/store-availability.notifier';
import { ProductOptionGroupsService } from './product-option-groups.service';

/**
 * The options catalog on a real Postgres: the seed of the migrations, the
 * admin writes, the builder and the cart, and the rule that a product is
 * shown to customers only with a variant and an add-on (owner, 2026-11-18)
 * across the menu, the product page, the cart, checkout, the onboarding
 * count and the admin list. Opt-in: set OPTIONS_IT_DATABASE_URL
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
/** «Раф»: no options to start with, so customers do not see it. */
const BARE = 'it-opt-raf';

suite('options catalog on Postgres', () => {
  let prisma: PrismaClient;
  let db: PrismaService;
  let builder: ProductOptionGroupsService;
  let cart: CartService;
  let catalog: CatalogService;

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
    catalog = new CatalogService(
      db,
      { deliveryEnabled: true } as FeatureFlagsService,
      {} as KitchenLoadService,
      {} as StoreAvailabilityService,
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
      data: [LATTE, BARE].map((id, i) => ({
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
      data: [LATTE, BARE].map((productId) => ({ productId, storeId: STORE })),
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

    const groups = (await builder.forProducts([LATTE, BARE], { brandId: BRAND, storeId: STORE })).get(LATTE) ?? [];
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

  it('marks the seeded groups drinks or food, and has no older options any more', async () => {
    const scopes = await prisma.optionGroup.findMany({
      where: { id: { in: ['og_milk', 'og_ice', 'og_drink_size', 'og_base', 'og_dips'] } },
      select: { id: true, scope: true },
      orderBy: { id: 'asc' },
    });
    expect(scopes).toEqual([
      { id: 'og_base', scope: 'FOOD' },
      { id: 'og_dips', scope: 'FOOD' },
      { id: 'og_drink_size', scope: 'DRINKS' },
      { id: 'og_ice', scope: 'DRINKS' },
      { id: 'og_milk', scope: 'DRINKS' },
    ]);
    expect(await prisma.optionGroup.count({ where: { id: { startsWith: 'og_' }, scope: 'BOTH' } })).toBe(0);

    // Migration 20261118110000_drop_legacy_options: the tables and the cart columns are gone.
    const tables = await prisma.$queryRaw<Array<{ name: string | null }>>`
      SELECT to_regclass(t)::text AS name
      FROM unnest(ARRAY['"Variation"', '"Modifier"', '"Ingredient"', '"CategoryOption"', '"StoreIngredientStop"']) AS t
    `;
    expect(tables.map((t) => t.name)).toEqual([null, null, null, null, null]);
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'CartItem' AND column_name IN ('variationIds', 'modifiersJson', 'optionsJson')
    `;
    expect(columns.map((c) => c.column_name)).toEqual(['optionsJson']);
  });

  it('shows a product only with a variant and an add-on: menu, page, cart, checkout, onboarding, admin', async () => {
    const products = new AdminProductOptionGroupsService(db);
    const brand = new AdminBrandOptionsService(db);
    const admin = new AdminCatalogService(db, {} as PasswordService, {} as StoreAvailabilityNotifier, builder);
    const shown = async () => ({
      menu: (await catalog.getMenu(STORE)).categories.flatMap((c) => c.products.map((p) => p.id)),
      listed: (await listedProductCounts(db, [BRAND])).get(BRAND) ?? 0,
      admin: (await admin.listProducts([BRAND], BRAND)).filter((p) => p.optionsComplete).map((p) => p.id),
    });

    // The latte (sizes, milk, syrups…) is shown; the bare raf is not, anywhere.
    expect(await shown()).toEqual({ menu: [LATTE], listed: 1, admin: [LATTE] });
    await expect(catalog.getProduct(BARE, STORE)).rejects.toBeInstanceOf(NotFoundException);
    await expect(catalog.getProduct(BARE)).rejects.toBeInstanceOf(NotFoundException);
    await expect(cart.addItem(USER, { storeId: STORE, productId: BARE, quantity: 1 })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    // A variant alone is not enough.
    await products.replace(null, BARE, { groups: [{ groupId: 'og_serving', sortOrder: 0 }], overrides: [] });
    expect((await shown()).menu).toEqual([LATTE]);

    // With an add-on it is shown and sold (hot by default, no sugar: the base price).
    await products.replace(null, BARE, {
      groups: [
        { groupId: 'og_serving', sortOrder: 0 },
        { groupId: 'og_extra_shot', sortOrder: 1 },
      ],
      overrides: [],
    });
    expect(await shown()).toEqual({ menu: [LATTE, BARE], listed: 2, admin: [LATTE, BARE] });
    expect((await catalog.getProduct(BARE, STORE)).optionGroups.map((g) => g.id)).toEqual([
      'og_serving',
      'og_extra_shot',
    ]);
    const added = await cart.addItem(USER, { storeId: STORE, productId: BARE, quantity: 1 });
    expect(added.items.find((i) => i.productId === BARE)).toMatchObject({ unitPriceCents: 4500 });

    // Its only add-on switched off on the product: hidden again, and checkout takes the line out.
    await products.replace(null, BARE, {
      groups: [
        { groupId: 'og_serving', sortOrder: 0 },
        { groupId: 'og_extra_shot', sortOrder: 1 },
      ],
      overrides: [{ optionId: 'oi_extra_shot_extra_shot', priceCents: null, isDefault: null, enabled: false }],
    });
    expect(await shown()).toEqual({ menu: [LATTE], listed: 1, admin: [LATTE] });
    const row = await prisma.cart.findUniqueOrThrow({
      where: { userId_storeId: { userId: USER, storeId: STORE } },
      include: { items: { include: { product: { include: storeProductInclude(STORE) } } } },
    });
    const err = await cart.repriceForCheckout(row).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CartChangedException);
    expect((err as CartChangedException).items).toEqual([
      expect.objectContaining({ productId: BARE, reason: 'PRODUCT_UNAVAILABLE' }),
    ]);

    // Switched on again on the product, but the brand does not have the shot: still hidden.
    await products.replace(null, BARE, {
      groups: [
        { groupId: 'og_serving', sortOrder: 0 },
        { groupId: 'og_extra_shot', sortOrder: 1 },
      ],
      overrides: [],
    });
    await brand.update([BRAND], BRAND, 'oi_extra_shot_extra_shot', { enabled: false });
    expect((await shown()).menu).toEqual([LATTE]);
    await brand.update([BRAND], BRAND, 'oi_extra_shot_extra_shot', { enabled: true });

    // A store's stop does not hide it: the shot is only greyed out there.
    await brand.stop([BRAND], STORE, 'oi_extra_shot_extra_shot', {});
    expect((await shown()).menu).toEqual([LATTE, BARE]);
    await brand.resume([BRAND], STORE, 'oi_extra_shot_extra_shot');
  });

  it('prices an add-on per product, switches single options off, and applies one price to a group', async () => {
    const products = new AdminProductOptionGroupsService(db);
    const brand = new AdminBrandOptionsService(db);
    await products.replace(null, BARE, {
      groups: [
        { groupId: 'og_serving', sortOrder: 0 },
        { groupId: 'og_syrups', sortOrder: 1 },
      ],
      overrides: [
        { optionId: 'oi_serving_cold', priceCents: null, isDefault: null, enabled: false },
        { optionId: 'oi_syrups_vanilla', priceCents: 0, isDefault: null },
      ],
    });

    // «Применить ко всем»: +5 on every syrup of the brand.
    const settings = await brand.applyGroupPrice([BRAND], BRAND, 'og_syrups', { priceCents: 500 });
    expect(settings).toHaveLength(27);
    expect(new Set(settings.map((s) => s.priceCents))).toEqual(new Set([500]));
    await expect(brand.applyGroupPrice([BRAND], BRAND, 'og_serving', { priceCents: 500 })).rejects.toMatchObject({
      response: { code: 'OPTION_GROUP_INVALID' },
    });

    const groups = await builder.forProduct(BARE, { brandId: BRAND, storeId: STORE });
    const option = (id: string) => groups.flatMap((g) => g.options).find((o) => o.id === id);
    expect(option('oi_serving_cold')).toBeUndefined();
    expect(option('oi_syrups_vanilla')?.priceCents).toBe(0);
    expect(option('oi_syrups_caramel')).toBeUndefined(); // switched off by the brand above
    expect(option('oi_syrups_hazelnut')?.priceCents).toBe(500);

    // «Добавки» shows what the cards set: the raf's free vanilla, the latte's L.
    const view = await brand.catalog([BRAND], BRAND);
    expect(view.productPrices).toEqual(
      expect.arrayContaining([
        { optionId: 'oi_syrups_vanilla', productId: BARE, productName: 'Раф', priceCents: 0 },
        { optionId: 'oi_coffee_size_l', productId: LATTE, productName: 'Латте', priceCents: 1000 },
        { optionId: 'oi_coffee_size_m', productId: LATTE, productName: 'Латте', priceCents: 0 },
      ]),
    );
  });
});

async function cleanUp(prisma: PrismaClient): Promise<void> {
  await prisma.cart.deleteMany({ where: { userId: USER } });
  await prisma.product.deleteMany({ where: { brandId: BRAND } });
  await prisma.category.deleteMany({ where: { brandId: BRAND } });
  await prisma.store.deleteMany({ where: { id: STORE } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.brand.deleteMany({ where: { id: BRAND } });
}
