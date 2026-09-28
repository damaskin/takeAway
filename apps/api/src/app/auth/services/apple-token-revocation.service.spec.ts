import { generateKeyPairSync } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import axios, { AxiosError, AxiosHeaders } from 'axios';

import { APPLE_REVOKE_URL, APPLE_TOKEN_URL, AppleTokenRevocationService } from './apple-token-revocation.service';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const CODE = 'c0de-from-sign-in-with-apple';

function configWith(overrides: Record<string, string | undefined> = {}): ConfigService {
  const env: Record<string, string | undefined> = {
    APPLE_TEAM_ID: 'FGN8R2D6QW',
    APPLE_KEY_ID: 'KEY123ABCD',
    // One line with literal "\n", the way env files carry it.
    APPLE_PRIVATE_KEY: PRIVATE_PEM.replace(/\n/g, '\\n'),
    APPLE_OAUTH_CLIENT_IDS: 'md.takeaway.web,md.takeaway.ios',
    APPLE_OAUTH_SERVICES_ID: 'md.takeaway.web',
    ...overrides,
  };
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

function appleError(status: number, error: string): AxiosError {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: 'Bad Request',
    data: { error },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

/** URL, form fields and options of the n-th `axios.post` call. */
function callOf(post: jest.SpyInstance, n: number): { url: string; form: Record<string, string>; options: unknown } {
  const [url, body, options] = post.mock.calls[n] as [string, string, unknown];
  return { url, form: Object.fromEntries(new URLSearchParams(body)), options };
}

function formOf(post: jest.SpyInstance, n: number): Record<string, string> {
  return callOf(post, n).form;
}

describe('AppleTokenRevocationService', () => {
  let post: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    post = jest.spyOn(axios, 'post');
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exchanges the code for the iOS bundle id and revokes the refresh token', async () => {
    post
      .mockResolvedValueOnce({ data: { access_token: 'at-1', refresh_token: 'rt-1', id_token: 'x.y.z' } })
      .mockResolvedValueOnce({ data: '' });
    const svc = new AppleTokenRevocationService(configWith());

    await expect(svc.revokeAuthorizationCode(CODE, 'ana')).resolves.toBe('revoked');

    expect(post).toHaveBeenCalledTimes(2);
    expect(callOf(post, 0).url).toBe(APPLE_TOKEN_URL);
    expect(callOf(post, 0).options).toMatchObject({
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const exchange = formOf(post, 0);
    expect(exchange).toMatchObject({ grant_type: 'authorization_code', code: CODE, client_id: 'md.takeaway.ios' });

    expect(callOf(post, 1).url).toBe(APPLE_REVOKE_URL);
    const revoke = formOf(post, 1);
    expect(revoke).toEqual({
      client_id: 'md.takeaway.ios',
      client_secret: exchange['client_secret'],
      token: 'rt-1',
      token_type_hint: 'refresh_token',
    });
  });

  it('signs the client secret as Apple specifies: ES256, kid, team, client id, short expiry', async () => {
    post.mockResolvedValueOnce({ data: { refresh_token: 'rt-1' } }).mockResolvedValueOnce({ data: '' });
    await new AppleTokenRevocationService(configWith()).revokeAuthorizationCode(CODE, 'ana');

    const secret = formOf(post, 0)['client_secret'] as string;
    const jwt = new JwtService();
    const claims = jwt.verify<{ iss: string; sub: string; aud: string; iat: number; exp: number }>(secret, {
      publicKey: PUBLIC_PEM,
      algorithms: ['ES256'],
    });
    expect(claims).toMatchObject({ iss: 'FGN8R2D6QW', sub: 'md.takeaway.ios', aud: 'https://appleid.apple.com' });
    expect(claims.exp - claims.iat).toBeGreaterThan(0);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(15_777_000);
    expect(jwt.decode(secret, { complete: true })).toMatchObject({ header: { alg: 'ES256', kid: 'KEY123ABCD' } });
  });

  it('falls back to the access token when Apple returns no refresh token', async () => {
    post.mockResolvedValueOnce({ data: { access_token: 'at-1' } }).mockResolvedValueOnce({ data: '' });
    await expect(new AppleTokenRevocationService(configWith()).revokeAuthorizationCode(CODE, 'ana')).resolves.toBe(
      'revoked',
    );
    expect(formOf(post, 1)).toMatchObject({ token: 'at-1', token_type_hint: 'access_token' });
  });

  it('uses APPLE_REVOKE_CLIENT_ID when it is set', async () => {
    post.mockResolvedValueOnce({ data: { refresh_token: 'rt-1' } }).mockResolvedValueOnce({ data: '' });
    await new AppleTokenRevocationService(
      configWith({ APPLE_REVOKE_CLIENT_ID: 'md.takeaway.other' }),
    ).revokeAuthorizationCode(CODE, 'ana');
    expect(formOf(post, 0)['client_id']).toBe('md.takeaway.other');
    expect(formOf(post, 1)['client_id']).toBe('md.takeaway.other');
  });

  it.each([
    ['the team id', { APPLE_TEAM_ID: undefined }],
    ['the key id', { APPLE_KEY_ID: undefined }],
    ['the private key', { APPLE_PRIVATE_KEY: '' }],
    ['an app client id', { APPLE_OAUTH_CLIENT_IDS: 'md.takeaway.web' }],
  ])('skips with one warning and no HTTP call when %s is missing', async (_label, overrides) => {
    const svc = new AppleTokenRevocationService(configWith(overrides));
    await expect(svc.revokeAuthorizationCode(CODE, 'ana')).resolves.toBe('skipped');
    expect(post).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reports a failed exchange without throwing and without leaking the code or the secret', async () => {
    post.mockRejectedValueOnce(appleError(400, 'invalid_grant'));
    const svc = new AppleTokenRevocationService(configWith());

    await expect(svc.revokeAuthorizationCode(CODE, 'ana')).resolves.toBe('failed');

    expect(post).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('HTTP 400 invalid_grant');
    expect(logged).not.toContain(CODE);
    expect(logged).not.toContain(formOf(post, 0)['client_secret'] as string);
  });

  it('reports a failed revoke without throwing and without leaking the token', async () => {
    post
      .mockResolvedValueOnce({ data: { refresh_token: 'rt-secret' } })
      .mockRejectedValueOnce(new AxiosError('timeout of 5000ms exceeded', 'ECONNABORTED'));
    const svc = new AppleTokenRevocationService(configWith());

    await expect(svc.revokeAuthorizationCode(CODE, 'ana')).resolves.toBe('failed');

    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('revoke the refresh token (ECONNABORTED)');
    expect(logged).not.toContain('rt-secret');
  });

  it('fails soft when Apple answers without any token', async () => {
    post.mockResolvedValueOnce({ data: {} });
    await expect(new AppleTokenRevocationService(configWith()).revokeAuthorizationCode(CODE, 'ana')).resolves.toBe(
      'failed',
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('fails soft when the private key is not a usable ES256 key', async () => {
    const svc = new AppleTokenRevocationService(configWith({ APPLE_PRIVATE_KEY: 'not-a-pem' }));
    await expect(svc.revokeAuthorizationCode(CODE, 'ana')).resolves.toBe('failed');
    expect(post).not.toHaveBeenCalled();
  });
});
