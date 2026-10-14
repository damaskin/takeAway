import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

import { EmailLoginController } from './email-login.controller';
import { AppThrottlerGuard } from './guards/app-throttler.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { EmailLoginService } from './services/email-login.service';
import { OAuthIdentityService } from './services/oauth-identity.service';
import { TelegramService } from './services/telegram.service';

/**
 * The email sign-in routes over HTTP, through the real global JWT and
 * throttler guards and the production validation pipe; the service is a stub.
 * All three routes are public, so no JWT strategy is needed.
 */
describe('EmailLoginController', () => {
  let app: NestFastifyApplication;
  const emailLogin = {
    isAvailable: jest.fn(() => true),
    start: jest.fn(async () => undefined),
    verify: jest.fn(async () => ({ accessToken: 'a', refreshToken: 'r', user: { id: 'u1' } })),
  };
  const oauth = { isConfigured: jest.fn((provider: string) => provider === 'GOOGLE') };
  const telegram = { publicConfig: jest.fn(() => ({ botId: '1', botUsername: 'bot', clientId: null })) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({ secret: 'test-access-secret' }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }]),
      ],
      controllers: [EmailLoginController],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: AppThrottlerGuard },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: EmailLoginService, useValue: emailLogin },
        { provide: OAuthIdentityService, useValue: oauth },
        { provide: TelegramService, useValue: telegram },
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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const post = (url: string, payload: Record<string, unknown>, remoteAddress = '10.0.0.1') =>
    app.inject({ method: 'POST', url, payload, remoteAddress });

  it('tells signed-out clients which sign-in methods the server can complete', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/methods' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: true, google: true, apple: false, telegram: false });
  });

  it('reports email sign-in off while SMTP is not configured', async () => {
    emailLogin.isAvailable.mockReturnValueOnce(false);
    const res = await app.inject({ method: 'GET', url: '/auth/methods' });
    expect(res.json()).toMatchObject({ email: false });
  });

  it('answers 204 with no body to start, trimming the address', async () => {
    const res = await post('/auth/email/start', { email: ' Ivan@Mail.ru ', locale: 'ru' });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(emailLogin.start).toHaveBeenCalledWith('Ivan@Mail.ru', 'ru');
  });

  it.each([
    ['a malformed address', { email: 'ivan@' }],
    ['no address', { locale: 'ru' }],
    ['an unknown field', { email: 'ivan@mail.ru', phone: '+37377700000' }],
    ['a nonsense locale', { email: 'ivan@mail.ru', locale: 'русский' }],
  ])('refuses %s with 400 and mails nothing', async (_, payload) => {
    const res = await post('/auth/email/start', payload);
    expect(res.statusCode).toBe(400);
    expect(emailLogin.start).not.toHaveBeenCalled();
  });

  it('exchanges a six-digit code for a session', async () => {
    const res = await post('/auth/email/verify', { email: 'ivan@mail.ru', code: '042917' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accessToken: 'a', user: { id: 'u1' } });
    expect(emailLogin.verify).toHaveBeenCalledWith('ivan@mail.ru', '042917');
  });

  it.each(['12345', '1234567', 'abcdef', 42917])(
    'refuses the code %p with 400 before it counts as a try',
    async (code) => {
      const res = await post('/auth/email/verify', { email: 'ivan@mail.ru', code });
      expect(res.statusCode).toBe(400);
      expect(emailLogin.verify).not.toHaveBeenCalled();
    },
  );

  it('limits code requests per client address', async () => {
    // Outside production the limit is 5 × 10 a minute.
    for (let i = 0; i < 50; i++) {
      expect((await post('/auth/email/start', { email: `n${i}@mail.ru` }, '10.9.9.9')).statusCode).toBe(204);
    }
    expect((await post('/auth/email/start', { email: 'n50@mail.ru' }, '10.9.9.9')).statusCode).toBe(429);
    // Another client is not affected.
    expect((await post('/auth/email/start', { email: 'n51@mail.ru' }, '10.9.9.10')).statusCode).toBe(204);
  });
});
