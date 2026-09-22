import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { PrismaService } from '../../prisma/prisma.service';
import { UserStoreScopeService } from './user-store-scope.service';

function service(): {
  svc: UserStoreScopeService;
  prisma: { store: { findMany: jest.Mock }; userStore: { findMany: jest.Mock } };
} {
  const prisma = {
    store: { findMany: jest.fn().mockResolvedValue([{ id: 'own-1' }, { id: 'own-2' }]) },
    userStore: { findMany: jest.fn().mockResolvedValue([{ storeId: 'assigned' }]) },
  };
  return { svc: new UserStoreScopeService(prisma as unknown as PrismaService), prisma };
}

describe('UserStoreScopeService', () => {
  it('leaves the platform admin unrestricted', async () => {
    await expect(service().svc.getScope('sa', Role.SUPER_ADMIN)).resolves.toBe('*');
  });

  it("gives a brand owner its own brands' stores, never the whole platform", async () => {
    const { svc, prisma } = service();
    await expect(svc.getScope('owner', Role.BRAND_ADMIN)).resolves.toEqual(['own-1', 'own-2']);
    expect(prisma.store.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { brand: { ownerId: 'owner' } } }),
    );
  });

  it('gives a brand without stores nothing at all', async () => {
    const { svc, prisma } = service();
    prisma.store.findMany.mockResolvedValue([]);
    await expect(svc.getScope('new-owner', Role.BRAND_ADMIN)).resolves.toEqual([]);
  });

  it('keeps staff to the stores they are assigned to', async () => {
    await expect(service().svc.getScope('barista', Role.STAFF)).resolves.toEqual(['assigned']);
  });

  it("refuses another brand's store with a 403", async () => {
    await expect(service().svc.assertAllowed('owner', Role.BRAND_ADMIN, 'competitor-store')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service().svc.assertAllowed('owner', Role.BRAND_ADMIN, 'own-1')).resolves.toBe('own-1');
  });
});
