import { allowedCorsOrigins, corsOriginCheck, isAllowedOrigin } from './cors-origins';

describe('CORS origins', () => {
  const prod = { NODE_ENV: 'production' };

  it('falls back to the production sites, not to every origin, when unset', () => {
    expect(allowedCorsOrigins(prod)).toEqual([
      'https://takeaway.md',
      'https://www.takeaway.md',
      'https://admin.takeaway.md',
      'https://kds.takeaway.md',
      'https://tma.takeaway.md',
    ]);
    expect(isAllowedOrigin('https://admin.takeaway.md', prod)).toBe(true);
    expect(isAllowedOrigin('https://evil.example', prod)).toBe(false);
    expect(isAllowedOrigin('https://takeaway.md.evil.example', prod)).toBe(false);
  });

  it('uses CORS_ALLOWED_ORIGINS when set, trimming spaces and trailing slashes', () => {
    const env = { ...prod, CORS_ALLOWED_ORIGINS: ' https://a.example/ ,https://b.example' };
    expect(allowedCorsOrigins(env)).toEqual(['https://a.example', 'https://b.example']);
    expect(isAllowedOrigin('https://b.example', env)).toBe(true);
    expect(isAllowedOrigin('https://takeaway.md', env)).toBe(false);
  });

  it('lets localhost in only outside production', () => {
    expect(isAllowedOrigin('http://localhost:4202', {})).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:4200', { NODE_ENV: 'development' })).toBe(true);
    expect(isAllowedOrigin('http://localhost:4202', prod)).toBe(false);
    expect(isAllowedOrigin('http://localhost.evil.example', {})).toBe(false);
  });

  it('leaves requests without an Origin alone — the mobile apps and the bank callbacks', () => {
    expect(isAllowedOrigin(undefined, prod)).toBe(true);
  });

  it('answers through the (origin, callback) shape @fastify/cors and socket.io expect', () => {
    const check = corsOriginCheck(prod);
    const cb = jest.fn();
    check('https://tma.takeaway.md', cb);
    check('https://evil.example', cb);
    expect(cb.mock.calls).toEqual([
      [null, true],
      [null, false],
    ]);
  });
});
