import { Controller, Get, Req } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { resolveTrustProxy } from './trust-proxy';

describe('resolveTrustProxy', () => {
  it('trusts exactly one hop — our nginx — by default', () => {
    expect(resolveTrustProxy(undefined)).toBe(1);
    expect(resolveTrustProxy('')).toBe(1);
    expect(resolveTrustProxy('  ')).toBe(1);
  });

  it('never goes back to trusting the whole chain', () => {
    expect(resolveTrustProxy('true')).toBe(1);
  });

  it('takes a hop count, an off switch, or a list of addresses', () => {
    expect(resolveTrustProxy('2')).toBe(2);
    expect(resolveTrustProxy('0')).toBe(false);
    expect(resolveTrustProxy('false')).toBe(false);
    expect(resolveTrustProxy('172.18.0.0/16, 10.0.0.5')).toEqual(['172.18.0.0/16', '10.0.0.5']);
  });
});

@Controller()
class WhoAmIController {
  @Get('ip')
  ip(@Req() req: { ip: string }): { ip: string } {
    return { ip: req.ip };
  }
}

/** What `request.ip` comes out as behind nginx, which sets X-Forwarded-For to one address. */
describe('request.ip behind our nginx', () => {
  async function appWith(trustProxy: boolean | number | string[]): Promise<NestFastifyApplication> {
    const moduleRef = await Test.createTestingModule({ controllers: [WhoAmIController] }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ trustProxy }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  }

  async function ipFor(app: NestFastifyApplication, xff?: string): Promise<string> {
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '172.18.0.5', // the nginx container
      headers: xff ? { 'x-forwarded-for': xff } : {},
    });
    return (res.json() as { ip: string }).ip;
  }

  it('is the address nginx put last, whatever the client prepended', async () => {
    const app = await appWith(resolveTrustProxy(undefined));
    try {
      expect(await ipFor(app, '203.0.113.9')).toBe('203.0.113.9');
      // A client-supplied X-Forwarded-For that slipped through ahead of ours.
      expect(await ipFor(app, '1.2.3.4, 203.0.113.9')).toBe('203.0.113.9');
      // No proxy header at all: a request from inside the docker network.
      expect(await ipFor(app)).toBe('172.18.0.5');
    } finally {
      await app.close();
    }
  });

  it('was the client-chosen first address with trustProxy: true — the hole this closes', async () => {
    const app = await appWith(true);
    try {
      expect(await ipFor(app, '1.2.3.4, 203.0.113.9')).toBe('1.2.3.4');
    } finally {
      await app.close();
    }
  });
});
