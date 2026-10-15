import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import type { PasswordService } from '../../auth/services/password.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StoreAvailabilityNotifier } from '../../realtime/store-availability.notifier';
import { AdminCatalogService } from './admin-catalog.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/admin-category.dto';
import { CreateModifierDto, CreateProductDto, CreateVariationDto } from './dto/admin-product.dto';

/** The HTTP body a Nest exception renders — where the admin reads `code` from. */
function body(err: unknown): Record<string, unknown> {
  return (err as { getResponse(): Record<string, unknown> }).getResponse();
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
}

/** Just enough of Prisma for the menu editor; `$transaction` runs callbacks against the same fakes. */
function build() {
  const prisma = {
    category: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: null } }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'new-cat', ...data })),
      update: jest.fn((args: unknown) => Promise.resolve(args)),
      delete: jest.fn().mockResolvedValue({}),
    },
    product: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: null } }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'new-product', ...data, stores: [] }),
      ),
      update: jest.fn((args: object) => Promise.resolve({ ...args, stores: [] })),
      delete: jest.fn().mockResolvedValue({}),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    store: { findMany: jest.fn().mockResolvedValue([{ id: 'store-1' }]) },
    variation: {
      findUnique: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: null } }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'new-variation', ...data }),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'v1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn().mockResolvedValue({}),
    },
    modifier: {
      findUnique: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: null } }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'new-modifier', ...data }),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'm1', ...data })),
      delete: jest.fn().mockResolvedValue({}),
    },
    ingredient: {
      findFirst: jest.fn(),
      upsert: jest.fn(({ create }: { create: { name: string; priceCents?: number } }) =>
        Promise.resolve({ id: `ing-${create.name}`, name: create.name, priceCents: create.priceCents ?? 0 }),
      ),
    },
    cartItem: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    cart: { update: jest.fn().mockResolvedValue({}) },
    categoryOption: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: typeof prisma) => Promise<unknown>)(prisma)
      : Promise.all(arg as unknown[]),
  );
  const svc = new AdminCatalogService(
    prisma as unknown as PrismaService,
    {} as PasswordService,
    {} as StoreAvailabilityNotifier,
  );
  return { svc, prisma };
}

describe('menu DTOs', () => {
  async function errors<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
    const found = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
    return found.map((e) => e.property);
  }

  it('takes a category kind and default prep time, and an add-on group of at most 40 characters', async () => {
    const base = { brandId: 'b1', name: 'Шаурма' };
    expect(await errors(CreateCategoryDto, { ...base, kind: 'FOOD', defaultPrepTimeSeconds: 900 })).toEqual([]);
    expect(await errors(UpdateCategoryDto, { defaultPrepTimeSeconds: null })).toEqual([]);
    expect(await errors(CreateCategoryDto, { ...base, kind: 'PIZZA' })).toEqual(['kind']);
    expect(await errors(CreateCategoryDto, { ...base, defaultPrepTimeSeconds: -1 })).toEqual([
      'defaultPrepTimeSeconds',
    ]);
    expect(await errors(CreateModifierDto, { name: 'Ваниль', group: 'Сиропы' })).toEqual([]);
    expect(await errors(CreateModifierDto, { name: 'Ваниль', group: null })).toEqual([]);
    expect(await errors(CreateModifierDto, { name: 'Ваниль', group: 'x'.repeat(41) })).toEqual(['group']);
  });

  it('lets the slug be left out of every create', async () => {
    expect(await errors(CreateCategoryDto, { brandId: 'b1', name: 'Десерты' })).toEqual([]);
    expect(
      await errors(CreateProductDto, { brandId: 'b1', categoryId: 'c1', name: 'Латте', basePriceCents: 3500 }),
    ).toEqual([]);
    expect(await errors(CreateModifierDto, { name: 'Ванильный сироп' })).toEqual([]);
  });

  it('lets an option picked from the add-ons library leave its name out, and nothing else', async () => {
    expect(await errors(CreateModifierDto, { ingredientId: 'ing-1' })).toEqual([]);
    expect(await errors(CreateVariationDto, { type: 'MILK', ingredientId: 'ing-1' })).toEqual([]);
    expect(await errors(CreateModifierDto, {})).toEqual(['name']);
    expect(await errors(CreateModifierDto, { ingredientId: null })).toEqual(['name']);
    expect(await errors(CreateModifierDto, { ingredientId: 'ing-1', name: '' })).toEqual(['name']);
  });

  it('holds a typed slug to lowercase latin, digits and hyphens, 2 to 60 long', async () => {
    const base = { brandId: 'b1', name: 'Кофе' };
    expect(await errors(CreateCategoryDto, { ...base, slug: 'coffee-2' })).toEqual([]);
    expect(await errors(CreateCategoryDto, { ...base, slug: 'кофе' })).toEqual(['slug']);
    expect(await errors(CreateCategoryDto, { ...base, slug: 'Coffee' })).toEqual(['slug']);
    expect(await errors(CreateCategoryDto, { ...base, slug: 'c' })).toEqual(['slug']);
    expect(await errors(CreateCategoryDto, { ...base, slug: 'c'.repeat(61) })).toEqual(['slug']);
  });

  it('refuses a price past what the column holds', async () => {
    const base = { brandId: 'b1', categoryId: 'c1', name: 'Латте' };
    expect(await errors(CreateProductDto, { ...base, basePriceCents: 3_000_000_000 })).toEqual(['basePriceCents']);
  });
});

