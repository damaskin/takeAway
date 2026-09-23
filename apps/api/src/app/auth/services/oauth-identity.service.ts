import { createPublicKey, createVerify, type JsonWebKey as CryptoJsonWebKey, type KeyObject } from 'node:crypto';

import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { telegramLoginClientId } from './telegram-login-client';

export type OAuthProviderKey = 'GOOGLE' | 'APPLE';

/**
 * Normalised result of verifying a provider's ID token. Everything the
 * sign-in path needs, with provider quirks already ironed out (Apple's
 * string booleans, Google's `locale`, private-relay addresses).
 */
export interface OAuthIdentity {
  provider: OAuthProviderKey;
  /** The provider's stable subject id — what we key `OAuthAccount` on. */
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  /** True for Apple's `@privaterelay.appleid.com` aliases. */
  isPrivateEmail: boolean;
  name: string | null;
  locale: string | null;
}

/**
 * A Telegram Login (OpenID Connect) identity. Keyed on the Telegram user id
 * — the same number the Mini App and the legacy Login Widget report — so a
 * customer lands in one profile whichever way they came in.
 */
export interface TelegramIdentity {
  id: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
}

type JwsAlgorithm = 'RS256' | 'ES256';

interface ProviderDescriptor {
  label: string;
  issuers: readonly string[];
  jwksUri: string;
  /** Signature algorithms accepted from this provider. Never read from the token alone. */
  algorithms: readonly JwsAlgorithm[];
  /** Accepted `aud` values for this deployment; empty means the provider is off. */
  audiences: (config: ConfigService) => string[];
}

