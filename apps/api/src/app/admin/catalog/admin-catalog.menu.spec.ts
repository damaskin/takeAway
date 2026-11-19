import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import type { PasswordService } from '../../auth/services/password.service';
import { optionGroupsStub } from '../../option-groups/testing/option-groups.stub';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StoreAvailabilityNotifier } from '../../realtime/store-availability.notifier';
import { AdminCatalogService } from './admin-catalog.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/admin-category.dto';
import { CreateProductDto, UpdateProductDto } from './dto/admin-product.dto';

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
    cartItem: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    cart: { update: jest.fn().mockResolvedValue({}) },
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
    optionGroupsStub({ p1: [], 'new-product': [] }),
  );
  return { svc, prisma };
}

describe('menu DTOs', () => {
  async function errors<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
    const found = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
    return found.map((e) => e.property);
  }

  it('takes a category kind and default prep time', async () => {
    const base = { brandId: 'b1', name: 'Шаурма' };
    expect(await errors(CreateCategoryDto, { ...base, kind: 'FOOD', defaultPrepTimeSeconds: 900 })).toEqual([]);
    expect(await errors(UpdateCategoryDto, { defaultPrepTimeSeconds: null })).toEqual([]);
    expect(await errors(CreateCategoryDto, { ...base, kind: 'PIZZA' })).toEqual(['kind']);
    expect(await errors(CreateCategoryDto, { ...base, defaultPrepTimeSeconds: -1 })).toEqual([
      'defaultPrepTimeSeconds',
    ]);
  });

  it('lets the slug be left out of every create', async () => {
    expect(await errors(CreateCategoryDto, { brandId: 'b1', name: 'Десерты' })).toEqual([]);
    expect(
      await errors(CreateProductDto, { brandId: 'b1', categoryId: 'c1', name: 'Латте', basePriceCents: 3500 }),
    ).toEqual([]);
  });

  // Retired on 2026-11-05: the columns stay, but nobody may write them any more.
  it('refuses caffeine, allergens and diet tags on a product', async () => {
    const base = { brandId: 'b1', categoryId: 'c1', name: 'Латте', basePriceCents: 3500 };
    expect(await errors(CreateProductDto, { ...base, calories: 120, proteinsGrams: 4.5 })).toEqual([]);
    expect(await errors(CreateProductDto, { ...base, caffeineLevel: 2 })).toEqual(['caffeineLevel']);
    expect(await errors(UpdateProductDto, { allergens: ['MILK'] })).toEqual(['allergens']);
    expect(await errors(UpdateProductDto, { dietTags: ['VEGAN'] })).toEqual(['dietTags']);
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
  // A meal, so calories and nutrition are kept (see the tests on them below).
  const product = {
    id: 'p1',
    brandId: 'b1',
    categoryId: 'cat-a',
    category: { name: 'Шаурма', kind: 'FOOD' },
    stores: [],
  };

  function withProduct() {
    const built = build();
    built.prisma.category.findUnique.mockResolvedValue({ brandId: 'b1', kind: 'FOOD' });
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

  // A shawarma added to «Шаурма» starts at 15 minutes; it has no options yet, so customers do not see it.
  it("starts a new product from its category's prep time, not yet shown to customers", async () => {
    const { svc, prisma } = withProduct();
    prisma.category.findUnique.mockResolvedValue({ brandId: 'b1', defaultPrepTimeSeconds: 900, kind: 'FOOD' });

    const created = await svc.createProduct(
      { brandId: 'b1', categoryId: 'cat-a', name: 'Шаурма', basePriceCents: 9000 },
      ['b1'],
    );

    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ prepTimeSeconds: 900 }) }),
    );
    expect(created.optionsComplete).toBe(false);
  });

  it('says whether the options of each product let customers see it', async () => {
    const built = build();
    const svc = new AdminCatalogService(
      built.prisma as unknown as PrismaService,
      {} as PasswordService,
      {} as StoreAvailabilityNotifier,
      optionGroupsStub({ bare: [] }),
    );
    built.prisma.product.findMany.mockResolvedValue([
      { id: 'latte', brandId: 'b1', stores: [] },
      { id: 'bare', brandId: 'b1', stores: [] },
    ]);
    built.prisma.product.findUnique.mockResolvedValue({ id: 'bare', brandId: 'b1', stores: [] });

    const list = await svc.listProducts(['b1'], 'b1');

    expect(list.map((p) => [p.id, p.optionsComplete])).toEqual([
      ['latte', true],
      ['bare', false],
    ]);
    expect((await svc.getProduct('bare', ['b1'])).optionsComplete).toBe(false);
  });

  it("keeps a typed prep time, and can leave the category's off", async () => {
    const { svc, prisma } = withProduct();
    prisma.category.findUnique.mockResolvedValue({ brandId: 'b1', defaultPrepTimeSeconds: 900, kind: 'FOOD' });

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

  // Calories and nutrition are a meal's since 2026-11-06.
  describe('calories and nutrition', () => {
    const nutrition = { calories: 450, proteinsGrams: 20, fatsGrams: 18.5, carbsGrams: 40 };
    const none = { calories: null, proteinsGrams: null, fatsGrams: null, carbsGrams: null };
    const written = (mock: jest.Mock) => (mock.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;

    it('stores them for a new meal and leaves them out for a new drink', async () => {
      const { svc, prisma } = withProduct();
      await svc.createProduct(
        { brandId: 'b1', categoryId: 'cat-a', name: 'Шаурма', basePriceCents: 9000, ...nutrition },
        ['b1'],
      );
      expect(written(prisma.product.create)).toMatchObject(nutrition);

      prisma.product.create.mockClear();
      prisma.category.findUnique.mockResolvedValue({ brandId: 'b1', kind: 'HOT_DRINKS' });
      await svc.createProduct(
        { brandId: 'b1', categoryId: 'cat-coffee', name: 'Латте', basePriceCents: 3500, ...nutrition },
        ['b1'],
      );
      expect(written(prisma.product.create)).toMatchObject(none);
    });

    it('keeps them when a meal is saved', async () => {
      const { svc, prisma } = withProduct();
      await svc.updateProduct('p1', { name: 'Шаурма XL', calories: 600 }, ['b1']);
      expect(written(prisma.product.update)).toEqual({ name: 'Шаурма XL', calories: 600 });
    });

    it('clears them when a product that is not a meal is saved, whatever was sent', async () => {
      for (const kind of ['HOT_DRINKS', 'COLD_DRINKS', 'BAKERY', 'OTHER']) {
        const { svc, prisma } = withProduct();
        prisma.product.findUnique.mockResolvedValue({ ...product, category: { name: 'Напитки', kind } });
        await svc.updateProduct('p1', { name: 'Латте', calories: 120 }, ['b1']);
        expect(written(prisma.product.update)).toEqual({ name: 'Латте', ...none });
      }
    });

    it('goes by the category the product is moved to', async () => {
      const { svc, prisma } = withProduct();
      prisma.category.findUnique.mockResolvedValue({ brandId: 'b1', kind: 'BAKERY' });
      await svc.updateProduct('p1', { categoryId: 'cat-bakery' }, ['b1']);
      expect(written(prisma.product.update)).toMatchObject({ categoryId: 'cat-bakery', ...none });

      const back = withProduct();
      back.prisma.product.findUnique.mockResolvedValue({ ...product, category: { name: 'Выпечка', kind: 'BAKERY' } });
      await back.svc.updateProduct('p1', { categoryId: 'cat-a', ...nutrition }, ['b1']);
      expect(written(back.prisma.product.update)).toMatchObject({ categoryId: 'cat-a', ...nutrition });
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
