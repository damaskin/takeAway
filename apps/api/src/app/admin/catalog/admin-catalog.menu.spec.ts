import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import type { PasswordService } from '../../auth/services/password.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { AdminCatalogService } from './admin-catalog.service';
import { CreateCategoryDto } from './dto/admin-category.dto';
import { CreateModifierDto, CreateProductDto } from './dto/admin-product.dto';

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
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'new-product', ...data })),
      update: jest.fn((args: unknown) => Promise.resolve(args)),
      delete: jest.fn().mockResolvedValue({}),
    },
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
  const svc = new AdminCatalogService(prisma as unknown as PrismaService, {} as PasswordService);
  return { svc, prisma };
}

describe('menu DTOs', () => {
  async function errors<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
    const found = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
    return found.map((e) => e.property);
  }

  it('lets the slug be left out of every create', async () => {
    expect(await errors(CreateCategoryDto, { brandId: 'b1', name: 'Десерты' })).toEqual([]);
    expect(
      await errors(CreateProductDto, { brandId: 'b1', categoryId: 'c1', name: 'Латте', basePriceCents: 3500 }),
    ).toEqual([]);
    expect(await errors(CreateModifierDto, { name: 'Ванильный сироп' })).toEqual([]);
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
  const product = { id: 'p1', brandId: 'b1', categoryId: 'cat-a', variations: [], modifiers: [] };

  function withProduct() {
    const built = build();
    built.prisma.category.findUnique.mockResolvedValue({ brandId: 'b1' });
    built.prisma.product.findUnique.mockResolvedValue(product);
    return built;
  }

  it('creates a product without a typed slug at the end of its category', async () => {
    const { svc, prisma } = withProduct();
    prisma.product.aggregate.mockResolvedValue({ _max: { sortOrder: 2 } });

    await svc.createProduct({ brandId: 'b1', categoryId: 'cat-a', name: 'Флэт уайт', basePriceCents: 4000 }, ['b1']);

    expect(prisma.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ slug: 'flet-uayt', sortOrder: 3, basePriceCents: 4000 }),
    });
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
    });
  });

  it('leaves the position alone when the category does not change', async () => {
    const { svc, prisma } = withProduct();

    await svc.updateProduct('p1', { categoryId: 'cat-a', name: 'Латте' }, ['b1']);

    expect(prisma.product.aggregate).not.toHaveBeenCalled();
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { categoryId: 'cat-a', name: 'Латте' },
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
      data: { productId: 'p1', type: 'MILK', name: 'Овсяное', priceDeltaCents: 500, sortOrder: 0 },
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