function audiencesFromEnv(name: string): (config: ConfigService) => string[] {
  return (config) =>
    (config.get<string>(name) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
}

const PROVIDERS: Record<OAuthProviderKey, ProviderDescriptor> = {
  GOOGLE: {
    label: 'Google',
    // Google has historically issued both forms; accept either.
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    algorithms: ['RS256'],
    audiences: audiencesFromEnv('GOOGLE_OAUTH_CLIENT_IDS'),
  },
  APPLE: {
    label: 'Apple',
    issuers: ['https://appleid.apple.com'],
    jwksUri: 'https://appleid.apple.com/auth/keys',
    algorithms: ['RS256'],
    audiences: audiencesFromEnv('APPLE_OAUTH_CLIENT_IDS'),
  },
};

const TELEGRAM: ProviderDescriptor = {
  label: 'Telegram',
  issuers: ['https://oauth.telegram.org'],
  jwksUri: 'https://oauth.telegram.org/.well-known/jwks.json',
  // RS256 unless the bot picked ES256 in @BotFather's advanced settings.
  // EdDSA and ES256K are left out on purpose: with them Telegram issues only
  // the `openid` scope, and without `profile` the token carries no Telegram
  // user id to sign anyone in with.
  algorithms: ['RS256', 'ES256'],
  audiences: (config) => {
    const clientId = telegramLoginClientId(config);
    return clientId ? [clientId] : [];
  },
};

/** How long a fetched key set is trusted before we look for rotations. */
const JWKS_TTL_MS = 60 * 60 * 1000;
/**
 * Floor between JWKS fetches. Without it, a stream of tokens carrying a
 * bogus `kid` turns every request into an outbound HTTP call to Google.
 */
const JWKS_MIN_REFETCH_MS = 60 * 1000;
const JWKS_TIMEOUT_MS = 5_000;
/** Tolerance for clock drift between us and the provider, in seconds. */
const CLOCK_SKEW_SECONDS = 60;

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface SigningKey {
  key: KeyObject;
  /** The JWK's own `alg`, when it declares one. */
  alg: string | null;
}

/**
 * Verifies Google, Apple and Telegram ID tokens against the provider's
 * published JWKS.
 *
 * We do the signature check by hand with `node:crypto` rather than pulling
 * in a JWT library: Node 22 imports a JWK straight into a `KeyObject`, the
 * claim rules below are provider-specific anyway, and staying off
 * `jsonwebtoken` keeps this off `@nestjs/jwt`'s transitive dependency
 * (pnpm's strict layout would not resolve an undeclared import).
 *
 * Two things this must not get wrong:
 *   1. The algorithm is pinned per provider, and the key has to match it.
 *      Trusting the token's own `alg` header is the classic confusion attack
 *      — `none` or an HMAC alg keyed on the public key would both verify.
 *   2. `aud` is checked against our own client ids. A valid Google token
 *      minted for someone else's app is still a valid Google token.
 */
@Injectable()
export class OAuthIdentityService {
  private readonly logger = new Logger(OAuthIdentityService.name);

  /** jwksUri → (kid → public key). */
  private readonly keyCache = new Map<string, Map<string, SigningKey>>();
  private readonly fetchedAt = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<Map<string, SigningKey>>>();

  constructor(private readonly config: ConfigService) {}

  /** True when this deployment has client ids configured for the provider. */
  isConfigured(provider: OAuthProviderKey): boolean {
    return PROVIDERS[provider].audiences(this.config).length > 0;
  }

  async verify(provider: OAuthProviderKey, idToken: string): Promise<OAuthIdentity> {
    const payload = await this.verifyToken(PROVIDERS[provider], idToken);
    return provider === 'GOOGLE' ? toGoogleIdentity(payload) : toAppleIdentity(payload);
  }

  /**
   * Telegram Login: the web library's popup and the mobile apps both end
   * with an ID token signed by `oauth.telegram.org` for our bot.
   */
  async verifyTelegram(idToken: string): Promise<TelegramIdentity> {
    return toTelegramIdentity(await this.verifyToken(TELEGRAM, idToken));
  }

  private async verifyToken(descriptor: ProviderDescriptor, idToken: string): Promise<Record<string, unknown>> {
    const audiences = descriptor.audiences(this.config);
    if (audiences.length === 0) {
      throw new UnauthorizedException(`${descriptor.label} sign-in is not configured on this server`);
    }

    const { header, payload, signingInput, signature } = decodeJwt(idToken);
    const alg = descriptor.algorithms.find((a) => a === header.alg);
    if (!alg) {
      throw new UnauthorizedException('Unsupported identity-token algorithm');
    }
    if (!header.kid) {
      throw new UnauthorizedException('Identity token is missing its key id');
    }

    const key = await this.resolveKey(descriptor, header.kid);
    if (!verifySignature(alg, key, signingInput, signature)) {
      throw new UnauthorizedException('Identity token signature is invalid');
    }

    this.assertClaims(descriptor, payload, audiences);
    return payload;
  }

  private assertClaims(
    descriptor: ProviderDescriptor,
    payload: Record<string, unknown>,
    audiences: readonly string[],
  ): void {
    const issuer = typeof payload['iss'] === 'string' ? payload['iss'] : '';
    if (!descriptor.issuers.includes(issuer)) {
      throw new UnauthorizedException('Identity token was issued by an unexpected party');
    }

    // Telegram writes the bot id as a string, but a number would mean the
    // same client; compare as strings so neither form slips past or fails.
    const rawAud = payload['aud'];
    const tokenAudiences = Array.isArray(rawAud) ? rawAud : [rawAud];
    const audienceOk = tokenAudiences.some(
      (a) => (typeof a === 'string' || typeof a === 'number') && audiences.includes(String(a)),
    );
    if (!audienceOk) {
      throw new UnauthorizedException('Identity token was not issued for this application');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const exp = typeof payload['exp'] === 'number' ? payload['exp'] : 0;
    if (exp + CLOCK_SKEW_SECONDS < nowSeconds) {
      throw new UnauthorizedException('Identity token has expired; please sign in again');
    }
    const iat = typeof payload['iat'] === 'number' ? payload['iat'] : null;
    if (iat !== null && iat - CLOCK_SKEW_SECONDS > nowSeconds) {
      throw new UnauthorizedException('Identity token is not valid yet');
    }

    if (typeof payload['sub'] !== 'string' || payload['sub'].length === 0) {
      throw new UnauthorizedException('Identity token has no subject');
    }
  }

  private async resolveKey(descriptor: ProviderDescriptor, kid: string): Promise<SigningKey> {
    const uri = descriptor.jwksUri;
    const cached = this.keyCache.get(uri);
    const age = Date.now() - (this.fetchedAt.get(uri) ?? 0);

    const hit = cached?.get(kid);
    if (hit && age < JWKS_TTL_MS) return hit;

    // Either the cache is stale or the key id is new to us (a rotation).
    // Refetch — unless we just did, in which case an unknown kid is bogus.
    if (cached && age < JWKS_MIN_REFETCH_MS) {
      if (hit) return hit;
      throw new UnauthorizedException('Identity token was signed with an unknown key');
    }

    let fresh: Map<string, SigningKey>;
    try {
      fresh = await this.fetchJwks(uri);
    } catch (err) {
      this.logger.error(`Could not fetch ${descriptor.label} JWKS from ${uri}: ${String(err)}`);
      // Fall back to a stale cache rather than locking everyone out over a
      // transient network blip on the provider's side.
      const stale = cached?.get(kid);
      if (stale) return stale;
      throw new ServiceUnavailableException(`${descriptor.label} sign-in is temporarily unavailable`);
    }

    const key = fresh.get(kid);
    if (!key) {
      throw new UnauthorizedException('Identity token was signed with an unknown key');
    }
    return key;
  }

  private fetchJwks(uri: string): Promise<Map<string, SigningKey>> {
    const existing = this.inFlight.get(uri);
    if (existing) return existing;

    const request = axios
      .get<{ keys?: CryptoJsonWebKey[] }>(uri, { timeout: JWKS_TIMEOUT_MS })
      .then(({ data }) => {
        const keys = new Map<string, SigningKey>();
        for (const jwk of data.keys ?? []) {
          const kid = typeof jwk['kid'] === 'string' ? jwk['kid'] : null;
          // RSA for RS256, P-256 for ES256. Telegram also publishes Ed25519
          // and secp256k1 keys for its Web3 modes; nothing here verifies with them.
          const usable = jwk.kty === 'RSA' || (jwk.kty === 'EC' && jwk.crv === 'P-256');
          if (!kid || !usable) continue;
          try {
            const alg = typeof jwk['alg'] === 'string' ? jwk['alg'] : null;
            keys.set(kid, { key: createPublicKey({ key: jwk, format: 'jwk' }), alg });
          } catch {
            this.logger.warn(`Skipping unusable JWK "${kid}" from ${uri}`);
          }
        }
        if (keys.size === 0) throw new Error('JWKS contained no usable signing keys');
        this.keyCache.set(uri, keys);
        this.fetchedAt.set(uri, Date.now());
        return keys;
      })
      .finally(() => {
        this.inFlight.delete(uri);
      });

    this.inFlight.set(uri, request);
    return request;
  }
}

/**
 * The key decides what it may verify: an RSA key never checks an ES256
 * signature, and a JWK that names its own algorithm must agree with the one
 * the provider is pinned to.
 */
function verifySignature(alg: JwsAlgorithm, signingKey: SigningKey, input: string, signature: Buffer): boolean {
  if (signingKey.alg !== null && signingKey.alg !== alg) return false;
  const { key } = signingKey;
  if (alg === 'RS256') {
    if (key.asymmetricKeyType !== 'rsa') return false;
    return createVerify('RSA-SHA256').update(input).end().verify(key, signature);
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return false;
  // JWS carries ECDSA signatures as raw r‖s, not DER.
  return createVerify('SHA256').update(input).end().verify({ key, dsaEncoding: 'ieee-p1363' }, signature);
}

function decodeJwt(token: string): {
  header: JwtHeader;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
} {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedException('Malformed identity token');
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  let header: JwtHeader;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as JwtHeader;
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new UnauthorizedException('Malformed identity token');
  }
  if (typeof header !== 'object' || header === null || typeof payload !== 'object' || payload === null) {
    throw new UnauthorizedException('Malformed identity token');
  }

  return {
    header,
    payload,
    signingInput: `${encodedHeader}.${encodedPayload}`,
    signature: Buffer.from(encodedSignature, 'base64url'),
  };
}

function toGoogleIdentity(payload: Record<string, unknown>): OAuthIdentity {
  const email = str(payload['email']);
  return {
    provider: 'GOOGLE',
    providerUserId: payload['sub'] as string,
    email,
    emailVerified: truthy(payload['email_verified']),
    isPrivateEmail: false,
    name: str(payload['name']) ?? joinName(str(payload['given_name']), str(payload['family_name'])),
    locale: str(payload['locale']),
  };
}

function toAppleIdentity(payload: Record<string, unknown>): OAuthIdentity {
  const email = str(payload['email']);
  return {
    provider: 'APPLE',
    providerUserId: payload['sub'] as string,
    email,
    // Apple only puts an address in the token when the user consented to
    // share one, and it is always verified by Apple when present.
    emailVerified: email !== null && truthy(payload['email_verified']),
    isPrivateEmail: truthy(payload['is_private_email']),
    // Apple never sends a name in the token — it arrives once, in the
    // client-side authorization payload, and the caller passes it through.
    name: null,
    locale: null,
  };
}

/**
 * `sub` is an opaque per-bot identifier; the Telegram user id arrives as
 * `id` with the `profile` scope. Without it we could not find the customer
 * the Mini App already knows, so a token lacking it is refused rather than
 * minting a second, disconnected account.
 */
function toTelegramIdentity(payload: Record<string, unknown>): TelegramIdentity {
  const raw = payload['id'];
  const id = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new UnauthorizedException('Telegram sign-in did not share the profile, so there is no user id');
  }
  const given = str(payload['given_name']);
  return {
    id,
    firstName: given ?? str(payload['name']),
    lastName: given ? str(payload['family_name']) : null,
    username: str(payload['preferred_username']),
  };
}

/** Apple encodes booleans as the strings `"true"` / `"false"`. */
function truthy(value: unknown): boolean {
  return value === true || value === 'true';
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function joinName(given: string | null, family: string | null): string | null {
  const joined = [given, family].filter(Boolean).join(' ').trim();
  return joined.length > 0 ? joined : null;
}
