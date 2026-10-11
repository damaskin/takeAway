import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

import type { PrismaService } from '../../prisma/prisma.service';
import { AdminCategoryOptionsService } from './admin-category-options.service';
import { AddCategoryOptionsDto } from './dto/admin-category-option.dto';

interface Row {
  id: string;
  categoryId: string;
  kind: 'VARIATION' | 'MODIFIER';
  variationType: string | null;
  name: string;
  priceDeltaCents: number;
  group: string | null;
  isDefault: boolean;
  maxCount: number;
  sortOrder: number;
  ingredientId: string | null;
  createdAt: Date;
  ingredient: null;
}

/** An in-memory category option table and library, enough to follow the service through. */
function build(initial: Array<Partial<Row>> = []) {
  let seq = 0;
  const rows: Row[] = initial.map((r) => ({
    id: `o${++seq}`,
    categoryId: 'cat-hot',
    kind: 'MODIFIER',
    variationType: null,
    name: '',
    priceDeltaCents: 0,
    group: null,
    isDefault: false,
    maxCount: 1,
    sortOrder: seq,
    ingredientId: null,
    createdAt: new Date(),
    ingredient: null,
    ...r,
  }));
  const library = new Map<string, { id: string; name: string; priceCents: number; group: string | null }>([
    ['ing-vanilla', { id: 'ing-vanilla', name: 'Ваниль', priceCents: 500, group: 'Сиропы' }],
  ]);
  const prisma = {
    category: {
      findUnique: jest.fn().mockResolvedValue({ id: 'cat-hot', brandId: 'b1', defaultPrepTimeSeconds: 180 }),
    },
    categoryOption: {
      findMany: jest.fn(() => Promise.resolve([...rows].sort((a, b) => a.sortOrder - b.sortOrder))),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
      ),
      create: jest.fn(({ data }: { data: Partial<Row> }) => {
        const row = { id: `o${++seq}`, createdAt: new Date(), ingredient: null, ...data } as Row;
        rows.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) return Promise.reject({ code: 'P2025' });
        for (const [key, value] of Object.entries(data)) if (value !== undefined) Object.assign(row, { [key]: value });
        return Promise.resolve(row);
      }),
      updateMany: jest.fn(({ where, data }: { where: Partial<Row> & { id?: { not: string } }; data: Partial<Row> }) => {
        const hit = rows.filter(
          (r) =>
            (where.variationType === undefined || r.variationType === where.variationType) &&
            (where.kind === undefined || r.kind === where.kind) &&
            (where.isDefault === undefined || r.isDefault === where.isDefault) &&
            (where.id === undefined || r.id !== where.id.not),
        );
        for (const r of hit) Object.assign(r, data);
        return Promise.resolve({ count: hit.length });
      }),
      delete: jest.fn().mockResolvedValue({}),
    },
    ingredient: {
      findFirst: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve(library.get(where.id) ?? null)),
      upsert: jest.fn(({ create }: { create: { name: string; priceCents: number; group: string | null } }) => {
        const found = [...library.values()].find((i) => i.name === create.name);
        if (found) return Promise.resolve(found);
        const entry = {
          id: `ing-${create.name}`,
          name: create.name,
          priceCents: create.priceCents,
          group: create.group,
        };
        library.set(entry.id, entry);
        return Promise.resolve(entry);
      }),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 3 }),
    },
    variation: { createMany: jest.fn() },
    modifier: { createMany: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ locked: 1 }]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((run: (tx: typeof prisma) => Promise<unknown>) => run(prisma));
  return { svc: new AdminCategoryOptionsService(prisma as unknown as PrismaService), prisma, rows, library };
}

/** The hot-drinks preset as the admin sends it after the preview: some ticks, some prices. */
const PRESET = {
  options: [
    { kind: 'VARIATION' as const, variationType: 'SIZE' as const, name: 'Маленький', isDefault: true },
    { kind: 'VARIATION' as const, variationType: 'SIZE' as const, name: 'Большой', priceDeltaCents: 1000 },
    { kind: 'VARIATION' as const, variationType: 'MILK' as const, name: 'Овсяное молоко', priceDeltaCents: 800 },
    { kind: 'MODIFIER' as const, ingredientId: 'ing-vanilla' },
    { kind: 'MODIFIER' as const, name: 'Корица', group: 'Дополнительно', priceDeltaCents: 200 },
  ],
};

