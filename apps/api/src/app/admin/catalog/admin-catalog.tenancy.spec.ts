import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import type { PasswordService } from '../../auth/services/password.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { AdminCatalogService } from './admin-catalog.service';
import { UpdateCategoryDto } from './dto/admin-category.dto';
import { UpdateProductDto } from './dto/admin-product.dto';
import { UpdateStoreDto } from './dto/admin-store.dto';

/** Category ids are public; a brand must still not file products under someone else's. */
describe('AdminCatalogService — brand boundaries', () => {
  const categories: Record<string, { brandId: string }> = {
    'own-cat': { brandId: 'own' },
    'rival-cat': { brandId: 'rival' },
  };

  function build() {
    const prisma = {
      category: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve(categories[where.id] ?? null)),
      },
      product: {
        create: jest.fn(({ data }: { data: object }) => Promise.resolve({ ...data, stores: [] })),
        update: jest.fn(({ data }: { data: object }) => Promise.resolve({ ...data, stores: [] })),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'p1', brandId: 'own', variations: [], modifiers: [], stores: [] }),
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: null } }),
      },
      store: {
        findMany: jest.fn().mockResolvedValue([{ id: 'own-store' }]),
      },
    };
    const svc = new AdminCatalogService(prisma as unknown as PrismaService, {} as PasswordService);
    return { svc, prisma };
  }

  const product = { brandId: 'own', slug: 'latte', name: 'Латте', basePriceCents: 2000 };

  it("refuses to create a product in a competitor's category", async () => {
    const { svc, prisma } = build();
    await expect(svc.createProduct({ ...product, categoryId: 'rival-cat' } as never, ['own'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('creates it in its own category', async () => {
    const { svc, prisma } = build();
    await svc.createProduct({ ...product, categoryId: 'own-cat' } as never, ['own']);
    expect(prisma.product.create).toHaveBeenCalled();
  });

  it("refuses to move a product into a competitor's category", async () => {
    const { svc, prisma } = build();
    await expect(svc.updateProduct('p1', { categoryId: 'rival-cat' }, ['own'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});

/** A store id is guessable too; a product must only ever be listed in its own brand's stores. */
describe('AdminCatalogService — store listing boundaries', () => {
  function build() {
    const prisma = {
      category: { findUnique: jest.fn().mockResolvedValue({ brandId: 'own' }) },
      product: {
        create: jest.fn(({ data }: { data: object }) => Promise.resolve({ ...data, stores: [] })),
        update: jest.fn(({ data }: { data: object }) => Promise.resolve({ ...data, stores: [] })),
        findUnique: jest.fn().mockResolvedValue({
          id: 'p1',
          brandId: 'own',
          categoryId: 'own-cat',
          variations: [],
          modifiers: [],
          stores: [],
        }),
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: null } }),
        count: jest.fn().mockResolvedValue(0),
      },
      store: { findMany: jest.fn().mockResolvedValue([{ id: 'burgers' }, { id: 'pizza' }]) },
    };
    const svc = new AdminCatalogService(prisma as unknown as PrismaService, {} as PasswordService);
    return { svc, prisma };
  }

  const product = { brandId: 'own', categoryId: 'own-cat', name: 'Бургер', basePriceCents: 2000 };
  const written = (mock: jest.Mock) => (mock.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;

  it('lists a new product in every store of the brand when no stores were picked', async () => {
    const { svc, prisma } = build();
    await svc.createProduct(product, ['own']);
    expect(written(prisma.product.create)['stores']).toEqual({
      create: [{ storeId: 'burgers' }, { storeId: 'pizza' }],
    });
    expect(written(prisma.product.create)).not.toHaveProperty('storeIds');
  });

  it('lists it only in the stores picked', async () => {
    const { svc, prisma } = build();
    await svc.createProduct({ ...product, storeIds: ['burgers'] }, ['own']);
    expect(written(prisma.product.create)['stores']).toEqual({ create: [{ storeId: 'burgers' }] });
  });

  it('refuses a store of another brand, on create and on update', async () => {
    const { svc, prisma } = build();
    await expect(svc.createProduct({ ...product, storeIds: ['rival-store'] }, ['own'])).rejects.toMatchObject({
      response: { code: 'STORE_UNKNOWN' },
    });
    await expect(svc.updateProduct('p1', { storeIds: ['burgers', 'rival-store'] }, ['own'])).rejects.toMatchObject({
      response: { code: 'STORE_UNKNOWN' },
    });
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('replaces the listing on update with exactly the stores sent', async () => {
    const { svc, prisma } = build();
    await svc.updateProduct('p1', { storeIds: ['pizza'] }, ['own']);
    expect(written(prisma.product.update)['stores']).toEqual({
      deleteMany: { storeId: { notIn: ['pizza'] } },
      createMany: { data: [{ storeId: 'pizza' }], skipDuplicates: true },
    });
  });

  it('leaves the listing alone when the update does not mention stores', async () => {
    const { svc, prisma } = build();
    await svc.updateProduct('p1', { name: 'Чизбургер' }, ['own']);
    expect(written(prisma.product.update)).not.toHaveProperty('stores');
  });
});

describe('update DTOs', () => {
  // The global ValidationPipe runs with `whitelist: true`: properties a DTO
  // does not declare are stripped before the service sees them.
  async function strip<T extends object>(
    cls: new () => T,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const dto = plainToInstance(cls, body);
    await validate(dto, { whitelist: true });
    return { ...dto } as Record<string, unknown>;
  }

  it('cannot move a store, category or product into another brand', async () => {
    for (const cls of [UpdateStoreDto, UpdateCategoryDto, UpdateProductDto] as const) {
      const cleaned = await strip(cls as new () => object, { brandId: 'rival', name: 'Новое имя' });
      expect(cleaned).not.toHaveProperty('brandId');
      expect(cleaned).toHaveProperty('name', 'Новое имя');
    }
  });
});
