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
        create: jest.fn((args: unknown) => Promise.resolve(args)),
        update: jest.fn((args: unknown) => Promise.resolve(args)),
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', brandId: 'own', variations: [], modifiers: [] }),
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: null } }),
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
