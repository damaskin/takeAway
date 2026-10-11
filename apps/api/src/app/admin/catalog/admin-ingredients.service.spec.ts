import { ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import type { PrismaService } from '../../prisma/prisma.service';
import { AdminIngredientsService } from './admin-ingredients.service';
import { CreateIngredientDto } from './dto/admin-ingredient.dto';

const VANILLA = { brandId: 'b1', name: 'Ванильный сироп', priceCents: 500 };

function row(patch: Record<string, unknown> = {}) {
  return {
    id: 'ing-vanilla',
    ...VANILLA,
    isAvailable: true,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    modifiers: [],
    variations: [],
    ...patch,
  };
}

/** Just enough of Prisma for the library; `$transaction` runs the callback against the same fakes. */
function build() {
  const prisma = {
    ingredient: {
      findUnique: jest.fn().mockResolvedValue(VANILLA),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(row(data))),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(row(data))),
      delete: jest.fn().mockResolvedValue({}),
    },
    modifier: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    variation: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    cartItem: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    cart: { update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
  return { svc: new AdminIngredientsService(prisma as unknown as PrismaService), prisma };
}

describe('AdminIngredientsService — the add-ons library', () => {
  it('accepts a price with a new add-on, in minor units and never below zero', async () => {
    const errors = async (plain: Record<string, unknown>) =>
      (
        await validate(plainToInstance(CreateIngredientDto, plain), { whitelist: true, forbidNonWhitelisted: true })
      ).map((e) => e.property);

    expect(await errors({ brandId: 'b1', name: 'Шот', priceCents: 1000 })).toEqual([]);
    expect(await errors({ brandId: 'b1', name: 'Шот' })).toEqual([]);
    expect(await errors({ brandId: 'b1', name: 'Шот', priceCents: -1 })).toEqual(['priceCents']);
    expect(await errors({ brandId: 'b1', name: 'Шот', priceCents: 10.5 })).toEqual(['priceCents']);
  });

  it('creates an add-on with its usual price on the brand picked in the admin', async () => {
    const { svc, prisma } = build();

    const created = await svc.create({ brandId: 'b1', name: 'Шот эспрессо', priceCents: 1000 }, ['b1']);

    expect(prisma.ingredient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { brandId: 'b1', name: 'Шот эспрессо', priceCents: 1000, isAvailable: true },
      }),
    );
    expect(created).toMatchObject({ name: 'Шот эспрессо', priceCents: 1000, products: [] });
  });

  it('lets a platform admin with any brand selected add to that brand', async () => {
    const { svc, prisma } = build();

    await svc.create({ brandId: 'b7', name: 'Корица' }, null);

    expect(prisma.ingredient.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brandId: 'b7', priceCents: 0 }) }),
    );
  });

  it("refuses to add to a brand outside the caller's scope", async () => {
    const { svc, prisma } = build();

    await expect(svc.create({ brandId: 'b2', name: 'Корица' }, ['b1'])).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.ingredient.create).not.toHaveBeenCalled();
  });

  it('answers a name already in the library with 409 INGREDIENT_NAME_TAKEN', async () => {
    const { svc, prisma } = build();
    prisma.ingredient.create.mockRejectedValueOnce({ code: 'P2002' });

    await expect(svc.create({ brandId: 'b1', name: 'Ванильный сироп' }, ['b1'])).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('lists every product that offers an add-on, once each, by name', async () => {
    const { svc, prisma } = build();
    const latte = { product: { id: 'p-latte', name: 'Латте' } };
    const cappuccino = { product: { id: 'p-cap', name: 'Капучино' } };
    prisma.ingredient.findMany.mockResolvedValue([row({ modifiers: [latte, cappuccino], variations: [latte] })]);

    const [entry] = await svc.list(['b1'], 'b1');

    expect(entry?.products).toEqual([
      { id: 'p-cap', name: 'Капучино' },
      { id: 'p-latte', name: 'Латте' },
    ]);
  });

  describe('update', () => {
    it('renames the options that still carry the old name, and only those', async () => {
      const { svc, prisma } = build();

      await svc.update('ing-vanilla', { name: 'Сироп «Ваниль»' }, ['b1']);

      const rename = {
        where: { ingredientId: 'ing-vanilla', name: 'Ванильный сироп' },
        data: { name: 'Сироп «Ваниль»' },
      };
      expect(prisma.modifier.updateMany).toHaveBeenCalledWith(rename);
      expect(prisma.variation.updateMany).toHaveBeenCalledWith(rename);
      expect(prisma.modifier.updateMany).toHaveBeenCalledTimes(1);
    });

    it('moves the options still at the old price to the new one; a product with its own price keeps it', async () => {
      const { svc, prisma } = build();

      await svc.update('ing-vanilla', { priceCents: 700 }, ['b1']);

      const reprice = {
        where: { ingredientId: 'ing-vanilla', priceDeltaCents: 500 },
        data: { priceDeltaCents: 700 },
      };
      expect(prisma.modifier.updateMany).toHaveBeenCalledWith(reprice);
      expect(prisma.variation.updateMany).toHaveBeenCalledWith(reprice);
    });

    it('leaves the options alone when only the stock switch moves', async () => {
      const { svc, prisma } = build();

      const updated = await svc.update('ing-vanilla', { isAvailable: false }, ['b1']);

      expect(updated.isAvailable).toBe(false);
      expect(prisma.modifier.updateMany).not.toHaveBeenCalled();
      expect(prisma.variation.updateMany).not.toHaveBeenCalled();
    });

    it("refuses another brand's add-on", async () => {
      const { svc, prisma } = build();
      prisma.ingredient.findUnique.mockResolvedValue({ ...VANILLA, brandId: 'b2' });

      await expect(svc.update('ing-vanilla', { name: 'X' }, ['b1'])).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ingredient.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('takes the add-on off every product, with the cart lines made with it', async () => {
      const { svc, prisma } = build();
      prisma.modifier.findMany.mockResolvedValue([
        { id: 'm-latte', productId: 'p-latte' },
        { id: 'm-cap', productId: 'p-cap' },
      ]);
      prisma.variation.findMany.mockResolvedValue([{ id: 'v-raf', productId: 'p-raf' }]);
      prisma.cartItem.findMany
        .mockResolvedValueOnce([
          { id: 'ci-with', cartId: 'cart-1', variationIds: [], modifiersJson: { 'm-latte': 2 } },
          { id: 'ci-without', cartId: 'cart-1', variationIds: [], modifiersJson: { 'm-other': 1 } },
          { id: 'ci-milk', cartId: 'cart-2', variationIds: ['v-raf'], modifiersJson: {} },
        ])
        // What is left in each cart, for the new subtotal.
        .mockResolvedValue([{ unitPriceCents: 4500, quantity: 1 }]);

      await svc.delete('ing-vanilla', ['b1']);

      expect(prisma.cartItem.findMany).toHaveBeenNthCalledWith(1, {
        where: { productId: { in: ['p-latte', 'p-cap', 'p-raf'] } },
        select: { id: true, cartId: true, variationIds: true, modifiersJson: true },
      });
      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['ci-with', 'ci-milk'] } } });
      expect(prisma.cart.update).toHaveBeenCalledTimes(2);
      expect(prisma.modifier.deleteMany).toHaveBeenCalledWith({ where: { ingredientId: 'ing-vanilla' } });
      expect(prisma.variation.deleteMany).toHaveBeenCalledWith({ where: { ingredientId: 'ing-vanilla' } });
      expect(prisma.ingredient.delete).toHaveBeenCalledWith({ where: { id: 'ing-vanilla' } });
    });

    it('deletes an add-on no product uses without touching options or carts', async () => {
      const { svc, prisma } = build();

      await svc.delete('ing-vanilla', ['b1']);

      expect(prisma.cartItem.findMany).not.toHaveBeenCalled();
      expect(prisma.modifier.deleteMany).not.toHaveBeenCalled();
      expect(prisma.ingredient.delete).toHaveBeenCalledWith({ where: { id: 'ing-vanilla' } });
    });

    it("refuses another brand's add-on", async () => {
      const { svc, prisma } = build();
      prisma.ingredient.findUnique.mockResolvedValue({ ...VANILLA, brandId: 'b2' });

      await expect(svc.delete('ing-vanilla', ['b1'])).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ingredient.delete).not.toHaveBeenCalled();
    });
  });
});
