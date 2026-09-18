import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { OAuthIdentityService } from './oauth-identity.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Signs tokens with a throwaway RSA pair and serves the matching JWK from a
 * stubbed JWKS endpoint, so the whole verify path — signature, issuer,
 * audience, expiry — runs for real without touching the network.
 */
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key-1';

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const APPLE_JWKS = 'https://appleid.apple.com/auth/keys';

function jwkFor(key: KeyObject, kid: string): Record<string, unknown> {
  return { ...key.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
}

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(payload: Record<string, unknown>, header: Record<string, unknown> = {}): string {
  const encodedHeader = b64url({ alg: 'RS256', kid: KID, typ: 'JWT', ...header });
  const encodedPayload = b64url(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createSign('RSA-SHA256').update(signingInput).end().sign(privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

function googlePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: 'web-client.apps.googleusercontent.com',
    sub: '110000000000000000001',
    email: 'Sam@Example.com',
    email_verified: true,
    given_name: 'Sam',
    family_name: 'Rivera',
    locale: 'ru-RU',
    iat: nowSeconds(),
    exp: nowSeconds() + 3600,
    ...overrides,
  };
}

function applePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://appleid.apple.com',
    aud: 'com.takeaway.web',
    sub: '001234.abcdef.0001',
    email: 'kx9@privaterelay.appleid.com',
    // Apple sends its booleans as strings — the service has to cope.
    email_verified: 'true',
    is_private_email: 'true',
    iat: nowSeconds(),
    exp: nowSeconds() + 3600,
    ...overrides,
  };
}

const ENV = {
  GOOGLE_OAUTH_CLIENT_IDS: 'web-client.apps.googleusercontent.com, ios-client.apps.googleusercontent.com',
  APPLE_OAUTH_CLIENT_IDS: 'com.takeaway.web',
};

function makeService(env: Record<string, string> = ENV): OAuthIdentityService {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new OAuthIdentityService(config);
}

describe('OAuthIdentityService', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedAxios.get.mockResolvedValue({ data: { keys: [jwkFor(publicKey, KID)] } } as never);
  });

  it('verifies a Google token and normalises the profile', async () => {
    const identity = await makeService().verify('GOOGLE', sign(googlePayload()));

    expect(identity).toEqual({
      provider: 'GOOGLE',
      providerUserId: '110000000000000000001',
      email: 'Sam@Example.com',
      emailVerified: true,
      isPrivateEmail: false,
      name: 'Sam Rivera',
      locale: 'ru-RU',
    });
  });

  it('accepts any of the configured client ids', async () => {
    const token = sign(googlePayload({ aud: 'ios-client.apps.googleusercontent.com' }));
    await expect(makeService().verify('GOOGLE', token)).resolves.toMatchObject({ provider: 'GOOGLE' });
  });

  it('reads Apple string booleans and flags private-relay addresses', async () => {
    const identity = await makeService().verify('APPLE', sign(applePayload()));

    expect(identity.emailVerified).toBe(true);
    expect(identity.isPrivateEmail).toBe(true);
    // Apple never puts a name in the token; the caller supplies it once.
    expect(identity.name).toBeNull();
  });

  it('rejects a token minted for a different application', async () => {
    const token = sign(googlePayload({ aud: 'someone-elses-app.apps.googleusercontent.com' }));
    await expect(makeService().verify('GOOGLE', token)).rejects.toThrow('not issued for this application');
  });

  it('rejects a token from an unexpected issuer', async () => {
    const token = sign(googlePayload({ iss: 'https://accounts.evil.example' }));
    await expect(makeService().verify('GOOGLE', token)).rejects.toThrow('unexpected party');
  });

  it('rejects an expired token', async () => {
    const token = sign(googlePayload({ iat: nowSeconds() - 7200, exp: nowSeconds() - 3600 }));
    await expect(makeService().verify('GOOGLE', token)).rejects.toThrow('expired');
  });

  it('rejects a tampered payload', async () => {
    const token = sign(googlePayload());
    const [header, , signature] = token.split('.');
    const forged = `${header}.${b64url(googlePayload({ sub: 'attacker' }))}.${signature}`;

    await expect(makeService().verify('GOOGLE', forged)).rejects.toThrow('signature is invalid');
  });

  it('refuses anything but RS256, so `alg: none` cannot walk in', async () => {
    const unsigned = `${b64url({ alg: 'none', kid: KID })}.${b64url(googlePayload())}.`;
    await expect(makeService().verify('GOOGLE', unsigned)).rejects.toThrow('Unsupported identity-token algorithm');
  });

  it('rejects a token signed with an unknown key id', async () => {
    const token = sign(googlePayload(), { kid: 'rotated-away' });
    await expect(makeService().verify('GOOGLE', token)).rejects.toThrow('unknown key');
  });

  it('refuses the provider outright when no client ids are configured', async () => {
    const svc = makeService({ GOOGLE_OAUTH_CLIENT_IDS: '' });
    expect(svc.isConfigured('GOOGLE')).toBe(false);
    await expect(svc.verify('GOOGLE', sign(googlePayload()))).rejects.toThrow('not configured');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('caches the key set instead of refetching it per request', async () => {
    const svc = makeService();
    await svc.verify('GOOGLE', sign(googlePayload()));
    await svc.verify('GOOGLE', sign(googlePayload({ sub: 'another-user' })));

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledWith(GOOGLE_JWKS, expect.anything());
  });

  it('keeps each provider on its own key set', async () => {
    const svc = makeService();
    await svc.verify('GOOGLE', sign(googlePayload()));
    await svc.verify('APPLE', sign(applePayload()));

    expect(mockedAxios.get.mock.calls.map(([url]) => url)).toEqual([GOOGLE_JWKS, APPLE_JWKS]);
  });

  it('reports the provider unavailable when the JWKS cannot be fetched', async () => {
    mockedAxios.get.mockRejectedValue(new Error('ECONNRESET'));
    await expect(makeService().verify('APPLE', sign(applePayload()))).rejects.toThrow('temporarily unavailable');
  });
});
