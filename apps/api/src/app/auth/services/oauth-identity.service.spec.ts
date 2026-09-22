import { createSign, generateKeyPairSync, sign as signRaw, type KeyObject } from 'node:crypto';

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

describe('OAuthIdentityService — Telegram Login', () => {
  const TELEGRAM_JWKS = 'https://oauth.telegram.org/.well-known/jwks.json';
  const BOT_ID = '7412345678';
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ed = generateKeyPairSync('ed25519');

  /** Telegram's key set has all four of its algorithms; we may only use two. */
  function telegramJwks(): Record<string, unknown>[] {
    return [
      { ...publicKey.export({ format: 'jwk' }), kid: 'oidc-1', alg: 'RS256' },
      { ...ec.publicKey.export({ format: 'jwk' }), kid: 'oidc-es256-1', alg: 'ES256', use: 'sig' },
      { ...ed.publicKey.export({ format: 'jwk' }), kid: 'oidc-eddsa-1', alg: 'EdDSA', use: 'sig' },
    ];
  }

  function telegramPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      iss: 'https://oauth.telegram.org',
      aud: BOT_ID,
      sub: '1234123412341234123',
      iat: nowSeconds(),
      exp: nowSeconds() + 3600,
      id: 987654321,
      name: 'Иван Дамаскин',
      given_name: 'Иван',
      family_name: 'Дамаскин',
      preferred_username: 'ivan',
      picture: 'https://cdn4.telesco.pe/file/x.jpg',
      ...overrides,
    };
  }

  function signEs256(payload: Record<string, unknown>, kid = 'oidc-es256-1'): string {
    const signingInput = `${b64url({ alg: 'ES256', kid, typ: 'JWT' })}.${b64url(payload)}`;
    const signature = signRaw('sha256', Buffer.from(signingInput), { key: ec.privateKey, dsaEncoding: 'ieee-p1363' });
    return `${signingInput}.${signature.toString('base64url')}`;
  }

  const telegramEnv = { TELEGRAM_BOT_TOKEN: `${BOT_ID}:AAH-secret` };

  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedAxios.get.mockResolvedValue({ data: { keys: telegramJwks() } } as never);
  });

  it('verifies an RS256 token for our bot and keys the customer on the Telegram user id', async () => {
    const identity = await makeService(telegramEnv).verifyTelegram(sign(telegramPayload(), { kid: 'oidc-1' }));

    expect(identity).toEqual({ id: 987654321, firstName: 'Иван', lastName: 'Дамаскин', username: 'ivan' });
    expect(mockedAxios.get).toHaveBeenCalledWith(TELEGRAM_JWKS, expect.anything());
  });

  it('verifies ES256, the other algorithm a bot can pick in @BotFather', async () => {
    const identity = await makeService(telegramEnv).verifyTelegram(signEs256(telegramPayload()));
    expect(identity.id).toBe(987654321);
  });

  it('will not check an ES256 header against an RSA key', async () => {
    const token = signEs256(telegramPayload(), 'oidc-1');
    await expect(makeService(telegramEnv).verifyTelegram(token)).rejects.toThrow('signature is invalid');
  });

  it('refuses the Web3 algorithms, which come without a user id', async () => {
    const unsigned = `${b64url({ alg: 'EdDSA', kid: 'oidc-eddsa-1' })}.${b64url(telegramPayload())}.sig`;
    await expect(makeService(telegramEnv).verifyTelegram(unsigned)).rejects.toThrow(
      'Unsupported identity-token algorithm',
    );
  });

  it('refuses a token without the profile scope instead of creating a stranger account', async () => {
    const token = sign(telegramPayload({ id: undefined, name: undefined }), { kid: 'oidc-1' });
    await expect(makeService(telegramEnv).verifyTelegram(token)).rejects.toThrow('no user id');
  });

  it('rejects a token Telegram signed for another bot', async () => {
    const token = sign(telegramPayload({ aud: '999' }), { kid: 'oidc-1' });
    await expect(makeService(telegramEnv).verifyTelegram(token)).rejects.toThrow('not issued for this application');
  });

  it('uses TELEGRAM_LOGIN_CLIENT_ID when sign-in goes through a different bot', async () => {
    const svc = makeService({ ...telegramEnv, TELEGRAM_LOGIN_CLIENT_ID: '8521897198' });
    const token = sign(telegramPayload({ aud: '8521897198' }), { kid: 'oidc-1' });
    await expect(svc.verifyTelegram(token)).resolves.toMatchObject({ id: 987654321 });
  });

  it('is off until the deployment has a bot', async () => {
    await expect(makeService({}).verifyTelegram(sign(telegramPayload(), { kid: 'oidc-1' }))).rejects.toThrow(
      'not configured',
    );
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
