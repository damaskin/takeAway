import { createPublicKey, createVerify, type JsonWebKey as CryptoJsonWebKey, type KeyObject } from 'node:crypto';

import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

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

interface ProviderDescriptor {
  key: OAuthProviderKey;
  label: string;
  issuers: readonly string[];
  jwksUri: string;
  /** Comma-separated list of accepted `aud` values. */
  audienceEnv: string;
}

const PROVIDERS: Record<OAuthProviderKey, ProviderDescriptor> = {
  GOOGLE: {
    key: 'GOOGLE',
    label: 'Google',
    // Google has historically issued both forms; accept either.
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    audienceEnv: 'GOOGLE_OAUTH_CLIENT_IDS',
  },
  APPLE: {
    key: 'APPLE',
    label: 'Apple',
    issuers: ['https://appleid.apple.com'],
    jwksUri: 'https://appleid.apple.com/auth/keys',
    audienceEnv: 'APPLE_OAUTH_CLIENT_IDS',
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

/**
 * Verifies Google and Apple ID tokens against the provider's published
 * JWKS.
 *
 * We do the RS256 check by hand with `node:crypto` rather than pulling in
 * a JWT library: Node 22 imports a JWK straight into a `KeyObject`, the
 * claim rules below are provider-specific anyway, and staying off
 * `jsonwebtoken` keeps this off `@nestjs/jwt`'s transitive dependency
 * (pnpm's strict layout would not resolve an undeclared import).
 *
 * Two things this must not get wrong:
 *   1. The algorithm is pinned to RS256. Trusting the token's own `alg`
 *      header is the classic confusion attack — `none` or an HMAC alg
 *      keyed on the public key would both verify.
 *   2. `aud` is checked against our own client ids. A valid Google token
 *      minted for someone else's app is still a valid Google token.
 */
@Injectable()
export class OAuthIdentityService {
  private readonly logger = new Logger(OAuthIdentityService.name);

  /** jwksUri → (kid → public key). */
  private readonly keyCache = new Map<string, Map<string, KeyObject>>();
  private readonly fetchedAt = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<Map<string, KeyObject>>>();

  constructor(private readonly config: ConfigService) {}

  /** True when this deployment has client ids configured for the provider. */
  isConfigured(provider: OAuthProviderKey): boolean {
    return this.audiencesFor(PROVIDERS[provider]).length > 0;
  }

  async verify(provider: OAuthProviderKey, idToken: string): Promise<OAuthIdentity> {
    const descriptor = PROVIDERS[provider];
    const audiences = this.audiencesFor(descriptor);
    if (audiences.length === 0) {
      throw new UnauthorizedException(`${descriptor.label} sign-in is not configured on this server`);
    }

    const { header, payload, signingInput, signature } = decodeJwt(idToken);
    if (header.alg !== 'RS256') {
      throw new UnauthorizedException('Unsupported identity-token algorithm');
    }
    if (!header.kid) {
      throw new UnauthorizedException('Identity token is missing its key id');
    }

    const key = await this.resolveKey(descriptor, header.kid);
    const signatureOk = createVerify('RSA-SHA256').update(signingInput).end().verify(key, signature);
    if (!signatureOk) {
      throw new UnauthorizedException('Identity token signature is invalid');
    }

    this.assertClaims(descriptor, payload, audiences);
    return provider === 'GOOGLE' ? toGoogleIdentity(payload) : toAppleIdentity(payload);
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

    const rawAud = payload['aud'];
    const tokenAudiences = Array.isArray(rawAud) ? rawAud : [rawAud];
    const audienceOk = tokenAudiences.some((a) => typeof a === 'string' && audiences.includes(a));
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

  private audiencesFor(descriptor: ProviderDescriptor): string[] {
    const raw = this.config.get<string>(descriptor.audienceEnv) ?? '';
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private async resolveKey(descriptor: ProviderDescriptor, kid: string): Promise<KeyObject> {
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

    let fresh: Map<string, KeyObject>;
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

  private fetchJwks(uri: string): Promise<Map<string, KeyObject>> {
    const existing = this.inFlight.get(uri);
    if (existing) return existing;

    const request = axios
      .get<{ keys?: CryptoJsonWebKey[] }>(uri, { timeout: JWKS_TIMEOUT_MS })
      .then(({ data }) => {
        const keys = new Map<string, KeyObject>();
        for (const jwk of data.keys ?? []) {
          const kid = typeof jwk['kid'] === 'string' ? jwk['kid'] : null;
          if (!kid || jwk.kty !== 'RSA') continue;
          try {
            keys.set(kid, createPublicKey({ key: jwk, format: 'jwk' }));
          } catch {
            this.logger.warn(`Skipping unusable JWK "${kid}" from ${uri}`);
          }
        }
        if (keys.size === 0) throw new Error('JWKS contained no usable RSA keys');
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
