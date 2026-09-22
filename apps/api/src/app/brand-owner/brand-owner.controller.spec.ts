import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { BrandOwnerController } from './brand-owner.controller';

function userWith(role: Role, id = 'u1'): AuthenticatedUser {
  return { id, phone: null, email: null, name: null, role };
}

describe('BrandOwnerController', () => {
  let findFirst: jest.Mock;
  let findUnique: jest.Mock;
  let findUniqueOrThrow: jest.Mock;
  let update: jest.Mock;
  let controller: BrandOwnerController;

  beforeEach(() => {
    findFirst = jest.fn();
    findUnique = jest.fn();
    findUniqueOrThrow = jest.fn().mockResolvedValue({ id: 'b1', name: 'Alpha' });
    update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'b1', ...data }));
    const prisma = {
      brand: { findFirst, findUnique, findUniqueOrThrow, update },
    } as unknown as PrismaService;
    controller = new BrandOwnerController(prisma, {} as StorageService);
  });

  it('resolves a BRAND_ADMIN to the brand they own', async () => {
    findFirst.mockResolvedValue({ id: 'b1', slug: 'alpha' });

    await controller.get(userWith(Role.BRAND_ADMIN, 'owner1'));

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: 'owner1' } }));
    expect(findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b1' } }));
  });

  // /settings is in the SUPER_ADMIN's nav, but they own no brand — before the
  // fix the endpoint was BRAND_ADMIN-only and the page just 403'd for them.
  it('resolves a SUPER_ADMIN to the brand they are acting on', async () => {
    findUnique.mockResolvedValue({ id: 'b7', slug: 'seven' });

    await controller.get(userWith(Role.SUPER_ADMIN), 'b7');

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b7' } }));
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('falls back to the only brand when a SUPER_ADMIN sends no brandId', async () => {
    findFirst.mockResolvedValue({ id: 'b1', slug: 'alpha' });

    await controller.get(userWith(Role.SUPER_ADMIN));

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { name: 'asc' } }));
  });

  it('ignores brandId for a BRAND_ADMIN so they cannot reach another brand', async () => {
    findFirst.mockResolvedValue({ id: 'b1', slug: 'alpha' });

    await controller.update(userWith(Role.BRAND_ADMIN, 'owner1'), { name: 'Renamed' }, 'b9');

    expect(findUnique).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { name: 'Renamed' } });
  });

  it('404s a SUPER_ADMIN on an install with no brands at all', async () => {
    findFirst.mockResolvedValue(null);

    await expect(controller.get(userWith(Role.SUPER_ADMIN))).rejects.toThrow(NotFoundException);
  });
});
