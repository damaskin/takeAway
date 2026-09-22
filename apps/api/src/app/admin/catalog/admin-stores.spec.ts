import { ConflictException, HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import type { PasswordService } from '../../auth/services/password.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { AdminCatalogService } from './admin-catalog.service';
import { CreateStoreDto, ReplaceWorkingHoursDto, UpdateStoreDto } from './dto/admin-store.dto';

interface Options {
  store?: Record<string, unknown>;
  hasOrders?: boolean;
  visibleProducts?: number;
  takenSlugs?: string[];
  siblingZones?: string[];
}

const TIRASPOL = { latitude: 46.8403, longitude: 29.6433 };

function build(opts: Options = {}) {
  const store = {
    id: 'store-1',
    brandId: 'brand-1',
    slug: 'noname-coffee-tsentr',
    name: 'Центр',
    status: 'CLOSED',
    currency: 'MDL',
    timezone: 'Europe/Chisinau',
    ...TIRASPOL,
    heroImageUrl: null,
    galleryUrls: [] as string[],
    workingHours: [{ weekday: 1, opensAt: 480, closesAt: 1200, isClosed: false }],
    ...opts.store,
  };
  const taken = new Set(opts.takenSlugs ?? []);
  const prisma = {
    brand: {
      findUnique: jest.fn().mockResolvedValue({ id: 'brand-1', slug: 'noname-coffee', currency: 'MDL' }),
      findMany: jest.fn().mockResolvedValue([{ id: 'brand-1', moderationStatus: 'APPROVED' }]),
    },
    store: {
      findUnique: jest.fn(({ where }: { where: { id?: string; slug?: string } }) => {
        if (where.id) return Promise.resolve(where.id === store.id ? store : null);
        return Promise.resolve(where.slug && taken.has(where.slug) ? { id: 'someone-else' } : null);
      }),
      findMany: jest.fn().mockResolvedValue((opts.siblingZones ?? []).map((timezone) => ({ timezone }))),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...store, ...data, id: 'store-new', workingHours: [] }),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...store, ...data })),
      delete: jest.fn().mockResolvedValue(store),
    },
    order: { findFirst: jest.fn().mockResolvedValue(opts.hasOrders ? { id: 'order-1' } : null) },
    product: {
      groupBy: jest
        .fn()
        .mockResolvedValue(
          opts.visibleProducts === 0 ? [] : [{ brandId: 'brand-1', _count: { _all: opts.visibleProducts ?? 3 } }],
        ),
    },
  };
  const svc = new AdminCatalogService(prisma as unknown as PrismaService, {} as PasswordService);
  return { svc, prisma, store };
}

/** The `data` a Prisma write mock received on its n-th call. */
function written(mock: jest.Mock, call = 0): Record<string, unknown> {
  const args = mock.mock.calls[call] as [{ data: Record<string, unknown> }] | undefined;
  if (!args) throw new Error(`expected write #${call}`);
  return args[0].data;
}

