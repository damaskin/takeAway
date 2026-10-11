import { type CanActivate, Controller, type ExecutionContext, Get, Injectable } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

import { resolveTrustProxy } from '../../common/http/trust-proxy';
import { AppThrottlerGuard, throttleTracker } from './app-throttler.guard';

describe('throttleTracker', () => {
  it('keys a signed-in request on the account', () => {
    expect(throttleTracker({ ip: '203.0.113.9', user: { id: 'user-1' } })).toBe('user:user-1');
  });

  it('keys an anonymous request on the client address', () => {
    expect(throttleTracker({ ip: '203.0.113.9' })).toBe('ip:203.0.113.9');
    expect(throttleTracker({ ip: '203.0.113.9', user: {} })).toBe('ip:203.0.113.9');
  });
});

/** Stands in for the JWT guard, which runs before the throttler in AuthModule. */
@Injectable()
class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: { id: string } }>();
    const userId = req.headers['x-test-user'];
    if (userId) req.user = { id: userId };
    return true;
  }
}

@Controller()
class PingController {
  @Get('ping')
  ping(): { ok: true } {
    return { ok: true };
  }
}

/**
 * Through Fastify with the production proxy setting: two requests a minute,
 * then 429. A client changing its own X-Forwarded-For per request used to get
 * a fresh budget each time.
 */
describe('AppThrottlerGuard over HTTP', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 2 }])],
      controllers: [PingController],
      providers: [
        { provide: APP_GUARD, useClass: FakeJwtGuard },
        { provide: APP_GUARD, useClass: AppThrottlerGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ trustProxy: resolveTrustProxy(undefined) }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  /** nginx sets X-Forwarded-For to the visitor; anything before it is the client's own. */
  const ping = (visitor: string, spoofed?: string, user?: string) =>
    app.inject({
      method: 'GET',
      url: '/ping',
      remoteAddress: '172.18.0.5',
      headers: {
        'x-forwarded-for': spoofed ? `${spoofed}, ${visitor}` : visitor,
        ...(user ? { 'x-test-user': user } : {}),
      },
    });

  it('cannot be dodged by changing the client-side X-Forwarded-For', async () => {
    expect((await ping('203.0.113.9', '1.1.1.1')).statusCode).toBe(200);
    expect((await ping('203.0.113.9', '2.2.2.2')).statusCode).toBe(200);
    expect((await ping('203.0.113.9', '3.3.3.3')).statusCode).toBe(429);
  });

  it('gives every visitor a budget of their own', async () => {
    await ping('203.0.113.9');
    await ping('203.0.113.9');
    expect((await ping('203.0.113.9')).statusCode).toBe(429);
    expect((await ping('198.51.100.7')).statusCode).toBe(200);
  });

  it('counts a signed-in account across addresses, and apart from its network', async () => {
    expect((await ping('203.0.113.9', undefined, 'ana')).statusCode).toBe(200);
    expect((await ping('198.51.100.7', undefined, 'ana')).statusCode).toBe(200);
    expect((await ping('192.0.2.1', undefined, 'ana')).statusCode).toBe(429);
    // Someone else on Ana's first network is not affected by her budget.
    expect((await ping('203.0.113.9', undefined, 'bob')).statusCode).toBe(200);
  });
});
