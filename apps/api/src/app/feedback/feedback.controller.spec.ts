import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { FEEDBACK_MESSAGE_MAX_LENGTH } from '@takeaway/shared-types';

import { AppThrottlerGuard } from '../auth/guards/app-throttler.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BrandScopeService } from '../auth/services/brand-scope.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AdminFeedbackController } from './admin-feedback.controller';
import { BusinessSupportController } from './business-support.controller';
import { FeedbackController, SITE_SUPPORT_PER_HOUR } from './feedback.controller';
import { FeedbackService } from './feedback.service';

const SECRET = 'test-access-secret';

/**
 * `/feedback` and `/admin/feedback` over HTTP, through the real JWT and role
 * guards and the production validation pipe; the service is faked.
 */
describe('feedback endpoints', () => {
  let app: NestFastifyApplication;
  let jwt: JwtService;
  const roles = new Map<string, Role>([
    ['ana', Role.CUSTOMER],
    ['root', Role.SUPER_ADMIN],
    ['owner', Role.BRAND_ADMIN],
  ]);
  const service = {
    create: jest.fn(async () => ({ id: 'fb-1', createdAt: '2026-10-07T10:00:00.000Z' })),
    createFromBusiness: jest.fn(async () => ({ id: 'fb-2', createdAt: '2026-10-07T10:00:00.000Z' })),
    createFromSite: jest.fn(async () => undefined),
    list: jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 25, newCount: 0 })),
    newCount: jest.fn(async () => ({ count: 3 })),
    setStatus: jest.fn(async () => ({ id: 'fb-1', status: 'READ' })),
  };
  const brandScope = {
    resolveBrandIds: jest.fn(async () => ['b1']),
    assertBrand: jest.fn(async (_user: unknown, brandId: string) => {
      if (brandId !== 'b1') throw new ForbiddenException('Resource belongs to a brand outside your scope');
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({ secret: SECRET })],
      controllers: [FeedbackController, AdminFeedbackController, BusinessSupportController],
      providers: [
        { provide: BrandScopeService, useValue: brandScope },
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? SECRET : undefined) },
        },
        {
          provide: UsersService,
          useValue: {
            findById: async (id: string) => {
              const role = roles.get(id);
              return role ? { id, role, email: null, phone: null, name: id, blockedAt: null } : null;
            },
          },
        },
        // JwtStrategy reads a kitchen PIN session's stores; these sessions are all password ones.
        { provide: PrismaService, useValue: {} },
        { provide: FeedbackService, useValue: service },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
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

  beforeEach(() => jest.clearAllMocks());

  const tokenFor = (id: string) => jwt.signAsync({ sub: id, jti: `jti-${id}` });
  const send = async (payload: Record<string, unknown>, as: string | null = 'ana') =>
    app.inject({
      method: 'POST',
      url: '/feedback',
      headers: as ? { authorization: `Bearer ${await tokenFor(as)}` } : {},
      payload,
    });

  describe('POST /feedback', () => {
    it('needs a signed-in account', async () => {
      const res = await send({ kind: 'REVIEW', message: 'Nice', source: 'WEB' }, null);
      expect(res.statusCode).toBe(401);
      expect(service.create).not.toHaveBeenCalled();
    });

    it('saves it for the caller with the text trimmed and a blank contact left out', async () => {
      const res = await send({ kind: 'SUGGESTION', message: '  Add oat milk  ', contact: '   ', source: 'IOS' });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ id: 'fb-1', createdAt: '2026-10-07T10:00:00.000Z' });
      expect(service.create).toHaveBeenCalledWith(
        'ana',
        expect.objectContaining({ kind: 'SUGGESTION', message: 'Add oat milk', source: 'IOS', contact: undefined }),
      );
    });

    it.each([
      ['an empty message', { kind: 'REVIEW', message: '   ', source: 'WEB' }],
      [
        'a message over the limit',
        { kind: 'REVIEW', message: 'x'.repeat(FEEDBACK_MESSAGE_MAX_LENGTH + 1), source: 'WEB' },
      ],
      ['an unknown kind', { kind: 'PRAISE', message: 'Nice', source: 'WEB' }],
      ['a business kind', { kind: 'PLAN_CHANGE', message: 'PRO', source: 'WEB' }],
      ['the business admin as the source', { kind: 'REVIEW', message: 'Nice', source: 'BUSINESS' }],
      ['no source', { kind: 'REVIEW', message: 'Nice' }],
      ['an unknown field', { kind: 'REVIEW', message: 'Nice', source: 'WEB', rating: 5 }],
    ])('refuses %s with 400', async (_, payload) => {
      const res = await send(payload);
      expect(res.statusCode).toBe(400);
      expect(service.create).not.toHaveBeenCalled();
    });

    it('takes a message of exactly the limit once trimmed', async () => {
      const res = await send({
        kind: 'PROBLEM',
        message: ` ${'x'.repeat(FEEDBACK_MESSAGE_MAX_LENGTH)} `,
        source: 'TMA',
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('POST /feedback/support', () => {
    const site = (payload: Record<string, unknown>, authorization?: string) =>
      app.inject({
        method: 'POST',
        url: '/feedback/support',
        headers: authorization ? { authorization } : {},
        payload,
      });

    it('takes a visitor’s message without an account', async () => {
      const res = await site({ kind: 'QUESTION', message: '  Где заказ?  ', name: ' Ион ', contact: ' ion@mail.md ' });

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      expect(service.createFromSite).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ kind: 'QUESTION', message: 'Где заказ?', name: 'Ион', contact: 'ion@mail.md' }),
      );
    });

    it('files a signed-in customer’s message under the account', async () => {
      const res = await site({ kind: 'PROBLEM', message: 'Не пришёл возврат' }, `Bearer ${await tokenFor('ana')}`);
      expect(res.statusCode).toBe(204);
      expect(service.createFromSite).toHaveBeenCalledWith('ana', expect.objectContaining({ kind: 'PROBLEM' }));
    });

    it('refuses a bad token instead of writing as a stranger, so the client refreshes its session', async () => {
      const res = await site({ kind: 'QUESTION', message: 'Hi', contact: 'ion@mail.md' }, 'Bearer not-a-token');
      expect(res.statusCode).toBe(401);
      expect(service.createFromSite).not.toHaveBeenCalled();
    });

    it('lets the honeypot field through to the service, which drops it', async () => {
      const res = await site({ kind: 'QUESTION', message: 'Hi', contact: 'bot@spam.io', website: 'spam' });
      expect(res.statusCode).toBe(204);
      expect(service.createFromSite).toHaveBeenCalledWith(null, expect.objectContaining({ website: 'spam' }));
    });

    it.each([
      ['an empty message', { kind: 'QUESTION', message: '  ', contact: 'ion@mail.md' }],
      [
        'a message over the limit',
        { kind: 'QUESTION', message: 'x'.repeat(FEEDBACK_MESSAGE_MAX_LENGTH + 1), contact: 'ion@mail.md' },
      ],
      ['a name over the limit', { kind: 'QUESTION', message: 'Hi', name: 'x'.repeat(81), contact: 'ion@mail.md' }],
      ['a contact over the limit', { kind: 'QUESTION', message: 'Hi', contact: `${'x'.repeat(200)}@mail.md` }],
      ['a topic that is not a support topic', { kind: 'PLAN_CHANGE', message: 'Hi', contact: 'ion@mail.md' }],
      ['an unknown field', { kind: 'QUESTION', message: 'Hi', contact: 'ion@mail.md', userId: 'ana' }],
    ])('refuses %s with 400', async (_, payload) => {
      expect((await site(payload)).statusCode).toBe(400);
      expect(service.createFromSite).not.toHaveBeenCalled();
    });
  });

  describe('POST /admin/support', () => {
    const support = async (payload: Record<string, unknown>, as: string, query = '') =>
      app.inject({
        method: 'POST',
        url: `/admin/support${query}`,
        headers: { authorization: `Bearer ${await tokenFor(as)}` },
        payload,
      });

    it('files a business question under the brand picked in the header', async () => {
      const res = await support({ kind: 'QUESTION', message: '  Как подключить карты?  ' }, 'owner', '?brandId=b1');

      expect(res.statusCode).toBe(201);
      expect(service.createFromBusiness).toHaveBeenCalledWith('owner', 'b1', {
        kind: 'QUESTION',
        message: 'Как подключить карты?',
      });
    });

    it('falls back to the first brand of the caller', async () => {
      await support({ kind: 'PROBLEM', message: 'Не грузится меню' }, 'owner');
      expect(service.createFromBusiness).toHaveBeenCalledWith('owner', 'b1', expect.anything());
    });

    it('refuses a brand that is not theirs, customers and the platform admin', async () => {
      expect((await support({ kind: 'QUESTION', message: 'Hi' }, 'owner', '?brandId=b2')).statusCode).toBe(403);
      expect((await support({ kind: 'QUESTION', message: 'Hi' }, 'ana')).statusCode).toBe(403);
      expect((await support({ kind: 'QUESTION', message: 'Hi' }, 'root')).statusCode).toBe(403);
      expect(service.createFromBusiness).not.toHaveBeenCalled();
    });

    it('refuses a topic that is not a support topic', async () => {
      expect((await support({ kind: 'PLAN_CHANGE', message: 'PRO' }, 'owner')).statusCode).toBe(400);
      expect((await support({ kind: 'REVIEW', message: 'Nice' }, 'owner')).statusCode).toBe(400);
    });
  });

  describe('/admin/feedback', () => {
    const get = async (url: string, as: string) =>
      app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${await tokenFor(as)}` } });

    it('is for the platform admin only', async () => {
      expect((await get('/admin/feedback', 'ana')).statusCode).toBe(403);
      expect((await get('/admin/feedback', 'owner')).statusCode).toBe(403);
      expect((await get('/admin/feedback/new-count', 'owner')).statusCode).toBe(403);
      expect(service.list).not.toHaveBeenCalled();
    });

    it('lists with the filters parsed from the query string', async () => {
      const res = await get('/admin/feedback?status=NEW&kind=PROBLEM&page=2&pageSize=10', 'root');
      expect(res.statusCode).toBe(200);
      expect(service.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'NEW', kind: 'PROBLEM', page: 2, pageSize: 10 }),
      );
    });

    it('answers the unread count', async () => {
      const res = await get('/admin/feedback/new-count', 'root');
      expect(res.json()).toEqual({ count: 3 });
    });

    it('changes the status, and refuses one it does not know', async () => {
      const token = await tokenFor('root');
      const patch = (status: string) =>
        app.inject({
          method: 'PATCH',
          url: '/admin/feedback/fb-1',
          headers: { authorization: `Bearer ${token}` },
          payload: { status },
        });

      expect((await patch('ARCHIVED')).statusCode).toBe(200);
      expect(service.setStatus).toHaveBeenCalledWith('fb-1', 'ARCHIVED');
      expect((await patch('DELETED')).statusCode).toBe(400);
    });
  });
});

/** The per-client cap on the site's support form, through the real throttler guard. */
describe('POST /feedback/support throttling', () => {
  let app: NestFastifyApplication;
  const service = { createFromSite: jest.fn(async () => undefined) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }])],
      controllers: [FeedbackController],
      providers: [
        { provide: APP_GUARD, useClass: AppThrottlerGuard },
        { provide: FeedbackService, useValue: service },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets one address send a few messages an hour, then answers 429', async () => {
    const post = () =>
      app.inject({
        method: 'POST',
        url: '/feedback/support',
        payload: { kind: 'QUESTION', message: 'Hi', contact: 'ion@mail.md' },
      });

    for (let i = 0; i < SITE_SUPPORT_PER_HOUR; i++) expect((await post()).statusCode).toBe(204);
    expect((await post()).statusCode).toBe(429);
    expect(service.createFromSite).toHaveBeenCalledTimes(SITE_SUPPORT_PER_HOUR);
  });
});
