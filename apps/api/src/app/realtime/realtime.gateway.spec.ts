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

describe('RealtimeGateway handshake', () => {
  function connect(user: { blockedAt: Date | null } | null) {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1' }) } as unknown as JwtService;
    const config = { get: jest.fn() } as unknown as ConfigService;
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } } as unknown as PrismaService;
    const gw = new RealtimeGateway(jwt, config, prisma, {} as UserStoreScopeService);
    const client = {
      handshake: { auth: { token: 'access-token' }, headers: {} },
      data: {} as Record<string, unknown>,
      join: jest.fn(),
      disconnect: jest.fn(),
    };
    return { gw, client, socket: client as unknown as Socket };
  }

  it('joins an active user to their own room', async () => {
    const { gw, client, socket } = connect({ blockedAt: null });
    await gw.handleConnection(socket);
    expect(client.join).toHaveBeenCalledWith('user:u1');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it.each([
    ['blocked or deleted', { blockedAt: new Date() }],
    ['missing', null],
  ])('turns away a %s account whose access token is still valid', async (_label, user) => {
    const { gw, client, socket } = connect(user);
    await gw.handleConnection(socket);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
    expect(client.data['userId']).toBeUndefined();
  });
});

describe('RealtimeGateway anonymous sockets', () => {
  function anonymous() {
    const verifyAsync = jest.fn();
    const prisma = { user: { findUnique: jest.fn() }, order: { findUnique: jest.fn() } } as unknown as PrismaService;
    const scope = { getScope: jest.fn() } as unknown as UserStoreScopeService;
    const config = { get: jest.fn() } as unknown as ConfigService;
    const gw = new RealtimeGateway({ verifyAsync } as unknown as JwtService, config, prisma, scope);
    const client = {
      id: 'sock-1',
      handshake: { auth: {} as Record<string, unknown>, headers: {}, query: {} },
      data: {} as Record<string, unknown>,
      join: jest.fn(),
      disconnect: jest.fn(),
    };
    return { gw, client, socket: client as unknown as Socket, verifyAsync };
  }

  it('lets a storefront without an account connect, into no room at all', async () => {
    const { gw, client, socket, verifyAsync } = anonymous();
    await gw.handleConnection(socket);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
    expect(client.data['userId']).toBeUndefined();
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('keeps every private room closed to it', async () => {
    const { gw, client, socket } = anonymous();
    await gw.handleConnection(socket);
    await expect(gw.subscribeToOrder(socket, { orderId: 'o1' })).resolves.toEqual({ ok: false });
    await expect(gw.subscribeToKds(socket, { storeId: 's1' })).resolves.toEqual({ ok: false });
    await expect(gw.subscribeToDispatch(socket, { storeId: 's1' })).resolves.toEqual({ ok: false });
    expect(client.join).not.toHaveBeenCalled();
  });

  it('still turns away a token that does not verify', async () => {
    const { gw, client, socket, verifyAsync } = anonymous();
    client.handshake.auth = { token: 'expired' };
    verifyAsync.mockRejectedValue(new Error('jwt expired'));
    await gw.handleConnection(socket);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });
});

describe('RealtimeGateway store.availabilityChanged', () => {
  it('broadcasts exactly {storeId, brandId, acceptingOrders} to the whole namespace', () => {
    const gw = new RealtimeGateway(
      {} as JwtService,
      {} as ConfigService,
      {} as PrismaService,
      {} as UserStoreScopeService,
    );
    const emit = jest.fn();
    const to = jest.fn();
    (gw as unknown as { server: unknown }).server = { emit, to };
    // A caller passing a richer object must not leak the extra fields.
    const richer = { storeId: 'store-1', brandId: 'brand-1', acceptingOrders: true, status: 'OPEN' };
    gw.emitStoreAvailabilityChanged(richer);
    expect(to).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('store.availabilityChanged', {
      storeId: 'store-1',
      brandId: 'brand-1',
      acceptingOrders: true,
    });
  });
});
