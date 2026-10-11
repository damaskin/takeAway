import { ConflictException, HttpException } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { PrismaService } from '../../prisma/prisma.service';
import { AdminRidersService } from './admin-riders.service';

interface Existing {
  id: string;
  role: Role;
}

describe('AdminRidersService.add', () => {
  const owner = { id: 'owner', role: Role.BRAND_ADMIN } as AuthenticatedUser;

  function build(existing: Existing | null, managed = true) {
    const prisma = {
      store: { findUnique: jest.fn().mockResolvedValue({ id: 'store-1' }) },
      user: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue({ id: 'new-rider' }),
        update: jest.fn(),
      },
      userStore: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(async () => [
          {
            createdAt: new Date('2026-10-10T08:00:00Z'),
            user: { id: existing?.id ?? 'new-rider', phone: '+37377700000', name: 'Vasile', blockedAt: null },
          },
        ]),
      },
    };
    const scope = { managesUser: jest.fn().mockResolvedValue(managed) };
    const svc = new AdminRidersService(prisma as unknown as PrismaService, scope as unknown as BrandScopeService);
    return { svc, prisma, scope };
  }

  const refusal = async (svc: AdminRidersService) => {
    const error = await svc.add('store-1', '+37377700000', 'Vasile', owner).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    return (error as HttpException).getResponse();
  };

  it('creates a brand-new rider', async () => {
    const { svc, prisma } = build(null);
    const entry = await svc.add('store-1', '+37377700000', 'Vasile', owner);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { phone: '+37377700000', role: Role.RIDER, name: 'Vasile' },
      select: { id: true },
    });
    expect(prisma.userStore.create).toHaveBeenCalledWith({ data: { userId: 'new-rider', storeId: 'store-1' } });
    expect(entry.userId).toBe('new-rider');
  });

  it('never turns a customer into a rider, and says nothing about them', async () => {
    const { svc, prisma } = build({ id: 'customer-1', role: Role.CUSTOMER });
    const response = await refusal(svc);
    expect(response).toMatchObject({ code: 'RIDER_PHONE_TAKEN', field: 'phone' });
    expect(JSON.stringify(response)).not.toMatch(/CUSTOMER|Vasile|customer-1/);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.userStore.create).not.toHaveBeenCalled();
  });

  it('gives a staff or admin phone the same answer', async () => {
    const customer = await refusal(build({ id: 'customer-1', role: Role.CUSTOMER }).svc);
    const manager = await refusal(build({ id: 'manager-1', role: Role.STORE_MANAGER }).svc);
    const admin = await refusal(build({ id: 'admin-1', role: Role.SUPER_ADMIN }).svc);
    expect(manager).toEqual(customer);
    expect(admin).toEqual(customer);
  });

  it("does not take over another brand's courier", async () => {
    const { svc, prisma, scope } = build({ id: 'rider-1', role: Role.RIDER }, false);
    const response = await refusal(svc);
    expect(response).toMatchObject({ code: 'RIDER_PHONE_TAKEN' });
    expect(scope.managesUser).toHaveBeenCalledWith(owner, 'rider-1');
    expect(prisma.userStore.create).not.toHaveBeenCalled();
  });

  it("rosters a courier of the caller's own brand at another store", async () => {
    const { svc, prisma } = build({ id: 'rider-1', role: Role.RIDER });
    await svc.add('store-1', '+37377700000', undefined, owner);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.userStore.create).toHaveBeenCalledWith({ data: { userId: 'rider-1', storeId: 'store-1' } });
  });
});
