import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../strategies/jwt.strategy';
import { BrandScopeService } from './brand-scope.service';

function userWith(role: Role, id = 'u1'): AuthenticatedUser {
  return { id, phone: null, email: null, name: null, role };
}

describe('BrandScopeService', () => {
  let brandFindMany: jest.Mock;
  let userStoreFindMany: jest.Mock;
  let service: BrandScopeService;

  beforeEach(() => {
    brandFindMany = jest.fn();
    userStoreFindMany = jest.fn();
    const prisma = {
      brand: { findMany: brandFindMany },
      userStore: { findMany: userStoreFindMany },
    } as unknown as PrismaService;
    service = new BrandScopeService(prisma);
  });

  describe('resolveBrandIds', () => {
    it('returns null (no restriction) for SUPER_ADMIN', async () => {
      const scope = await service.resolveBrandIds(userWith(Role.SUPER_ADMIN));
      expect(scope).toBeNull();
      expect(brandFindMany).not.toHaveBeenCalled();
    });

    it('resolves BRAND_ADMIN to the brands they own', async () => {
      brandFindMany.mockResolvedValue([{ id: 'b1' }, { id: 'b2' }]);
      const scope = await service.resolveBrandIds(userWith(Role.BRAND_ADMIN, 'owner1'));
      expect(scope).toEqual(['b1', 'b2']);
      expect(brandFindMany).toHaveBeenCalledWith({ where: { ownerId: 'owner1' }, select: { id: true } });
    });

    it('resolves STAFF to the brands of their assigned stores, de-duplicated', async () => {
      userStoreFindMany.mockResolvedValue([
        { store: { brandId: 'b1' } },
        { store: { brandId: 'b1' } },
        { store: { brandId: 'b2' } },
      ]);
      const scope = await service.resolveBrandIds(userWith(Role.STAFF));
      expect(scope).toEqual(['b1', 'b2']);
    });

    it('resolves MENU_EDITOR through the UserStore pivot like other staff', async () => {
      userStoreFindMany.mockResolvedValue([{ store: { brandId: 'b9' } }]);
      const scope = await service.resolveBrandIds(userWith(Role.MENU_EDITOR));
      expect(scope).toEqual(['b9']);
      expect(userStoreFindMany).toHaveBeenCalled();
    });

    it('returns an empty array for staff with no store assignments', async () => {
      userStoreFindMany.mockResolvedValue([]);
      const scope = await service.resolveBrandIds(userWith(Role.STORE_MANAGER));
      expect(scope).toEqual([]);
    });
  });

  describe('assertBrand', () => {
    it('passes for SUPER_ADMIN on any brand', async () => {
      await expect(service.assertBrand(userWith(Role.SUPER_ADMIN), 'any-brand')).resolves.toBeUndefined();
    });

    it('passes when the brand is inside the caller scope', async () => {
      brandFindMany.mockResolvedValue([{ id: 'b1' }]);
      await expect(service.assertBrand(userWith(Role.BRAND_ADMIN), 'b1')).resolves.toBeUndefined();
    });

    it('throws ForbiddenException for a brand outside the caller scope', async () => {
      brandFindMany.mockResolvedValue([{ id: 'b1' }]);
      await expect(service.assertBrand(userWith(Role.BRAND_ADMIN), 'b2')).rejects.toThrow(ForbiddenException);
    });

    it('throws for staff with no assignments acting on any brand', async () => {
      userStoreFindMany.mockResolvedValue([]);
      await expect(service.assertBrand(userWith(Role.STAFF), 'b1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('brandWhere', () => {
    it('returns undefined for SUPER_ADMIN (no filter)', async () => {
      expect(await service.brandWhere(userWith(Role.SUPER_ADMIN))).toBeUndefined();
    });

    it('returns an `in` filter scoped to the resolved brands', async () => {
      brandFindMany.mockResolvedValue([{ id: 'b1' }, { id: 'b2' }]);
      expect(await service.brandWhere(userWith(Role.BRAND_ADMIN))).toEqual({ brandId: { in: ['b1', 'b2'] } });
    });
  });
});