/** The JSON body a 409 answers with. */
async function conflictBody(promise: Promise<unknown>): Promise<Record<string, unknown>> {
  const error = await promise.then(
    () => {
      throw new Error('expected a conflict');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConflictException);
  return (error as HttpException).getResponse() as Record<string, unknown>;
}

const newStore = {
  brandId: 'brand-1',
  name: 'Центр',
  addressLine: 'ул. 25 Октября, 1',
  city: 'Тирасполь',
  country: 'MD',
  ...TIRASPOL,
};

describe('store DTOs', () => {
  async function errors(cls: new () => object, body: Record<string, unknown>): Promise<string[]> {
    const found = await validate(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true });
    const flatten = (list: typeof found): string[] =>
      list.flatMap((e) => [...Object.values(e.constraints ?? {}), ...flatten(e.children ?? [])]);
    return flatten(found);
  }

  it('refuses a time zone Intl does not know, on create and on update', async () => {
    expect(await errors(CreateStoreDto, { ...newStore, timezone: 'Europe/Kishinev' })).toEqual([
      'timezone must be an IANA time zone such as Europe/Chisinau',
    ]);
    expect(await errors(UpdateStoreDto, { timezone: '+03:00' })).toHaveLength(1);
    expect(await errors(UpdateStoreDto, { timezone: 'Europe/Chisinau' })).toEqual([]);
  });

  it('makes slug and currency optional but keeps the slug URL-safe', async () => {
    expect(await errors(CreateStoreDto, newStore)).toEqual([]);
    expect(await errors(CreateStoreDto, { ...newStore, slug: 'Центр 1' })).toEqual([
      'slug may only contain lower-case latin letters, digits and single hyphens',
    ]);
    expect(await errors(CreateStoreDto, { ...newStore, slug: 'noname-tsentr-2' })).toEqual([]);
  });

  it('takes status on update only — a new store cannot be created open', async () => {
    expect(await errors(CreateStoreDto, { ...newStore, status: 'OPEN' })).toEqual(['property status should not exist']);
    expect(await errors(UpdateStoreDto, { status: 'OPEN' })).toEqual([]);
  });

  it('checks every working-hours row and refuses a weekday twice', async () => {
    const day = { weekday: 1, opensAt: 480, closesAt: 1200, isClosed: false };
    expect(await errors(ReplaceWorkingHoursDto, { hours: [day, { ...day, weekday: 2 }] })).toEqual([]);
    expect(await errors(ReplaceWorkingHoursDto, { hours: [day, day] })).toEqual([
      'hours must list each weekday at most once',
    ]);
    expect(await errors(ReplaceWorkingHoursDto, { hours: [{ ...day, isClosed: 'yes' }] })).toEqual([
      'isClosed must be a boolean value',
    ]);
    expect(await errors(ReplaceWorkingHoursDto, { hours: [{ ...day, weekday: 7, closesAt: 1441 }] })).toHaveLength(2);
  });
});

describe('AdminCatalogService — creating a store', () => {
  it("starts it closed, in the brand's currency, with a slug led by the brand", async () => {
    const { svc, prisma } = build();
    const created = await svc.createStore({ ...newStore, timezone: 'europe/chisinau' }, ['brand-1']);
    expect(written(prisma.store.create)).toMatchObject({
      status: 'CLOSED',
      currency: 'MDL',
      slug: 'noname-coffee-tsentr',
      timezone: 'Europe/Chisinau',
      fulfillmentTypes: ['TAKEAWAY'],
    });
    expect(created.hasOrders).toBe(false);
    expect(created.readiness.ready).toBe(false); // no working hours yet
  });

  it('numbers the slug when the brand already has a store of that name', async () => {
    const { svc, prisma } = build({ takenSlugs: ['noname-coffee-tsentr'] });
    await svc.createStore(newStore, ['brand-1']);
    expect(written(prisma.store.create)['slug']).toBe('noname-coffee-tsentr-2');
  });

  it("does not repeat the brand when the store's name already carries it", async () => {
    const { svc, prisma } = build();
    await svc.createStore({ ...newStore, name: 'NoName Coffee Балка' }, ['brand-1']);
    expect(written(prisma.store.create)['slug']).toBe('noname-coffee-balka');
  });

  it("takes the zone of the brand's other stores when none is given", async () => {
    const { svc, prisma } = build({ siblingZones: ['Europe/Chisinau', 'UTC'] });
    await svc.createStore(newStore, ['brand-1']);
    expect(written(prisma.store.create)['timezone']).toBe('Europe/Chisinau');
  });

  it('answers 409, not 500, when the slug belongs to another store', async () => {
    const { svc, prisma } = build();
    prisma.store.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique'), { code: 'P2002', meta: { target: ['slug'] } }),
    );
    const body = await conflictBody(svc.createStore({ ...newStore, slug: 'tsentr' }, ['brand-1']));
    expect(body).toMatchObject({ code: 'STORE_SLUG_TAKEN' });
  });
});

