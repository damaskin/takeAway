import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { ORDER_REVIEW_COMMENT_MAX_LENGTH } from '@takeaway/shared-types';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AdminOrderReviewsController } from './admin-order-reviews.controller';
import { OrderReviewsController } from './order-reviews.controller';
import { OrderReviewsService } from './order-reviews.service';

const SECRET = 'test-access-secret';

/**
 * `POST /orders/:id/review` and `GET /admin/order-reviews` over HTTP, through
 * the real JWT and role guards and the production validation pipe; the
 * service is faked.
 */
describe('order review endpoints', () => {
  let app: NestFastifyApplication;
  let jwt: JwtService;
  const roles = new Map<string, Role>([
    ['ana', Role.CUSTOMER],
    ['root', Role.SUPER_ADMIN],
    ['owner', Role.BRAND_ADMIN],
    ['manager', Role.STORE_MANAGER],
    ['barista', Role.STAFF],
  ]);
  const emptyPage = {
    items: [],
    total: 0,
    page: 1,
    pageSize: 25,
    count: 0,
    averageRating: null,
    ratingCounts: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
  };
  const service = {
    create: jest.fn(async () => ({ id: 'order-1', canReview: false, review: { rating: 5 } })),
    list: jest.fn(async () => emptyPage),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({ secret: SECRET })],
      controllers: [OrderReviewsController, AdminOrderReviewsController],
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
        // JwtStrategy reads a kitchen PIN session's stores; these sessions are all password ones.
        { provide: PrismaService, useValue: {} },
        { provide: OrderReviewsService, useValue: service },
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
  const auth = async (as: string | null) => (as ? { authorization: `Bearer ${await tokenFor(as)}` } : undefined);

  describe('POST /orders/:id/review', () => {
    const send = async (payload: Record<string, unknown>, as: string | null = 'ana') =>
      app.inject({ method: 'POST', url: '/orders/order-1/review', headers: await auth(as), payload });

    it('needs a signed-in account', async () => {
      const res = await send({ rating: 5 }, null);
      expect(res.statusCode).toBe(401);
      expect(service.create).not.toHaveBeenCalled();
    });

    it('saves it for the caller with the comment trimmed and answers 201 with the order', async () => {
      const res = await send({ rating: 4, comment: '  Вкусно  ' });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ id: 'order-1', canReview: false, review: { rating: 5 } });
      expect(service.create).toHaveBeenCalledWith('ana', 'order-1', { rating: 4, comment: 'Вкусно' });
    });

    it('drops a blank comment', async () => {
      await send({ rating: 3, comment: '   ' });
      expect(service.create).toHaveBeenCalledWith('ana', 'order-1', { rating: 3, comment: undefined });
    });

    it.each([
      ['no rating', {}],
      ['zero stars', { rating: 0 }],
      ['six stars', { rating: 6 }],
      ['half a star', { rating: 4.5 }],
      ['a word for a rating', { rating: 'five' }],
      ['a comment over the limit', { rating: 5, comment: 'x'.repeat(ORDER_REVIEW_COMMENT_MAX_LENGTH + 1) }],
      ['an unknown field', { rating: 5, brandId: 'brand-1' }],
    ])('refuses %s with 400', async (_, payload) => {
      const res = await send(payload);
      expect(res.statusCode).toBe(400);
      expect(service.create).not.toHaveBeenCalled();
    });

    it('takes a comment of exactly the limit', async () => {
      const res = await send({ rating: 5, comment: 'x'.repeat(ORDER_REVIEW_COMMENT_MAX_LENGTH) });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('GET /admin/order-reviews', () => {
    const list = async (query: string, as: string | null = 'root') =>
      app.inject({ method: 'GET', url: `/admin/order-reviews${query}`, headers: await auth(as) });

    it('is for the platform admin only — brands never see their reviews', async () => {
      for (const who of ['owner', 'manager', 'barista', 'ana']) {
        const res = await list('', who);
        expect(res.statusCode).toBe(403);
      }
      expect((await list('', null)).statusCode).toBe(401);
      expect(service.list).not.toHaveBeenCalled();
    });

    it('passes the filters on, typed', async () => {
      const res = await list(
        '?brandId=brand-1&rating=5&from=2026-11-01T00:00:00.000Z&to=2026-11-08T00:00:00.000Z&page=2&pageSize=10',
      );

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(emptyPage);
      expect(service.list).toHaveBeenCalledWith({
        brandId: 'brand-1',
        rating: 5,
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-11-08T00:00:00.000Z',
        page: 2,
        pageSize: 10,
      });
    });

    it.each([
      ['a rating of 7', '?rating=7'],
      ['a rating of 0', '?rating=0'],
      ['a date that is not one', '?from=yesterday'],
      ['a page of 0', '?page=0'],
      ['a page size over 100', '?pageSize=500'],
      ['an unknown filter', '?status=NEW'],
    ])('refuses %s with 400', async (_, query) => {
      const res = await list(query);
      expect(res.statusCode).toBe(400);
      expect(service.list).not.toHaveBeenCalled();
    });
  });
});
