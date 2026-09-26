import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';

import type { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import type { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';

describe('RealtimeGateway store rooms', () => {
  function gateway(role: string, scope: '*' | string[]) {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ role }) } } as unknown as PrismaService;
    const stores = { getScope: jest.fn().mockResolvedValue(scope) } as unknown as UserStoreScopeService;
    const gw = new RealtimeGateway({} as JwtService, {} as ConfigService, prisma, stores);
    const join = jest.fn();
    const client = { data: { userId: 'u1' }, join } as unknown as Socket;
    return { gw, client, join };
  }

  it.each(['subscribeToKds', 'subscribeToDispatch'] as const)(
    '%s refuses a store outside the account, whatever the role',
    async (method) => {
      const { gw, client, join } = gateway('BRAND_ADMIN', ['own-store']);
      await expect(gw[method](client, { storeId: 'other-brand-store' })).resolves.toEqual({ ok: false });
      expect(join).not.toHaveBeenCalled();

      await expect(gw[method](client, { storeId: 'own-store' })).resolves.toEqual({ ok: true });
      expect(join).toHaveBeenCalledTimes(1);
    },
  );

  it('lets a platform admin into any store', async () => {
    const { gw, client } = gateway('SUPER_ADMIN', '*');
    await expect(gw.subscribeToDispatch(client, { storeId: 'any' })).resolves.toEqual({ ok: true });
  });
});
