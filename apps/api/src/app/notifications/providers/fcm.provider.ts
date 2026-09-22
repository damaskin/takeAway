import { createSign } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { isAxiosError } from 'axios';

import { PrismaService } from '../../prisma/prisma.service';
import type { PushMessage, PushProvider, PushRecipient } from './push-provider.interface';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/**
 * Firebase Cloud Messaging (HTTP v1) for the mobile app — Android directly,
 * iOS through the APNs key uploaded to the Firebase project. The Flutter app
 * registers FCM tokens for both platforms, so both device types go here.
 *
 * Authenticates as the project's service account (`FIREBASE_PROJECT_ID`,
 * `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`): a self-signed JWT is
 * exchanged for an hour-long OAuth token, cached until shortly before it
 * lapses. No SDK — the two HTTP calls are the whole protocol.
 *
 * Tokens FCM reports as gone (app uninstalled, token rotated) are deleted
 * so the next fan-out does not pay for them again. Disabled, with one
 * warning, when the service account is not configured.
 */
@Injectable()
export class FcmPushProvider implements PushProvider {
  readonly id = 'fcm' as const;

  private readonly logger = new Logger(FcmPushProvider.name);
  private readonly account: ServiceAccount | null;
  private accessToken: { value: string; expiresAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const projectId = config.get<string>('FIREBASE_PROJECT_ID')?.trim();
    const clientEmail = config.get<string>('FIREBASE_CLIENT_EMAIL')?.trim();
    // Env files carry the PEM on one line with literal "\n".
    const privateKey = config.get<string>('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n').trim();
    if (projectId && clientEmail && privateKey) {
      this.account = { projectId, clientEmail, privateKey };
    } else {
      this.account = null;
      this.logger.warn('FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY missing — mobile push disabled');
    }
  }

  async send(recipient: PushRecipient, message: PushMessage): Promise<boolean> {
    const account = this.account;
    if (!account) return false;
    const tokens = recipient.pushTokens.filter((t) => t.deviceType === 'ANDROID' || t.deviceType === 'IOS');
    if (tokens.length === 0) return false;

    let bearer: string;
    try {
      bearer = await this.bearer(account);
    } catch (err) {
      this.logger.warn(`FCM auth failed: ${(err as Error).message}`);
      return false;
    }

    const results = await Promise.all(tokens.map((t) => this.sendOne(account, bearer, t.token, message)));
    const dead = tokens.filter((_, i) => results[i] === 'gone').map((t) => t.token);
    if (dead.length > 0) {
      await this.prisma.device
        .deleteMany({ where: { userId: recipient.userId, pushToken: { in: dead } } })
        .catch((err: Error) => this.logger.debug(`Could not prune dead FCM tokens: ${err.message}`));
    }
    return results.includes('sent');
  }

  private async sendOne(
    account: ServiceAccount,
    bearer: string,
    token: string,
    message: PushMessage,
  ): Promise<'sent' | 'gone' | 'failed'> {
    const data: Record<string, string> = { kind: message.kind };
    if (message.orderId) data['orderId'] = message.orderId;
    try {
      await axios.post(
        `https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`,
        {
          message: {
            token,
            notification: { title: message.title, body: message.body },
            data,
            android: {
              priority: 'HIGH',
              // One notification per order on the device: a newer status
              // replaces the older one instead of stacking.
              notification: message.orderId ? { tag: `order-${message.orderId}` } : undefined,
            },
            apns: {
              headers: message.orderId ? { 'apns-collapse-id': `order-${message.orderId}` } : undefined,
              payload: { aps: { sound: 'default' } },
            },
          },
        },
        { headers: { Authorization: `Bearer ${bearer}` }, timeout: 10_000 },
      );
      return 'sent';
    } catch (err) {
      if (isAxiosError(err)) {
        const status = err.response?.status;
        const code = (err.response?.data as { error?: { status?: string } } | undefined)?.error?.status;
        // UNREGISTERED (404) — uninstalled or rotated; INVALID_ARGUMENT on a
        // token that was never an FCM token.
        if (status === 404 || code === 'UNREGISTERED' || (status === 400 && code === 'INVALID_ARGUMENT')) {
          return 'gone';
        }
        if (status === 401) this.accessToken = null;
        this.logger.debug(`FCM send failed: ${status ?? ''} ${code ?? err.message}`);
      } else {
        this.logger.debug(`FCM send failed: ${(err as Error).message}`);
      }
      return 'failed';
    }
  }

  /** Cached OAuth token; concurrent callers share one exchange. */
  private async bearer(account: ServiceAccount): Promise<string> {
    const cached = this.accessToken;
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (this.pendingToken) return this.pendingToken;
    this.pendingToken = this.exchange(account).finally(() => {
      this.pendingToken = null;
    });
    return this.pendingToken;
  }

  private async exchange(account: ServiceAccount): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iss: account.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).end().sign(account.privateKey).toString('base64url');

    const response = await axios.post<{ access_token: string; expires_in: number }>(
      TOKEN_URL,
      new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 },
    );
    const { access_token: value, expires_in: ttl } = response.data;
    // Renew a minute early so a send never races the expiry.
    this.accessToken = { value, expiresAt: Date.now() + Math.max(60, ttl - 60) * 1000 };
    return value;
  }
}
