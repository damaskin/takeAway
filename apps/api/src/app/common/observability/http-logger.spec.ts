import { Writable } from 'node:stream';

import pino, { type LoggerOptions } from 'pino';

import { httpLoggerParams } from './http-logger';

describe('httpLoggerParams', () => {
  function capture(): { stream: Writable; output: () => string } {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    return { stream, output: () => chunks.join('') };
  }

  it('never writes bearer tokens, cookies or signatures into request logs', () => {
    const options = httpLoggerParams({ NODE_ENV: 'production' }).pinoHttp as LoggerOptions;
    const { stream, output } = capture();
    const logger = pino({ redact: options.redact }, stream);

    logger.info(
      {
        req: {
          method: 'GET',
          url: '/api/me/orders',
          headers: {
            authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.live-session',
            cookie: 'refresh=live-refresh-token',
            'stripe-signature': 't=1,v1=live-signature',
            accept: 'application/json',
          },
        },
        res: { statusCode: 200, headers: { 'set-cookie': 'refresh=rotated-token' } },
      },
      'request completed',
    );

    const line = output();
    expect(line).not.toMatch(/live-session|live-refresh-token|live-signature|rotated-token/);
    expect(line).toContain('[redacted]');
    // Everything else in the line survives.
    expect(line).toContain('/api/me/orders');
    expect(line).toContain('application/json');
  });

  it('pretty-prints outside production only', () => {
    expect((httpLoggerParams({ NODE_ENV: 'production' }).pinoHttp as LoggerOptions).transport).toBeUndefined();
    expect((httpLoggerParams({ NODE_ENV: 'development' }).pinoHttp as LoggerOptions).transport).toBeDefined();
  });
});
