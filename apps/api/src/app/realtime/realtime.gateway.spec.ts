import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';

import type { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import type { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';

describe('RealtimeGateway store rooms', () => {
  /** `brandStores`: the stores of brand-1, where a PIN session's person may work. */
  function gateway(role: string, scope: '*' | string[], brandStores: string[] = []) {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role }) },
      userStore: {
        findFirst: jest.fn(
          async ({ where }: { where: { userId: string; storeId: string; store: { brandId: string } } }) =>
            where.store.brandId === 'brand-1' &&
            brandStores.includes(where.storeId) &&
            scope !== '*' &&
            scope.includes(where.storeId)
              ? { storeId: where.storeId }
              : null,
        ),
      },
    } as unknown as PrismaService;
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

  it('keeps a kitchen PIN socket on its person’s boards in the tablet’s brand and off the delivery queue', async () => {
    // Works at store-1 and store-2 of brand-1, and at store-9 of another brand.
    const { gw, client } = gateway('STORE_MANAGER', ['store-1', 'store-2', 'store-9'], ['store-1', 'store-2']);
    (client.data as Record<string, unknown>)['kdsBrandId'] = 'brand-1';

    await expect(gw.subscribeToKds(client, { storeId: 'store-1' })).resolves.toEqual({ ok: true });
    await expect(gw.subscribeToKds(client, { storeId: 'store-2' })).resolves.toEqual({ ok: true });
    await expect(gw.subscribeToKds(client, { storeId: 'store-9' })).resolves.toEqual({ ok: false });
    await expect(gw.subscribeToDispatch(client, { storeId: 'store-1' })).resolves.toEqual({ ok: false });
  });
});

describe('RealtimeGateway handshake', () => {
  function connect(user: { blockedAt: Date | null } | null) {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1' }) } as unknown as JwtService;
    const config = { get: jest.fn() } as unknown as ConfigService;
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      store: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
          where.id === 'gone' ? null : { brandId: 'brand-of-' + where.id },
        ),
      },
    } as unknown as PrismaService;
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
    expect(client.data['kdsBrandId']).toBeUndefined();
  });

  it('remembers the brand of a kitchen PIN session from its token', async () => {
    const { gw, client, socket } = connect({ blockedAt: null });
    (gw as unknown as { jwt: { verifyAsync: jest.Mock } }).jwt.verifyAsync.mockResolvedValue({
      sub: 'u1',
      kdsb: 'brand-1',
      kds: 'store-1',
    });
    await gw.handleConnection(socket);
    expect(client.data['kdsBrandId']).toBe('brand-1');
  });

  it('takes the brand of the store from a PIN token issued before brands, and turns away one whose store is gone', async () => {
    const old = connect({ blockedAt: null });
    (old.gw as unknown as { jwt: { verifyAsync: jest.Mock } }).jwt.verifyAsync.mockResolvedValue({
      sub: 'u1',
      kds: 'store-1',
    });
    await old.gw.handleConnection(old.socket);
    expect(old.client.data['kdsBrandId']).toBe('brand-of-store-1');

    const orphan = connect({ blockedAt: null });
    (orphan.gw as unknown as { jwt: { verifyAsync: jest.Mock } }).jwt.verifyAsync.mockResolvedValue({
      sub: 'u1',
      kds: 'gone',
    });
    await orphan.gw.handleConnection(orphan.socket);
    expect(orphan.client.disconnect).toHaveBeenCalledWith(true);
    expect(orphan.client.join).not.toHaveBeenCalled();
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

describe('RealtimeGateway anonymous socket limits', () => {
  function gatewayWith(env: Record<string, string> = {}) {
    const config = { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService;
    const gw = new RealtimeGateway({} as JwtService, config, {} as PrismaService, {} as UserStoreScopeService);
    let n = 0;
    const open = () => {
      const client = {
        id: `anon-${++n}`,
        handshake: { auth: {}, headers: {}, query: {} },
        data: {} as Record<string, unknown>,
        join: jest.fn(),
        disconnect: jest.fn(),
        conn: { close: jest.fn() },
      };
      return { client, socket: client as unknown as Socket };
    };
    return { gw, open };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('recycles an anonymous socket by dropping its transport, so the client reconnects on its own', async () => {
    jest.useFakeTimers();
    const { gw, open } = gatewayWith({ REALTIME_ANONYMOUS_MAX_AGE_SECONDS: '600' });
    const { client, socket } = open();
    await gw.handleConnection(socket);

    jest.advanceTimersByTime(600 * 0.75 * 1000 - 1000);
    expect(client.conn.close).not.toHaveBeenCalled();
    jest.advanceTimersByTime(600 * 0.25 * 1000 + 2000);
    expect(client.conn.close).toHaveBeenCalledTimes(1);
    // A transport close, not a server kick: socket.io clients do not retry
    // after `disconnect(true)` by themselves.
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('forgets a socket that left, so it neither counts nor gets closed later', async () => {
    jest.useFakeTimers();
    const { gw, open } = gatewayWith({ REALTIME_MAX_ANONYMOUS_SOCKETS: '1' });
    const first = open();
    await gw.handleConnection(first.socket);
    gw.handleDisconnect(first.socket);

    const second = open();
    await gw.handleConnection(second.socket);
    expect(second.client.disconnect).not.toHaveBeenCalled();

    jest.advanceTimersByTime(31 * 60 * 1000);
    expect(first.client.conn.close).not.toHaveBeenCalled();
  });

  it('turns new anonymous sockets away past REALTIME_MAX_ANONYMOUS_SOCKETS', async () => {
    const { gw, open } = gatewayWith({ REALTIME_MAX_ANONYMOUS_SOCKETS: '2' });
    const sockets = [open(), open(), open()];
    for (const s of sockets) await gw.handleConnection(s.socket);

    expect(sockets[0]?.client.disconnect).not.toHaveBeenCalled();
    expect(sockets[1]?.client.disconnect).not.toHaveBeenCalled();
    expect(sockets[2]?.client.disconnect).toHaveBeenCalledWith(true);
    for (const s of sockets) gw.handleDisconnect(s.socket);
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