describe('AdminCatalogService — changing a store', () => {
  it('refuses a new currency once the store has orders', async () => {
    const { svc, prisma } = build({ hasOrders: true });
    const body = await conflictBody(svc.updateStore('store-1', { currency: 'RUP' }, ['brand-1']));
    expect(body).toMatchObject({ code: 'STORE_CURRENCY_LOCKED' });
    expect(prisma.store.update).not.toHaveBeenCalled();
  });

  it('lets the currency change while the store has no orders, and resends of the same one pass', async () => {
    const { svc, prisma } = build();
    await svc.updateStore('store-1', { currency: 'RUP' }, ['brand-1']);
    expect(written(prisma.store.update)).toMatchObject({ currency: 'RUP' });

    const withOrders = build({ hasOrders: true });
    await withOrders.svc.updateStore('store-1', { currency: 'MDL', name: 'Центр 2' }, ['brand-1']);
    expect(withOrders.prisma.store.update).toHaveBeenCalled();
  });

  it('refuses to open a store that is not ready, naming what is missing', async () => {
    const { svc, prisma } = build({
      store: { latitude: 0, longitude: 0, timezone: 'UTC', workingHours: [] },
      visibleProducts: 0,
    });
    const body = await conflictBody(svc.updateStore('store-1', { status: 'OPEN' }, ['brand-1']));
    expect(body).toMatchObject({ code: 'STORE_NOT_READY', missing: ['coordinates', 'timezone', 'hours', 'menu'] });
    expect(prisma.store.update).not.toHaveBeenCalled();
  });

  it('counts a location and zone sent in the same request as the opening', async () => {
    const { svc, prisma } = build({ store: { latitude: 0, longitude: 0, timezone: 'UTC' } });
    const opened = await svc.updateStore('store-1', { status: 'OPEN', ...TIRASPOL, timezone: 'Europe/Chisinau' }, [
      'brand-1',
    ]);
    expect(written(prisma.store.update)).toMatchObject({ status: 'OPEN', timezone: 'Europe/Chisinau' });
    expect(opened.readiness.ready).toBe(true);
  });

  it('does not gate an open store — edits to a store predating the checks still save', async () => {
    const { svc, prisma } = build({ store: { status: 'OPEN', timezone: 'UTC' } });
    await svc.updateStore('store-1', { status: 'OVERLOADED', phone: '+373 533 12345' }, ['brand-1']);
    expect(prisma.store.update).toHaveBeenCalled();
  });

  it('also gates a closed store going straight to busy', async () => {
    const { svc } = build({ visibleProducts: 0 });
    const body = await conflictBody(svc.updateStore('store-1', { status: 'OVERLOADED' }, ['brand-1']));
    expect(body).toMatchObject({ missing: ['menu'] });
  });
});

describe('AdminCatalogService — deleting a store', () => {
  it('keeps a store that has orders and says to close it instead', async () => {
    const { svc, prisma } = build({ hasOrders: true });
    const body = await conflictBody(svc.deleteStore('store-1', ['brand-1']));
    expect(body).toMatchObject({ code: 'STORE_HAS_ORDERS' });
    expect(prisma.store.delete).not.toHaveBeenCalled();
  });

  it('deletes a store nobody ordered from', async () => {
    const { svc, prisma } = build();
    await svc.deleteStore('store-1', ['brand-1']);
    expect(prisma.store.delete).toHaveBeenCalledWith({ where: { id: 'store-1' } });
  });

  it('answers the same 409 when an order lands between the check and the delete', async () => {
    const { svc, prisma } = build();
    prisma.store.delete.mockRejectedValueOnce(Object.assign(new Error('FK'), { code: 'P2003' }));
    const body = await conflictBody(svc.deleteStore('store-1', ['brand-1']));
    expect(body).toMatchObject({ code: 'STORE_HAS_ORDERS' });
  });
});

describe('AdminCatalogService — store photos', () => {
  it('refuses a ninth gallery photo', async () => {
    const { svc, prisma } = build({
      store: { galleryUrls: Array.from({ length: 8 }, (_, i) => `https://cdn/${i}.jpg`) },
    });
    const body = await conflictBody(svc.attachStoreImage('store-1', 'gallery', 'https://cdn/9.jpg', ['brand-1']));
    expect(body).toMatchObject({ code: 'STORE_GALLERY_FULL', max: 8 });
    expect(prisma.store.update).not.toHaveBeenCalled();
  });

  it('sets the cover and removes a gallery photo by its URL', async () => {
    const { svc, prisma } = build({ store: { galleryUrls: ['https://cdn/a.jpg', 'https://cdn/b.jpg'] } });
    await svc.attachStoreImage('store-1', 'hero', 'https://cdn/hero.jpg', ['brand-1']);
    expect(written(prisma.store.update)).toEqual({ heroImageUrl: 'https://cdn/hero.jpg' });

    await svc.removeStoreImage('store-1', 'gallery', 'https://cdn/a.jpg', ['brand-1']);
    expect(written(prisma.store.update, 1)).toEqual({ galleryUrls: ['https://cdn/b.jpg'] });
  });
});
