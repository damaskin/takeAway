import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StorageService } from '../storage/storage.service';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  AccountDeletionService,
  BRAND_OWNER_DELETION_REFUSED,
  STAFF_DELETION_REFUSED,
} from './services/account-deletion.service';
import { AppleTokenRevocationService } from './services/apple-token-revocation.service';
import { SignInMethodsService } from './services/sign-in-methods.service';
import { TelegramService } from './services/telegram.service';
import { TokensService } from './services/tokens.service';
import { JwtStrategy } from './strategies/jwt.strategy';

const SECRET = 'test-access-secret';

interface FakeUser {
  id: string;
  role: Role;
  email: string | null;
  phone: string | null;
  name: string | null;
  avatarUrl: string | null;
  blockedAt: Date | null;
}

/**
 * `DELETE /auth/me` over HTTP, through the real global JWT guard and
 * strategy and the real deletion service; only the database is faked.
 */
describe('DELETE /auth/me', () => {
  let app: NestFastifyApplication;
  let jwt: JwtService;
  const users = new Map<string, FakeUser>();
  const brandOwners = new Set<string>();
  const revokeAll = jest.fn(async () => 0);
  const revokeAuthorizationCode = jest.fn(async () => 'revoked' as const);

  const tx = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) =>
        Object.assign(users.get(where.id) as FakeUser, data),
      ),
    },
    brand: {
      count: jest.fn(async ({ where }: { where: { ownerId: string } }) => (brandOwners.has(where.ownerId) ? 1 : 0)),
    },
    oAuthAccount: { deleteMany: jest.fn() },
    device: { deleteMany: jest.fn() },
    cart: { deleteMany: jest.fn() },
    cardBindingRequest: { deleteMany: jest.fn() },
    cardToken: { deleteMany: jest.fn() },
    passwordResetToken: { deleteMany: jest.fn() },
    userStore: { deleteMany: jest.fn() },
    order: { updateMany: jest.fn() },
    orderEvent: { findMany: jest.fn(async () => []), update: jest.fn() },
    loyaltyAccount: { findUnique: jest.fn(async () => null) },
  };
  const prisma = { ...tx, $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) };

  function seedUser(id: string, role: Role): void {
    users.set(id, { id, role, email: `${id}@example.com`, phone: null, name: id, avatarUrl: null, blockedAt: null });
  }

  function del(token?: string, body?: Record<string, unknown>) {
    return app.inject({
      method: 'DELETE',
      url: '/auth/me',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(body ? { payload: body } : {}),
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({ secret: SECRET })],
      controllers: [AuthController],
      providers: [
        JwtStrategy,
        AccountDeletionService,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? SECRET : undefined) },
        },
        { provide: UsersService, useValue: { findById: async (id: string) => users.get(id) ?? null } },
        { provide: PrismaService, useValue: prisma },
        { provide: TokensService, useValue: { revokeAll } },
        { provide: StorageService, useValue: { deleteByPublicUrl: jest.fn() } },
        { provide: RealtimeGateway, useValue: { disconnectUser: jest.fn() } },
        { provide: AppleTokenRevocationService, useValue: { revokeAuthorizationCode } },
        { provide: AuthService, useValue: {} },
        { provide: TelegramService, useValue: {} },
        { provide: SignInMethodsService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // Same pipe as main.ts, so the optional body is validated as in production.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    users.clear();
    brandOwners.clear();
    jest.clearAllMocks();
  });

  const tokenFor = (id: string) => jwt.signAsync({ sub: id, jti: `jti-${id}` });

  it('answers 401 without a token and deletes nothing', async () => {
    const res = await del();
    expect(res.statusCode).toBe(401);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('answers 401 for a forged token', async () => {
    seedUser('ana', Role.CUSTOMER);
    const forged = await new JwtService({ secret: 'someone-else' }).signAsync({ sub: 'ana', jti: 'x' });
    expect((await del(forged)).statusCode).toBe(401);
    expect(users.get('ana')?.blockedAt).toBeNull();
  });

  it('deletes a customer with 204, and the same access token stops working', async () => {
    seedUser('ana', Role.CUSTOMER);
    const token = await tokenFor('ana');

    const res = await del(token);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(users.get('ana')).toMatchObject({ email: null, name: null, blockedAt: expect.any(Date) });
    expect(revokeAll).toHaveBeenCalledWith('ana');
    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'ana' } }));
    expect(revokeAuthorizationCode).not.toHaveBeenCalled();

    expect((await del(token)).statusCode).toBe(401);
  });

  it('accepts an empty JSON object — what the mobile client sends without an Apple code', async () => {
    seedUser('ana', Role.CUSTOMER);
    const res = await del(await tokenFor('ana'), {});
    expect(res.statusCode).toBe(204);
    expect(users.get('ana')?.blockedAt).toEqual(expect.any(Date));
    expect(revokeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('passes an Apple authorization code from the body on to the revocation', async () => {
    seedUser('ana', Role.CUSTOMER);
    const res = await del(await tokenFor('ana'), { appleAuthorizationCode: 'apple-code' });
    expect(res.statusCode).toBe(204);
    expect(revokeAuthorizationCode).toHaveBeenCalledWith('apple-code', 'ana');
    expect(users.get('ana')?.blockedAt).toEqual(expect.any(Date));
  });

  it('rejects an unknown body field with 400 and deletes nothing', async () => {
    seedUser('ana', Role.CUSTOMER);
    const res = await del(await tokenFor('ana'), { reason: 'bye' });
    expect(res.statusCode).toBe(400);
    expect(users.get('ana')?.blockedAt).toBeNull();
  });

  it.each([Role.STAFF, Role.STORE_MANAGER, Role.MENU_EDITOR, Role.BRAND_ADMIN, Role.SUPER_ADMIN, Role.RIDER])(
    'answers 403 for a %s account',
    async (role) => {
      seedUser('staff', role);
      const res = await del(await tokenFor('staff'));
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ message: STAFF_DELETION_REFUSED });
      expect(users.get('staff')?.blockedAt).toBeNull();
      expect(revokeAll).not.toHaveBeenCalled();
    },
  );

  it('answers 403 for a customer who owns a brand', async () => {
    seedUser('owner', Role.CUSTOMER);
    brandOwners.add('owner');
    const res = await del(await tokenFor('owner'));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ message: BRAND_OWNER_DELETION_REFUSED });
    expect(users.get('owner')?.blockedAt).toBeNull();
  });
});
