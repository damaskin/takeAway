import type { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import { KdsPinService } from './kds-pin.service';
import { KitchenPinsService } from './kitchen-pins.service';
import type { TokensService } from './tokens.service';

function setup(links: Array<{ brandId: string }> = [{ brandId: 'brand-1' }]) {
  const pins = new KdsPinService({ get: () => 'a-real-secret' } as unknown as ConfigService, {} as RedisService);
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    store: { findMany: jest.fn().mockResolvedValue([{ id: 'store-1' }, { id: 'store-2' }]) },
    userStore: { findMany: jest.fn(async () => links.map((store) => ({ store }))) },
  };
  const tokens = { revokeKitchenSessions: jest.fn().mockResolvedValue(0) };
  const service = new KitchenPinsService(prisma as unknown as PrismaService, pins, tokens as unknown as TokensService);
  return { service, prisma, tokens, pins };
}

const codeOf = (e: unknown) => ((e as HttpException).getResponse() as { code?: string }).code;

describe('KitchenPinsService', () => {
  it('stores the brand hash of a new PIN, replacing an old store PIN, and ends the tablet sessions', async () => {
    const { service, prisma, tokens, pins } = setup();
    await service.assign('barista', 'brand-1', '480317');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'barista' },
      data: { kdsPinHash: pins.brandHash('brand-1', '480317'), kdsPinBrandId: 'brand-1', kdsPinStoreId: null },
    });
    expect(tokens.revokeKitchenSessions).toHaveBeenCalledWith('barista');
  });

  it('looks for the same PIN as a brand PIN and as an old PIN of every store of the brand, but not the person’s own', async () => {
    const { service, prisma, pins } = setup();
    await service.assign('barista', 'brand-1', '480317');
    const [brandQuery, legacyQuery] = prisma.user.findFirst.mock.calls.map((c) => c[0].where);
    expect(brandQuery).toEqual({
      id: { not: 'barista' },
      kdsPinBrandId: 'brand-1',
      kdsPinHash: pins.brandHash('brand-1', '480317'),
    });
    expect(legacyQuery).toEqual({
      id: { not: 'barista' },
      kdsPinBrandId: null,
      OR: [
        { kdsPinStoreId: 'store-1', kdsPinHash: pins.storeHash('store-1', '480317') },
        { kdsPinStoreId: 'store-2', kdsPinHash: pins.storeHash('store-2', '480317') },
      ],
    });
  });

  it('refuses a simple PIN before looking anything up', async () => {
    const { service, prisma } = setup();
    const error = await service.assign('barista', 'brand-1', '123456').catch((e: unknown) => e);
    expect(codeOf(error)).toBe('KDS_PIN_TOO_SIMPLE');
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('answers KDS_PIN_TAKEN for a PIN someone has, and for a lost race to the unique index', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'cook' });
    expect(codeOf(await service.assign('barista', 'brand-1', '480317').catch((e: unknown) => e))).toBe('KDS_PIN_TAKEN');
    prisma.user.update.mockRejectedValueOnce(Object.assign(new Error('Unique'), { code: 'P2002' }));
    expect(codeOf(await service.assign('barista', 'brand-1', '480317').catch((e: unknown) => e))).toBe('KDS_PIN_TAKEN');
  });

  it('knows the one brand of a person, and refuses someone of two', async () => {
    await expect(setup().service.brandOf('barista')).resolves.toBe('brand-1');
    await expect(setup([]).service.brandOf('barista')).resolves.toBeNull();
    const error = await setup([{ brandId: 'brand-1' }, { brandId: 'brand-2' }])
      .service.brandOf('barista')
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe('KDS_PIN_MULTI_BRAND');
  });

  it('says which tablets a PIN opens', () => {
    const { service } = setup();
    const store = { id: 'store-1', brandId: 'brand-1' };
    const brandPin = { kdsPinHash: 'h', kdsPinBrandId: 'brand-1', kdsPinStoreId: null };
    const oldPin = { kdsPinHash: 'h', kdsPinBrandId: null, kdsPinStoreId: 'store-1' };
    expect(service.opensStore(brandPin, store, true)).toBe(true);
    expect(service.opensStore(brandPin, store, false)).toBe(false);
    expect(service.opensStore(brandPin, { id: 'store-9', brandId: 'brand-2' }, true)).toBe(false);
    expect(service.opensStore(oldPin, store, true)).toBe(true);
    expect(service.opensStore(oldPin, { id: 'store-2', brandId: 'brand-1' }, true)).toBe(false);
    expect(service.opensStore({ ...brandPin, kdsPinHash: 'unset:x' }, store, true)).toBe(false);
  });

  it('resets a PIN and ends the tablet sessions', async () => {
    const { service, prisma, tokens } = setup();
    await service.clear('barista');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'barista' },
      data: { kdsPinHash: null, kdsPinBrandId: null, kdsPinStoreId: null },
    });
    expect(tokens.revokeKitchenSessions).toHaveBeenCalledWith('barista');
  });
});
