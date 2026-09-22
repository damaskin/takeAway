import { BadRequestException, Controller, Get, NotFoundException } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { SentryExceptionFilter } from './sentry-exception.filter';

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

@Controller('boom')
class BoomController {
  @Get('missing')
  missing(): never {
    throw new NotFoundException('Product not found');
  }

  @Get('invalid')
  invalid(): never {
    throw new BadRequestException(['slug must be unique']);
  }

  @Get('unknown')
  unknown(): never {
    throw new Error('database is on fire');
  }
}

/**
 * Regression guard for the filter wiring in `main.ts`. Built without an
 * adapter, BaseExceptionFilter reaches for `applicationRef.isHeadersSent` on
 * `undefined` and every single error response — a 404 as much as a 500 —
 * comes back as `Cannot read properties of undefined (reading
 * 'isHeadersSent')`, hiding what actually went wrong from every client.
 */
describe('SentryExceptionFilter', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [BoomController] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalFilters(new SentryExceptionFilter(app.getHttpAdapter()));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('renders a 404 as a 404, with its own message', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom/missing' });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ statusCode: 404, message: 'Product not found' });
  });

  it('keeps validation detail on a 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom/invalid' });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toEqual(['slug must be unique']);
  });

  it('renders an unexpected throw as a plain 500', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom/unknown' });

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('isHeadersSent');
  });

  it('reports faults to Sentry but stays quiet about routine rejections', async () => {
    const { captureException } = jest.requireMock('@sentry/node') as { captureException: jest.Mock };
    captureException.mockClear();

    await app.inject({ method: 'GET', url: '/boom/missing' });
    expect(captureException).not.toHaveBeenCalled();

    await app.inject({ method: 'GET', url: '/boom/unknown' });
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