describe('AdminCatalogService — categories', () => {
  it('says how many products of each category have no photo — the app shows those without a picture', async () => {
    const { svc, prisma } = build();
    prisma.category.findMany.mockResolvedValue([
      { id: 'coffee', _count: { products: 5, options: 0 } },
      { id: 'bakery', _count: { products: 2, options: 0 } },
    ]);
    prisma.product.groupBy.mockResolvedValue([{ categoryId: 'coffee', _count: { _all: 3 } }]);

    const list = await svc.listCategories(['b1'], 'b1');

    expect(list.map((c) => [c.id, c.productsWithoutPhoto])).toEqual([
      ['coffee', 3],
      ['bakery', 0],
    ]);
    expect(prisma.product.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['categoryId'],
        where: { categoryId: { in: ['coffee', 'bakery'] }, imageUrls: { isEmpty: true } },
      }),
    );
  });

  it('asks nothing more of a brand without categories', async () => {
    const { svc, prisma } = build();
    prisma.category.findMany.mockResolvedValue([]);

    await expect(svc.listCategories(['b1'], 'b1')).resolves.toEqual([]);
    expect(prisma.product.groupBy).not.toHaveBeenCalled();
  });

  it('builds the slug from a Russian name and skips taken ones', async () => {
    const { svc, prisma } = build();
    prisma.category.count.mockImplementation(({ where }: { where: { slug: string } }) =>
      Promise.resolve(where.slug === 'deserty' ? 1 : 0),
    );

    await svc.createCategory({ brandId: 'b1', name: 'Десерты' }, ['b1']);

    expect(prisma.category.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ brandId: 'b1', slug: 'deserty-2' }),
    });
    expect(prisma.category.count).toHaveBeenCalledWith({ where: { brandId: 'b1', slug: 'deserty' } });
  });

  it('keeps a typed slug and the visibility the editor asked for', async () => {
    const { svc, prisma } = build();

    await svc.createCategory({ brandId: 'b1', name: 'Сезонное', slug: 'season', visible: false }, ['b1']);

    expect(prisma.category.count).not.toHaveBeenCalled();
    expect(prisma.category.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ slug: 'season', visible: false }),
    });
  });

  it('marks a category as add-ons only, and back', async () => {
    const { svc, prisma } = build();
    prisma.category.findUnique.mockResolvedValue({ id: 'c-extra', brandId: 'b1' });

    await svc.updateCategory('c-extra', { addOnsOnly: true }, ['b1']);

    expect(prisma.category.update).toHaveBeenCalledWith({ where: { id: 'c-extra' }, data: { addOnsOnly: true } });
    const dto = plainToInstance(UpdateCategoryDto, { addOnsOnly: 'yes' });
    expect((await validate(dto)).map((e) => e.property)).toEqual(['addOnsOnly']);
  });

  it('puts a new category after the last one', async () => {
    const { svc, prisma } = build();
    prisma.category.aggregate.mockResolvedValue({ _max: { sortOrder: 4 } });

    await svc.createCategory({ brandId: 'b1', name: 'Чай' }, ['b1']);

    expect(prisma.category.create).toHaveBeenCalledWith({ data: expect.objectContaining({ sortOrder: 5 }) });
  });

  it('answers a taken slug with 409 SLUG_TAKEN instead of a 500', async () => {
    const { svc, prisma } = build();
    prisma.category.create.mockRejectedValue({ code: 'P2002' });

    const err = await rejection(svc.createCategory({ brandId: 'b1', name: 'Кофе', slug: 'coffee' }, ['b1']));

    expect(err).toBeInstanceOf(ConflictException);
    expect(body(err)).toMatchObject({ code: 'SLUG_TAKEN', slug: 'coffee' });
  });

  describe('delete', () => {
    function withCategories() {
      const built = build();
      const categories: Record<string, { id: string; brandId: string }> = {
        old: { id: 'old', brandId: 'b1' },
        next: { id: 'next', brandId: 'b1' },
        rival: { id: 'rival', brandId: 'b2' },
      };
      built.prisma.category.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(categories[where.id] ?? null),
      );
      return built;
    }

    it('deletes an empty category', async () => {
      const { svc, prisma } = withCategories();

      await svc.deleteCategory('old', ['b1']);

      expect(prisma.category.delete).toHaveBeenCalledWith({ where: { id: 'old' } });
    });

    it('refuses a category that still has products with 409 CATEGORY_NOT_EMPTY', async () => {
      const { svc, prisma } = withCategories();
      prisma.product.count.mockResolvedValue(3);

      const err = await rejection(svc.deleteCategory('old', ['b1']));

      expect(err).toBeInstanceOf(ConflictException);
      expect(body(err)).toMatchObject({ code: 'CATEGORY_NOT_EMPTY', productCount: 3 });
      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('moves the products to the end of another category, then deletes', async () => {
      const { svc, prisma } = withCategories();
      prisma.product.count.mockResolvedValue(2);
      prisma.product.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
      prisma.product.aggregate.mockResolvedValue({ _max: { sortOrder: 6 } });

      await svc.deleteCategory('old', ['b1'], 'next');

      expect(prisma.product.aggregate).toHaveBeenCalledWith({
        where: { categoryId: 'next' },
        _max: { sortOrder: true },
      });
      expect(prisma.product.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'p1' },
        data: { categoryId: 'next', sortOrder: 7 },
      });
      expect(prisma.product.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'p2' },
        data: { categoryId: 'next', sortOrder: 8 },
      });
      expect(prisma.category.delete).toHaveBeenCalledWith({ where: { id: 'old' } });
    });

    it("will not move products into another brand's category", async () => {
      const { svc, prisma } = withCategories();
      prisma.product.count.mockResolvedValue(1);

      const err = await rejection(svc.deleteCategory('old', ['b1'], 'rival'));

      expect(err).toBeInstanceOf(BadRequestException);
      expect(body(err)).toMatchObject({ code: 'CATEGORY_MOVE_TARGET' });
      expect(prisma.product.update).not.toHaveBeenCalled();
      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('will not move products into the category being deleted', async () => {
      const { svc, prisma } = withCategories();
      prisma.product.count.mockResolvedValue(1);

      await expect(svc.deleteCategory('old', ['b1'], 'old')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('turns a product added mid-delete into the same 409', async () => {
      const { svc, prisma } = withCategories();
      prisma.category.delete.mockRejectedValue({ code: 'P2003' });

      const err = await rejection(svc.deleteCategory('old', ['b1']));

      expect(body(err)).toMatchObject({ code: 'CATEGORY_NOT_EMPTY' });
    });
  });

  it('reorders only categories of one brand in scope', async () => {
    const { svc, prisma } = build();
    prisma.category.findMany.mockResolvedValue([{ brandId: 'b1' }, { brandId: 'b1' }]);

    await svc.reorderCategories({ orderedIds: ['c2', 'c1'] }, ['b1']);
    expect(prisma.category.update).toHaveBeenCalledWith({ where: { id: 'c2' }, data: { sortOrder: 0 } });
    expect(prisma.category.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { sortOrder: 1 } });

    prisma.category.findMany.mockResolvedValue([{ brandId: 'b1' }]);
    await expect(svc.reorderCategories({ orderedIds: ['c1', 'gone'] }, ['b1'])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    prisma.category.findMany.mockResolvedValue([{ brandId: 'b1' }, { brandId: 'b2' }]);
    await expect(svc.reorderCategories({ orderedIds: ['c1', 'c9'] }, ['b1'])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('AdminCatalogService — products', () => {
  const product = { id: 'p1', brandId: 'b1', categoryId: 'cat-a', variations: [], modifiers: [], stores: [] };

  function withProduct() {
    const built = build();
    built.prisma.category.findUnique.mockResolvedValue({ brandId: 'b1' });
    built.prisma.product.findUnique.mockResolvedValue(product);
    return built;
  }

  it('guesses the kind of a new category from its name when none is sent', async () => {
    const { svc, prisma } = build();

    await svc.createCategory({ brandId: 'b1', name: 'Шаурма' }, ['b1']);
    await svc.createCategory({ brandId: 'b1', name: 'Новинки' }, ['b1']);
    await svc.createCategory({ brandId: 'b1', name: 'Кофе', kind: 'OTHER' }, ['b1']);

    const kinds = prisma.category.create.mock.calls.map(([args]) => (args as { data: { kind: string } }).data.kind);
    expect(kinds).toEqual(['FOOD', 'OTHER', 'OTHER']);
  });

  it('creates a product without a typed slug at the end of its category', async () => {
    const { svc, prisma } = withProduct();
    prisma.product.aggregate.mockResolvedValue({ _max: { sortOrder: 2 } });

    await svc.createProduct({ brandId: 'b1', categoryId: 'cat-a', name: 'Флэт уайт', basePriceCents: 4000 }, ['b1']);

    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slug: 'flet-uayt', sortOrder: 3, basePriceCents: 4000 }),
      }),
    );
  });

  // A shawarma added to «Шаурма» starts at 15 minutes with the sauces of the category.
  it("starts a new product from its category's prep time and option set", async () => {
    const { svc, prisma } = withProduct();
    prisma.category.findUnique.mockResolvedValue({ brandId: 'b1', defaultPrepTimeSeconds: 900 });
    prisma.categoryOption.findMany.mockResolvedValue([
      {
        kind: 'MODIFIER',
        variationType: null,
        name: 'Чесночный соус',
        priceDeltaCents: 300,
        group: 'Соусы',
        isDefault: false,
        maxCount: 1,
        ingredientId: 'ing-garlic',
      },
    ]);
    prisma.product.findMany.mockResolvedValue([{ id: 'new-product', variations: [], modifiers: [] }]);
    const modifierCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    Object.assign(prisma.modifier, { createMany: modifierCreateMany });

    await svc.createProduct({ brandId: 'b1', categoryId: 'cat-a', name: 'Шаурма', basePriceCents: 9000 }, ['b1']);

    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ prepTimeSeconds: 900 }) }),
    );
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['new-product'] }, categoryId: 'cat-a' } }),
    );
    expect(modifierCreateMany).toHaveBeenCalledWith({
      data: [
        {
          productId: 'new-product',
          slug: 'chesnochnyy-sous',
          name: 'Чесночный соус',
          priceDeltaCents: 300,
          group: 'Соусы',
          maxCount: 1,
          ingredientId: 'ing-garlic',
          sortOrder: 0,
        },
      ],
    });
  });

  it('keeps a typed prep time, and can leave the category set off', async () => {
    const { svc, prisma } = withProduct();
    prisma.category.findUnique.mockResolvedValue({ brandId: 'b1', defaultPrepTimeSeconds: 900 });

    await svc.createProduct(
      { brandId: 'b1', categoryId: 'cat-a', name: 'Шаурма', basePriceCents: 9000, prepTimeSeconds: 600 },
      ['b1'],
    );
    await svc.createProduct(
      { brandId: 'b1', categoryId: 'cat-a', name: 'Голая', basePriceCents: 9000, applyCategoryOptions: false },
      ['b1'],
    );

    const data = prisma.product.create.mock.calls.map(([args]) => (args as { data: Record<string, unknown> }).data);
    expect(data[0]?.['prepTimeSeconds']).toBe(600);
    expect(data[1]?.['prepTimeSeconds']).toBeUndefined();
    expect(data[1]).not.toHaveProperty('applyCategoryOptions');
    // Only the first create looked at the category's set.
    expect(prisma.categoryOption.findMany).toHaveBeenCalledTimes(1);
  });

  it('answers a taken product slug with 409', async () => {
    const { svc, prisma } = withProduct();
    prisma.product.create.mockRejectedValue({ code: 'P2002' });

    const err = await rejection(
      svc.createProduct({ brandId: 'b1', categoryId: 'cat-a', slug: 'latte', name: 'Латте', basePriceCents: 1 }, [
        'b1',
      ]),
    );

    expect(body(err)).toMatchObject({ code: 'SLUG_TAKEN' });
  });

  it('sends a product moved to another category to the end of it', async () => {
    const { svc, prisma } = withProduct();
    prisma.product.aggregate.mockResolvedValue({ _max: { sortOrder: 9 } });

    await svc.updateProduct('p1', { categoryId: 'cat-b' }, ['b1']);

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { categoryId: 'cat-b', sortOrder: 10 },
      include: { stores: { select: { storeId: true } } },
    });
  });

  it('leaves the position alone when the category does not change', async () => {
    const { svc, prisma } = withProduct();

    await svc.updateProduct('p1', { categoryId: 'cat-a', name: 'Латте' }, ['b1']);

    expect(prisma.product.aggregate).not.toHaveBeenCalled();
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { categoryId: 'cat-a', name: 'Латте' },
      include: { stores: { select: { storeId: true } } },
    });
  });

  it('drops the cart lines of a deleted product and re-totals those carts', async () => {
    const { svc, prisma } = withProduct();
    prisma.cartItem.findMany
      .mockResolvedValueOnce([
        { id: 'line-1', cartId: 'cart-1' },
        { id: 'line-2', cartId: 'cart-2' },
      ])
      // What stays in cart-1 and cart-2 afterwards.
      .mockResolvedValueOnce([{ unitPriceCents: 2500, quantity: 2 }])
      .mockResolvedValueOnce([]);

    await svc.deleteProduct('p1', ['b1']);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['line-1', 'line-2'] } } });
    expect(prisma.cart.update).toHaveBeenCalledWith({ where: { id: 'cart-1' }, data: { subtotalCents: 5000 } });
    expect(prisma.cart.update).toHaveBeenCalledWith({
      where: { id: 'cart-2' },
      data: { subtotalCents: 0, etaSeconds: 0 },
    });
    expect(prisma.product.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
  });

  it('tries again when a cart grabbed the product during the delete', async () => {
    const { svc, prisma } = withProduct();
    prisma.product.delete.mockRejectedValueOnce({ code: 'P2003' }).mockResolvedValueOnce({});

    await svc.deleteProduct('p1', ['b1']);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('reorders products of one category and nothing else', async () => {
    const { svc, prisma } = build();
    prisma.product.findMany.mockResolvedValue([
      { brandId: 'b1', categoryId: 'cat-a' },
      { brandId: 'b1', categoryId: 'cat-a' },
    ]);

    await svc.reorderProducts({ orderedIds: ['p2', 'p1'] }, ['b1']);
    expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: 'p2' }, data: { sortOrder: 0 } });
    expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { sortOrder: 1 } });

    prisma.product.findMany.mockResolvedValue([
      { brandId: 'b1', categoryId: 'cat-a' },
      { brandId: 'b1', categoryId: 'cat-b' },
    ]);
    const err = await rejection(svc.reorderProducts({ orderedIds: ['p1', 'p3'] }, ['b1']));
    expect(body(err)).toMatchObject({ code: 'MIXED_CATEGORIES' });

    prisma.product.findMany.mockResolvedValue([
      { brandId: 'b2', categoryId: 'cat-z' },
      { brandId: 'b2', categoryId: 'cat-z' },
    ]);
    await expect(svc.reorderProducts({ orderedIds: ['r1', 'r2'] }, ['b1'])).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AdminCatalogService — options', () => {
  function withOptions() {
    const built = build();
    built.prisma.product.findUnique.mockResolvedValue({
      id: 'p1',
      brandId: 'b1',
      categoryId: 'c1',
      variations: [],
      modifiers: [],
      stores: [],
    });
    built.prisma.variation.findUnique.mockResolvedValue({ productId: 'p1', type: 'SIZE', product: { brandId: 'b1' } });
    built.prisma.modifier.findUnique.mockResolvedValue({
      productId: 'p1',
      minCount: 0,
      maxCount: 3,
      product: { brandId: 'b1' },
    });
    return built;
  }

  it('keeps one default variation per type', async () => {
    const { svc, prisma } = withOptions();

    await svc.createVariation('p1', { type: 'SIZE', name: 'Большой', isDefault: true }, ['b1']);
    expect(prisma.variation.updateMany).toHaveBeenCalledWith({
      where: { productId: 'p1', type: 'SIZE', isDefault: true },
      data: { isDefault: false },
    });

    prisma.variation.updateMany.mockClear();
    await svc.updateVariation('v1', { isDefault: true }, ['b1']);
    expect(prisma.variation.updateMany).toHaveBeenCalledWith({
      where: { productId: 'p1', type: 'SIZE', isDefault: true, id: { not: 'v1' } },
      data: { isDefault: false },
    });
  });

  it('does not touch other defaults for an ordinary variation', async () => {
    const { svc, prisma } = withOptions();

    await svc.createVariation('p1', { type: 'MILK', name: 'Овсяное', priceDeltaCents: 500 }, ['b1']);

    expect(prisma.variation.updateMany).not.toHaveBeenCalled();
    expect(prisma.variation.create).toHaveBeenCalledWith({
      data: {
        productId: 'p1',
        type: 'MILK',
        name: 'Овсяное',
        priceDeltaCents: 500,
        sortOrder: 0,
        ingredientId: 'ing-Овсяное',
      },
    });
  });

  it('puts a new milk in the ingredient library, but not a new size', async () => {
    const { svc, prisma } = withOptions();

    await svc.createVariation('p1', { type: 'MILK', name: ' Овсяное ' }, ['b1']);
    await svc.createVariation('p1', { type: 'SIZE', name: 'Большой' }, ['b1']);

    expect(prisma.ingredient.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.ingredient.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { brandId_name: { brandId: 'b1', name: 'Овсяное' } },
        create: { brandId: 'b1', name: 'Овсяное', priceCents: 0, group: null },
      }),
    );
    expect(prisma.variation.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ name: 'Большой', ingredientId: undefined }),
    });
  });

  it('links a new extra to the library entry of the same name', async () => {
    const { svc, prisma } = withOptions();

    await svc.createModifier('p1', { name: 'Ванильный сироп' }, ['b1']);

    expect(prisma.modifier.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Ванильный сироп', ingredientId: 'ing-Ванильный сироп' }),
    });
  });

  // «Добавки» is the one place an add-on is defined: picking it is enough.
  it('puts an add-on picked from the library on a product at its name and usual price', async () => {
    const { svc, prisma } = withOptions();
    prisma.ingredient.findFirst.mockResolvedValue({ id: 'ing-vanilla', name: 'Ванильный сироп', priceCents: 500 });

    await svc.createModifier('p1', { ingredientId: 'ing-vanilla', maxCount: 2 }, ['b1']);

    expect(prisma.ingredient.upsert).not.toHaveBeenCalled();
    expect(prisma.modifier.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Ванильный сироп',
        slug: 'vanilnyy-sirop',
        priceDeltaCents: 500,
        maxCount: 2,
        ingredientId: 'ing-vanilla',
      }),
    });
  });

  it('keeps a price typed for this product over the usual one', async () => {
    const { svc, prisma } = withOptions();
    prisma.ingredient.findFirst.mockResolvedValue({ id: 'ing-shot', name: 'Шот', priceCents: 1000 });

    await svc.createModifier('p1', { ingredientId: 'ing-shot', priceDeltaCents: 1500 }, ['b1']);

    expect(prisma.modifier.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Шот', priceDeltaCents: 1500 }),
    });
  });

  it('files a new typed extra in the library at the price it was given', async () => {
    const { svc, prisma } = withOptions();

    await svc.createModifier('p1', { name: 'Карамельный сироп', priceDeltaCents: 700 }, ['b1']);

    expect(prisma.ingredient.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { brandId: 'b1', name: 'Карамельный сироп', priceCents: 700, group: null } }),
    );
    expect(prisma.modifier.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ priceDeltaCents: 700, ingredientId: 'ing-Карамельный сироп' }),
    });
  });

  it('charges the usual price when a typed extra matches a library entry and no price was given', async () => {
    const { svc, prisma } = withOptions();
    prisma.ingredient.upsert.mockResolvedValueOnce({ id: 'ing-oat', name: 'Овсяное', priceCents: 600 });

    await svc.createVariation('p1', { type: 'MILK', name: 'Овсяное' }, ['b1']);

    expect(prisma.variation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Овсяное', priceDeltaCents: 600, ingredientId: 'ing-oat' }),
    });
  });

  // «Ваниль» from the library lands under «Сиропы» without anyone typing it.
  it("puts an extra picked from the library in the library entry's group, unless another is asked for", async () => {
    const { svc, prisma } = withOptions();
    prisma.ingredient.findFirst.mockResolvedValue({
      id: 'ing-vanilla',
      name: 'Ваниль',
      priceCents: 500,
      group: 'Сиропы',
    });

    await svc.createModifier('p1', { ingredientId: 'ing-vanilla' }, ['b1']);
    await svc.createModifier('p1', { ingredientId: 'ing-vanilla', group: 'Топпинги' }, ['b1']);
    await svc.createModifier('p1', { ingredientId: 'ing-vanilla', group: null }, ['b1']);

    expect(
      prisma.modifier.create.mock.calls.map(([args]) => (args as { data: { group: unknown } }).data.group),
    ).toEqual(['Сиропы', 'Топпинги', null]);
  });

  it('files a new typed extra in the library together with its group', async () => {
    const { svc, prisma } = withOptions();

    await svc.createModifier('p1', { name: 'Без лука', group: 'Убрать' }, ['b1']);

    expect(prisma.ingredient.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { brandId: 'b1', name: 'Без лука', priceCents: 0, group: 'Убрать' } }),
    );
    expect(prisma.modifier.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Без лука', group: 'Убрать' }),
    });
  });

  it('leaves an extra untracked when asked to', async () => {
    const { svc, prisma } = withOptions();

    await svc.createModifier('p1', { name: 'Корица', ingredientId: null }, ['b1']);

    expect(prisma.ingredient.upsert).not.toHaveBeenCalled();
    expect(prisma.modifier.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ingredientId: null }),
    });
  });

  it("refuses to link an option to another brand's ingredient", async () => {
    const { svc, prisma } = withOptions();
    prisma.ingredient.findFirst.mockResolvedValue(null);

    const err = await rejection(svc.updateModifier('m1', { ingredientId: 'ing-foreign' }, ['b1']));

    expect(err).toBeInstanceOf(BadRequestException);
    expect(body(err)['code']).toBe('INGREDIENT_UNKNOWN');
    expect(prisma.ingredient.findFirst).toHaveBeenCalledWith({
      where: { id: 'ing-foreign', brandId: 'b1' },
      select: { id: true, name: true, priceCents: true, group: true },
    });
    expect(prisma.modifier.update).not.toHaveBeenCalled();
  });

  it('keeps the link of an extra that is only renamed', async () => {
    const { svc, prisma } = withOptions();

    await svc.updateModifier('m1', { name: 'Сироп ваниль' }, ['b1']);

    expect(prisma.ingredient.upsert).not.toHaveBeenCalled();
    expect(prisma.modifier.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { name: 'Сироп ваниль', ingredientId: undefined },
    });
  });

  it("refuses to edit another brand's variation", async () => {
    const { svc, prisma } = withOptions();

    await expect(svc.updateVariation('v1', { name: 'x' }, ['b2'])).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.variation.update).not.toHaveBeenCalled();
  });

  it('drops the cart lines priced with a deleted variation', async () => {
    const { svc, prisma } = withOptions();
    prisma.cartItem.findMany.mockResolvedValueOnce([{ id: 'line-1', cartId: 'cart-1' }]).mockResolvedValueOnce([]);

    await svc.deleteVariation('v1', ['b1']);

    expect(prisma.cartItem.findMany).toHaveBeenNthCalledWith(1, {
      where: { productId: 'p1', variationIds: { has: 'v1' } },
      select: { id: true, cartId: true },
    });
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['line-1'] } } });
    expect(prisma.variation.delete).toHaveBeenCalledWith({ where: { id: 'v1' } });
  });

  it('creates «Ванильный сироп» — a name the old Latin-only slug could not', async () => {
    const { svc, prisma } = withOptions();

    await svc.createModifier('p1', { name: 'Ванильный сироп', priceDeltaCents: 500, maxCount: 3 }, ['b1']);

    expect(prisma.modifier.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productId: 'p1', slug: 'vanilnyy-sirop', maxCount: 3, sortOrder: 0 }),
    });
  });

  it('refuses a minimum above the maximum, also against the stored values', async () => {
    const { svc, prisma } = withOptions();

    const created = await rejection(svc.createModifier('p1', { name: 'Шот', minCount: 2, maxCount: 1 }, ['b1']));
    expect(body(created)).toMatchObject({ code: 'MODIFIER_RANGE' });

    const updated = await rejection(svc.updateModifier('m1', { minCount: 4 }, ['b1']));
    expect(body(updated)).toMatchObject({ code: 'MODIFIER_RANGE' });
    expect(prisma.modifier.update).not.toHaveBeenCalled();

    await svc.updateModifier('m1', { minCount: 1, maxCount: 5 }, ['b1']);
    expect(prisma.modifier.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { minCount: 1, maxCount: 5 } });
  });

  it('drops only the cart lines that carry a deleted modifier', async () => {
    const { svc, prisma } = withOptions();
    prisma.cartItem.findMany
      .mockResolvedValueOnce([
        { id: 'with', cartId: 'cart-1', modifiersJson: { m1: 2 } },
        { id: 'without', cartId: 'cart-1', modifiersJson: { m2: 1 } },
        { id: 'zero', cartId: 'cart-2', modifiersJson: { m1: 0 } },
      ])
      .mockResolvedValueOnce([{ unitPriceCents: 3000, quantity: 1 }]);

    await svc.deleteModifier('m1', ['b1']);

    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['with'] } } });
    expect(prisma.cart.update).toHaveBeenCalledTimes(1);
    expect(prisma.modifier.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });
});
