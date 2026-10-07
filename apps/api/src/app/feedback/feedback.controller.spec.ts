import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { FEEDBACK_MESSAGE_MAX_LENGTH } from '@takeaway/shared-types';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { UsersService } from '../users/users.service';
import { AdminFeedbackController } from './admin-feedback.controller';
import { FeedbackController } from './feedback.controller';
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
    list: jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 25, newCount: 0 })),
    newCount: jest.fn(async () => ({ count: 3 })),
    setStatus: jest.fn(async () => ({ id: 'fb-1', status: 'READ' })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({ secret: SECRET })],
      controllers: [FeedbackController, AdminFeedbackController],
      providers: [
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
