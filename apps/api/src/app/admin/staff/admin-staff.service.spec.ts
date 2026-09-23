import { ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { KdsPinService } from '../../auth/services/kds-pin.service';
import type { PasswordService } from '../../auth/services/password.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { PrismaService } from '../../prisma/prisma.service';
import { AdminStaffService } from './admin-staff.service';

describe('AdminStaffService — kitchen PINs', () => {
  const manager = { id: 'manager-1', role: Role.STORE_MANAGER } as AuthenticatedUser;
  const owner = { id: 'owner-1', role: Role.BRAND_ADMIN } as AuthenticatedUser;

  function build(managerStores: string[] = ['store-1']) {
    const prisma = {
      store: { findUnique: jest.fn().mockResolvedValue({ id: 'store-1', brandId: 'brand-1' }) },
      userStore: {
        findUnique: jest.fn(({ where }: { where: { userId_storeId: { userId: string; storeId: string } } }) => {
          const { userId, storeId } = where.userId_storeId;
          if (userId === manager.id) return Promise.resolve(managerStores.includes(storeId) ? { storeId } : null);
          return Promise.resolve({ userId, storeId });
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            createdAt: new Date('2026-09-01T08:00:00Z'),
            user: {
              id: 'barista-1',
              email: 'ion@noname.md',
              name: 'Ion',
              role: Role.STAFF,
              blockedAt: null,
              kdsPinHash: 'hash',
              kdsPinStoreId: 'store-1',
            },
          },
          {
            createdAt: new Date('2026-09-02T08:00:00Z'),
            user: {
              id: 'barista-2',
              email: 'ana@noname.md',
              name: 'Ana',
              role: Role.STAFF,
              blockedAt: null,
              kdsPinHash: 'hash',
              kdsPinStoreId: 'store-2',
            },
          },
        ]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'barista-1', role: Role.STAFF }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const scope = { resolveBrandIds: jest.fn().mockResolvedValue(['brand-1']) };
    const pins = { isValidFormat: () => true, hash: () => 'hash' };
    const svc = new AdminStaffService(
      prisma as unknown as PrismaService,
      {} as PasswordService,
      pins as unknown as KdsPinService,
      scope as unknown as BrandScopeService,
    );
    return { svc, prisma };
  }

  it('says who already has a PIN for this store — one for another store does not count', async () => {
    const { svc } = build();
    const roster = await svc.list('store-1', owner);
    expect(roster.map((r) => [r.userId, r.hasKdsPin])).toEqual([
      ['barista-1', true],
      ['barista-2', false],
    ]);
  });

  it("keeps a store manager out of the brand's other stores", async () => {
    const { svc, prisma } = build(['store-2']);
    await expect(svc.setKdsPin('store-1', 'barista-1', '4821', manager)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('answers a PIN another barista of the store already uses with a 409 the admin can translate', async () => {
    const { svc, prisma } = build();
    prisma.user.update.mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    const error = await svc.setKdsPin('store-1', 'barista-1', '4821', manager).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'KDS_PIN_TAKEN' });
  });
});
