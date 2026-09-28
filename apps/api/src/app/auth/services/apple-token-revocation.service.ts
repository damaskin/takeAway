import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';

export const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
export const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const APPLE_AUDIENCE = 'https://appleid.apple.com';
/** Apple accepts up to six months; a secret minted per call needs minutes. */
const CLIENT_SECRET_TTL_SECONDS = 5 * 60;
const HTTP_TIMEOUT_MS = 5_000;

export type AppleRevocationOutcome = 'revoked' | 'skipped' | 'failed';

interface AppleRevocationSettings {
  teamId: string;
  keyId: string;
  /** PKCS#8 PEM of the Sign in with Apple key (the `.p8` file). */
  privateKey: string;
  /** The app the authorization code was issued to — the iOS bundle id. */
  clientId: string;
}

interface AppleTokenResponse {
  access_token?: string;
  refresh_token?: string;
}

/**
 * Revokes a customer's Sign in with Apple grant when they delete their
 * account, as App Store guideline 5.1.1(v) requires of apps offering it.
 *
 * We never keep Apple tokens, so the iOS app runs Sign in with Apple once
 * more right before deleting and sends the fresh authorization code. It is
 * exchanged for tokens at Apple and the refresh token (or, failing that, the
 * access token) is revoked straight away.
 *
 * Configuration: `APPLE_TEAM_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY`
 * (a Sign in with Apple key; `\n`-escaped PEM in env files). The client id is
 * `APPLE_REVOKE_CLIENT_ID`, else the first `APPLE_OAUTH_CLIENT_IDS` entry
 * that is not the website's Services ID (`APPLE_OAUTH_SERVICES_ID`).
 *
 * Everything here is best-effort and never throws: Apple being down or the
 * server lacking the key must not stand between a customer and deleting
 * their account. Codes, secrets and tokens never reach the logs.
 */
@Injectable()
export class AppleTokenRevocationService {
  private readonly logger = new Logger(AppleTokenRevocationService.name);
  private readonly settings: AppleRevocationSettings | null;
  /** Unconfigured: signs with the key passed per call, never the app's JWT secret. */
  private readonly jwt = new JwtService();

  constructor(config: ConfigService) {
    this.settings = readSettings(config);
  }

  async revokeAuthorizationCode(code: string, userId: string): Promise<AppleRevocationOutcome> {
    const settings = this.settings;
    if (!settings) {
      this.logger.warn(
        `Apple token revocation skipped for user=${userId}: APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY or the client id is not configured`,
      );
      return 'skipped';
    }

    let step = 'sign the client secret';
    try {
      const clientSecret = await this.clientSecret(settings);

      step = 'exchange the authorization code';
      const tokens = await this.postForm<AppleTokenResponse>(APPLE_TOKEN_URL, {
        client_id: settings.clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      });
      const [token, hint] = tokens.refresh_token
        ? [tokens.refresh_token, 'refresh_token']
        : [tokens.access_token, 'access_token'];
      if (!token) {
        this.logger.warn(`Apple token revocation failed for user=${userId}: the code exchange returned no token`);
        return 'failed';
      }

      step = `revoke the ${hint.replace('_', ' ')}`;
      await this.postForm(APPLE_REVOKE_URL, {
        client_id: settings.clientId,
        client_secret: clientSecret,
        token,
        token_type_hint: hint,
      });
      this.logger.log(`Apple tokens revoked for user=${userId}`);
      return 'revoked';
    } catch (err) {
      this.logger.warn(`Apple token revocation failed for user=${userId}: could not ${step} (${describeFailure(err)})`);
      return 'failed';
    }
  }

  private clientSecret(settings: AppleRevocationSettings): Promise<string> {
    return this.jwt.signAsync(
      {},
      {
        algorithm: 'ES256',
        privateKey: settings.privateKey,
        keyid: settings.keyId,
        issuer: settings.teamId,
        subject: settings.clientId,
        audience: APPLE_AUDIENCE,
        expiresIn: CLIENT_SECRET_TTL_SECONDS,
      },
    );
  }

  private async postForm<T>(url: string, form: Record<string, string>): Promise<T> {
    const { data } = await axios.post<T>(url, new URLSearchParams(form).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: HTTP_TIMEOUT_MS,
    });
    return data;
  }
}

function readSettings(config: ConfigService): AppleRevocationSettings | null {
  const teamId = config.get<string>('APPLE_TEAM_ID')?.trim();
  const keyId = config.get<string>('APPLE_KEY_ID')?.trim();
  // Same convention as FIREBASE_PRIVATE_KEY: env files carry the PEM on one
  // line with literal `\n`.
  const privateKey = config.get<string>('APPLE_PRIVATE_KEY')?.replace(/\\n/g, '\n').trim();
  const clientId = revocationClientId(config);
  if (!teamId || !keyId || !privateKey || !clientId) return null;
  return { teamId, keyId, privateKey, clientId };
}

/**
 * The code comes from the iOS app, so it was issued to the bundle id, not to
 * the Services ID the website signs in with.
 */
function revocationClientId(config: ConfigService): string | null {
  const explicit = config.get<string>('APPLE_REVOKE_CLIENT_ID')?.trim();
  if (explicit) return explicit;
  const servicesId = config.get<string>('APPLE_OAUTH_SERVICES_ID')?.trim();
  const clientIds = (config.get<string>('APPLE_OAUTH_CLIENT_IDS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return clientIds.find((id) => id !== servicesId) ?? null;
}

/** Status and Apple's error code only — the request carried the code and the secret. */
function describeFailure(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const appleError = (err.response?.data as { error?: unknown } | undefined)?.error;
    const parts = [status ? `HTTP ${status}` : (err.code ?? 'no response')];
    if (typeof appleError === 'string') parts.push(appleError);
    return parts.join(' ');
  }
  return err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error';
}