describe('AdminCategoryOptionsService', () => {
  it('validates what a set option may be', async () => {
    // The innermost property that failed: `options.0.variationType` reads as `variationType`.
    const leaves = (found: ValidationError[]): string[] =>
      found.flatMap((e) => (e.children?.length ? leaves(e.children) : [e.property]));
    const errors = async (plain: Record<string, unknown>) =>
      leaves(
        await validate(plainToInstance(AddCategoryOptionsDto, plain), { whitelist: true, forbidNonWhitelisted: true }),
      );

    expect(await errors(PRESET)).toEqual([]);
    expect(await errors({ options: [] })).toEqual(['options']);
    expect(await errors({ options: [{ kind: 'VARIATION', name: 'Большой' }] })).toEqual(['variationType']);
    expect(await errors({ options: [{ kind: 'MODIFIER' }] })).toEqual(['name']);
    expect(await errors({ options: [{ kind: 'MODIFIER', name: 'X', group: 'x'.repeat(41) }] })).toEqual(['group']);
  });

  it('stores a preset: sizes untracked, milk and add-ons in the library at the price and group given', async () => {
    const { svc, prisma, library } = build();

    const set = await svc.add('cat-hot', PRESET, ['b1']);

    expect(set.map((o) => [o.kind, o.variationType, o.name, o.priceDeltaCents, o.group, o.isDefault])).toEqual([
      ['VARIATION', 'SIZE', 'Маленький', 0, null, true],
      ['VARIATION', 'SIZE', 'Большой', 1000, null, false],
      ['VARIATION', 'MILK', 'Овсяное молоко', 800, null, false],
      // Picked from the library: its name, usual price and group.
      ['MODIFIER', null, 'Ваниль', 500, 'Сиропы', false],
      ['MODIFIER', null, 'Корица', 200, 'Дополнительно', false],
    ]);
    expect(set.map((o) => o.ingredientId)).toEqual([null, null, 'ing-Овсяное молоко', 'ing-vanilla', 'ing-Корица']);
    expect(library.get('ing-Корица')).toMatchObject({ priceCents: 200, group: 'Дополнительно' });
    // A size is not stocked: it never reaches the library.
    expect(prisma.ingredient.upsert).toHaveBeenCalledTimes(2);
  });

  it('adds nothing when the same preset comes again', async () => {
    const { svc } = build();
    const first = await svc.add('cat-hot', PRESET, ['b1']);

    const second = await svc.add('cat-hot', PRESET, ['b1']);

    expect(second.map((o) => o.id)).toEqual(first.map((o) => o.id));
  });

  it('keeps one default choice per group', async () => {
    const { svc } = build([{ kind: 'VARIATION', variationType: 'SIZE', name: 'Средний', isDefault: true }]);

    const set = await svc.add(
      'cat-hot',
      { options: [{ kind: 'VARIATION', variationType: 'SIZE', name: 'Маленький', isDefault: true }] },
      ['b1'],
    );

    expect(set.filter((o) => o.isDefault).map((o) => o.name)).toEqual(['Маленький']);
  });

  it('edits the price and group of an add-on, and moves the default of a choice group', async () => {
    const { svc } = build([
      { id: 'o-small', kind: 'VARIATION', variationType: 'SIZE', name: 'Маленький', isDefault: true },
      { id: 'o-large', kind: 'VARIATION', variationType: 'SIZE', name: 'Большой' },
      { id: 'o-vanilla', kind: 'MODIFIER', name: 'Ваниль', group: 'Сиропы', priceDeltaCents: 500 },
    ]);

    await svc.update('cat-hot', 'o-vanilla', { priceDeltaCents: 700, group: null, isDefault: true }, ['b1']);
    const set = await svc.update('cat-hot', 'o-large', { isDefault: true, group: 'ignored' }, ['b1']);

    expect(set.find((o) => o.id === 'o-vanilla')).toMatchObject({
      priceDeltaCents: 700,
      group: null,
      isDefault: false,
    });
    expect(set.filter((o) => o.isDefault).map((o) => o.id)).toEqual(['o-large']);
    expect(set.find((o) => o.id === 'o-large')?.group).toBeNull();
  });

  it("answers 404 for an option of another category, 403 for another brand's category", async () => {
    const { svc, prisma } = build([{ id: 'o-other', categoryId: 'cat-food', name: 'Соус' }]);

    await expect(svc.remove('cat-hot', 'o-other', ['b1'])).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.list('cat-hot', ['b2'])).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.categoryOption.delete).not.toHaveBeenCalled();
  });

  it('applies the set under a per-category lock and reports what it added', async () => {
    const { svc, prisma } = build([{ kind: 'MODIFIER', name: 'Ваниль', group: 'Сиропы', ingredientId: 'ing-vanilla' }]);
    prisma.product.findMany.mockResolvedValue([
      { id: 'p-latte', variations: [], modifiers: [] },
      {
        id: 'p-raf',
        variations: [],
        modifiers: [{ slug: 'v', name: 'Ваниль', ingredientId: 'ing-vanilla', sortOrder: 0 }],
      },
    ]);

    const result = await svc.apply('cat-hot', ['b1']);

    expect(result).toEqual({ total: 2, products: 1, variations: 0, modifiers: 1 });
    expect(prisma.$queryRaw.mock.calls[0][0].join('?')).toContain('pg_advisory_xact_lock');
    expect(prisma.$queryRaw.mock.calls[0][1]).toBe('category-options:cat-hot');
    expect(prisma.modifier.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ productId: 'p-latte', name: 'Ваниль', group: 'Сиропы' })],
    });
  });

  it('tries the apply again when an editor took a slug meanwhile', async () => {
    const { svc, prisma } = build([{ kind: 'MODIFIER', name: 'Ваниль' }]);
    prisma.product.findMany.mockResolvedValue([{ id: 'p-latte', variations: [], modifiers: [] }]);
    prisma.modifier.createMany.mockRejectedValueOnce({ code: 'P2002' }).mockResolvedValue({ count: 1 });

    const result = await svc.apply('cat-hot', ['b1']);

    expect(result.modifiers).toBe(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("gives every product of the category the category's prep time", async () => {
    const { svc, prisma } = build();

    expect(await svc.applyPrepTime('cat-hot', ['b1'])).toEqual({ products: 3 });
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { categoryId: 'cat-hot', prepTimeSeconds: { not: 180 } },
      data: { prepTimeSeconds: 180 },
    });

    prisma.category.findUnique.mockResolvedValue({ id: 'cat-hot', brandId: 'b1', defaultPrepTimeSeconds: null });
    expect(await svc.applyPrepTime('cat-hot', ['b1'])).toEqual({ products: 0 });
    expect(prisma.product.updateMany).toHaveBeenCalledTimes(1);
  });
});
