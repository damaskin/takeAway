import { createPrivateKey, type KeyObject, randomUUID, sign } from 'node:crypto';
import { type ClientHttp2Session, connect, constants as http2 } from 'node:http2';

import { Inject, Injectable, Logger, type OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import type { PushAttempt, PushMessage, PushProvider, PushRecipient, PushTarget } from './push-provider.interface';

export type ApnsEnvironment = 'PRODUCTION' | 'SANDBOX';

export const APNS_ORIGINS: Readonly<Record<ApnsEnvironment, string>> = {
  PRODUCTION: 'https://api.push.apple.com',
  SANDBOX: 'https://api.sandbox.push.apple.com',
};

/** The bundle id of the iOS app — the topic every push is addressed to. */
export const DEFAULT_APNS_TOPIC = 'md.takeaway.ios';

/** Apple's limit for a regular (non-VoIP) notification payload. */
export const APNS_MAX_PAYLOAD_BYTES = 4096;

/**
 * Apple accepts a provider token for an hour and refuses new ones more
 * often than every 20 minutes, so one is minted every 50.
 */
const PROVIDER_TOKEN_TTL_MS = 50 * 60_000;

/** Undelivered notifications (phone off) are dropped after a day — order news goes stale. */
const EXPIRATION_SECONDS = 24 * 60 * 60;

/** Device tokens are hex; anything else never reaches a URL path. */
const APNS_TOKEN = /^[0-9a-f]{32,512}$/i;

export interface ApnsResponse {
  status: number;
  body: string;
}

/**
 * One POST to an APNs gateway. The provider talks to Apple through this so
 * tests can stand in for it; the real one is {@link Http2ApnsTransport}.
 * Rejects only when no HTTP answer came back (connection, timeout).
 */
export interface ApnsTransport {
  post(
    environment: ApnsEnvironment,
    path: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<ApnsResponse>;
  close(): void;
}

/** DI token for a custom {@link ApnsTransport}; without one the HTTP/2 transport is used. */
export const APNS_TRANSPORT = Symbol('APNS_TRANSPORT');

export class ApnsTimeoutError extends Error {
  constructor(ms: number) {
    super(`no answer from APNs within ${ms} ms`);
    this.name = 'ApnsTimeoutError';
  }
}

/**
 * APNs over Node's built-in HTTP/2 client: one long-lived connection per
 * gateway, as Apple asks providers to keep. A connection Apple closes
 * (GOAWAY), one that errors, times out a request or sits idle for
 * `idleMs` is forgotten, and the next push opens a fresh one. The socket
 * keeps the process alive only while a request is in flight.
 */
export class Http2ApnsTransport implements ApnsTransport {
  private readonly sessions = new Map<ApnsEnvironment, ClientHttp2Session>();
  private readonly inFlight = new Map<ClientHttp2Session, number>();
  private readonly timeoutMs: number;
  private readonly idleMs: number;
  private readonly origins: Readonly<Record<ApnsEnvironment, string>>;

  constructor(
    options: { timeoutMs?: number; idleMs?: number; origins?: Readonly<Record<ApnsEnvironment, string>> } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.idleMs = options.idleMs ?? 10 * 60_000;
    this.origins = options.origins ?? APNS_ORIGINS;
  }

  post(
    environment: ApnsEnvironment,
    path: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<ApnsResponse> {
    return new Promise<ApnsResponse>((resolve, reject) => {
      let session: ClientHttp2Session;
      try {
        session = this.session(environment);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.hold(session);
      let settled = false;
      const settle = (done: () => void): void => {
        if (settled) return;
        settled = true;
        this.release(session);
        done();
      };

      let stream: ReturnType<ClientHttp2Session['request']>;
      try {
        stream = session.request({
          ':method': 'POST',
          ':path': path,
          'content-type': 'application/json',
          ...headers,
        });
      } catch (err) {
        // The session died between the lookup and the request.
        this.drop(environment, session);
        settle(() => reject(err instanceof Error ? err : new Error(String(err))));
        return;
      }

      let status = 0;
      const chunks: Buffer[] = [];
      stream.on('response', (h) => {
        status = Number(h[':status'] ?? 0);
      });
      stream.on('data', (chunk: Buffer | string) => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });
      stream.on('end', () => settle(() => resolve({ status, body: Buffer.concat(chunks).toString('utf8') })));
      stream.on('error', (err) => settle(() => reject(err)));
      stream.on('close', () =>
        settle(() => reject(new Error(`APNs stream closed without an answer (code ${stream.rstCode ?? 'n/a'})`))),
      );
      stream.setTimeout(this.timeoutMs, () => {
        settle(() => reject(new ApnsTimeoutError(this.timeoutMs)));
        stream.close(http2.NGHTTP2_CANCEL);
        // A connection that stopped answering rarely recovers; start afresh.
        this.drop(environment, session);
      });
      stream.end(body);
    });
  }

  close(): void {
    for (const session of this.sessions.values()) session.destroy();
    this.sessions.clear();
    this.inFlight.clear();
  }

  private session(environment: ApnsEnvironment): ClientHttp2Session {
    const current = this.sessions.get(environment);
    if (current && !current.closed && !current.destroyed) return current;

    const session = connect(this.origins[environment]);
    this.sessions.set(environment, session);
    const forget = (): void => {
      if (this.sessions.get(environment) === session) this.sessions.delete(environment);
    };
    // Without an error listener a dropped connection would crash the process.
    session.on('error', forget);
    session.on('close', forget);
    // Apple is closing the connection: finish what is in flight, open a new one for the rest.
    session.on('goaway', () => {
      forget();
      session.close();
    });
    session.setTimeout(this.idleMs, () => {
      forget();
      session.close();
    });
    session.unref();
    return session;
  }

  private hold(session: ClientHttp2Session): void {
    const count = (this.inFlight.get(session) ?? 0) + 1;
    this.inFlight.set(session, count);
    if (count === 1) session.ref();
  }

  private release(session: ClientHttp2Session): void {
    const count = (this.inFlight.get(session) ?? 1) - 1;
    if (count > 0) {
      this.inFlight.set(session, count);
      return;
    }
    this.inFlight.delete(session);
    if (!session.destroyed) session.unref();
  }

  private drop(environment: ApnsEnvironment, session: ClientHttp2Session): void {
    if (this.sessions.get(environment) === session) this.sessions.delete(environment);
    session.destroy();
  }
}

interface ApnsSettings {
  keyId: string;
  teamId: string;
  key: KeyObject;
  topic: string;
}

/** What happened to one push for one device token. */
type DeviceResult =
  | { status: 'sent'; environment: ApnsEnvironment }
  /** Apple says the token is dead: app removed, or a token that never was valid. */
  | { status: 'gone'; reason: string }
  | { status: 'failed'; error: string };

/** One gateway's answer, before the other gateway is tried for a BadDeviceToken. */
type GatewayResult = DeviceResult | { status: 'bad_token' };

/** {@link ApnsPushProvider.deliver}: the overall outcome plus the devices APNs did not reach. */
export interface ApnsDelivery {
  attempt: PushAttempt;
  /** iOS devices that did not get the push from Apple — the caller may try their FCM tokens. */
  unreached: PushTarget[];
}

/** An iOS device that registered a usable raw APNs token. */
export function hasApnsToken(target: PushTarget): boolean {
  return target.deviceType === 'IOS' && typeof target.apnsToken === 'string' && APNS_TOKEN.test(target.apnsToken);
}

/** The recipient's devices APNs can push to, one per token. */
export function apnsTargets(targets: readonly PushTarget[]): PushTarget[] {
  const seen = new Set<string>();
  return targets.filter((t) => {
    if (!hasApnsToken(t)) return false;
    const key = (t.apnsToken as string).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The notification as Apple wants it: the alert with the default sound,
 * plus `kind` / `orderId` next to `aps`, which the app reads to open the
 * order. `gcm.message_id` makes the Flutter `firebase_messaging` plugin
 * treat a direct APNs push like one of its own — without it the plugin
 * ignores the push in the foreground and on tap (it only shows it in the
 * background, where iOS draws it). A body too long for Apple's 4 KB is cut
 * with an ellipsis rather than refused.
 */
export function buildApnsPayload(message: PushMessage, messageId: string): string {
  const render = (body: string): string =>
    JSON.stringify({
      aps: {
        alert: { title: message.title, body },
        sound: 'default',
        ...(message.orderId ? { 'thread-id': `order-${message.orderId}` } : {}),
      },
      kind: message.kind,
      ...(message.orderId ? { orderId: message.orderId } : {}),
      'gcm.message_id': messageId,
    });

  let payload = render(message.body);
  let chars = Array.from(message.body);
  while (Buffer.byteLength(payload) > APNS_MAX_PAYLOAD_BYTES && chars.length > 0) {
    // Every character is at least one byte, so this never cuts more than four times too much.
    const excess = Buffer.byteLength(payload) - APNS_MAX_PAYLOAD_BYTES;
    chars = chars.slice(0, Math.max(0, chars.length - Math.max(1, Math.ceil(excess / 4))));
    payload = render(`${chars.join('').trimEnd()}…`);
  }
  return payload;
}

/**
 * Apple Push Notification service, direct — for the iOS app.
 *
 * The app registers its raw APNs device token next to the FCM one. With a
 * token-based APNs key configured, iOS devices are pushed here instead of
 * through Firebase, so iOS no longer depends on the APNs key uploaded to
 * the Firebase project (a wrong one there fails every iOS push with
 * `FCM 401 UNAUTHENTICATED: Invalid APNs credential`).
 *
 * Configuration: `APNS_KEY_ID` + `APNS_TEAM_ID` + `APNS_PRIVATE_KEY` (the
 * `.p8`, `\n`-escaped on one line), or — when `APNS_PRIVATE_KEY` is empty —
 * the Sign in with Apple key `APPLE_KEY_ID` / `APPLE_TEAM_ID` /
 * `APPLE_PRIVATE_KEY`, which works as long as APNs is enabled for that key.
 * `APNS_TOPIC` defaults to `md.takeaway.ios`; `APNS_ENABLED=false` turns
 * direct pushes off (iOS then goes through FCM again).
 *
 * The device says which gateway its token belongs to (release builds —
 * production, debug — sandbox); a `BadDeviceToken` is retried on the other
 * gateway and the right one remembered. A token Apple reports as dead
 * (410 `Unregistered`, or `BadDeviceToken` on both gateways) is cleared from
 * the device row; the row itself stays, its FCM token is still tried and
 * pruned by FCM if it is dead too.
 */
@Injectable()
export class ApnsPushProvider implements PushProvider, OnModuleDestroy {
  readonly id = 'apns' as const;

  private readonly logger = new Logger(ApnsPushProvider.name);
  private readonly settings: ApnsSettings | null;
  private readonly transport: ApnsTransport;
  private providerToken: { value: string; expiresAt: number } | null = null;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    @Optional() @Inject(APNS_TRANSPORT) transport?: ApnsTransport,
  ) {
    this.settings = readApnsSettings(config, this.logger);
    this.transport = transport ?? new Http2ApnsTransport();
  }

  isConfigured(): boolean {
    return this.settings !== null;
  }

  onModuleDestroy(): void {
    this.transport.close();
  }

  async send(recipient: PushRecipient, message: PushMessage): Promise<boolean> {
    return (await this.attempt(recipient, message)).status === 'sent';
  }

  async attempt(recipient: PushRecipient, message: PushMessage): Promise<PushAttempt> {
    return (await this.deliver(recipient, message)).attempt;
  }

  /**
   * Pushes to every iOS device of the recipient that has an APNs token and
   * says which of them did not get it, so the caller can fall back to FCM
   * for exactly those.
   */
  async deliver(recipient: PushRecipient, message: PushMessage): Promise<ApnsDelivery> {
    const targets = apnsTargets(recipient.pushTokens);
    if (targets.length === 0) return { attempt: { status: 'skipped', reason: 'no_target' }, unreached: [] };
    const settings = this.settings;
    if (!settings) return { attempt: { status: 'skipped', reason: 'not_configured' }, unreached: targets };

    const results = await Promise.all(targets.map((t) => this.sendOne(settings, t, message)));
    await this.remember(recipient.userId, targets, results);

    const unreached = targets.filter((_, i) => results[i]?.status !== 'sent');
    if (results.some((r) => r.status === 'sent')) return { attempt: { status: 'sent' }, unreached };

    const failure = results.find((r): r is { status: 'failed'; error: string } => r.status === 'failed');
    const error = failure
      ? failure.error
      : `APNs: ${results.length} device token(s) no longer valid — app removed or reinstalled, cleared`;
    this.logger.warn(`APNs push to user ${recipient.userId} not delivered: ${error}`);
    return { attempt: { status: 'failed', error }, unreached };
  }

  private async sendOne(settings: ApnsSettings, target: PushTarget, message: PushMessage): Promise<DeviceResult> {
    const token = target.apnsToken as string;
    const preferred: ApnsEnvironment = target.apnsEnvironment ?? 'PRODUCTION';
    const first = await this.post(settings, preferred, token, message);
    if (first.status !== 'bad_token') return first;
    // A token from the other gateway reads as BadDeviceToken: a debug build
    // registered as production, or the other way round.
    const other: ApnsEnvironment = preferred === 'PRODUCTION' ? 'SANDBOX' : 'PRODUCTION';
    const second = await this.post(settings, other, token, message);
    return second.status === 'bad_token' ? { status: 'gone', reason: 'BadDeviceToken' } : second;
  }

  private async post(
    settings: ApnsSettings,
    environment: ApnsEnvironment,
    token: string,
    message: PushMessage,
  ): Promise<GatewayResult> {
    const messageId = randomUUID();
    const gateway = environment === 'PRODUCTION' ? 'APNs' : 'APNs sandbox';
    let response: ApnsResponse | null = null;
    for (let attempt = 0; attempt < 2 && !response; attempt++) {
      let headers: Record<string, string>;
      try {
        headers = this.headers(settings, message, messageId);
      } catch (err) {
        return { status: 'failed', error: `${gateway}: could not sign the provider token — ${describe(err)}` };
      }
      try {
        const answer = await this.transport.post(
          environment,
          `/3/device/${token}`,
          headers,
          buildApnsPayload(message, messageId),
        );
        // The provider token aged out under us: mint a new one and resend once.
        if (attempt === 0 && answer.status === 403 && reasonOf(answer) === 'ExpiredProviderToken') {
          this.providerToken = null;
          continue;
        }
        response = answer;
      } catch (err) {
        // A connection Apple dropped is retried once on a fresh one; a timeout
        // is not — the push may have gone through.
        if (attempt === 0 && !(err instanceof ApnsTimeoutError)) continue;
        const error = `${gateway}: ${describe(err)}`;
        this.logger.warn(`APNs send failed: ${error}`);
        return { status: 'failed', error };
      }
    }
    if (!response) return { status: 'failed', error: `${gateway}: no answer` };

    if (response.status === 200) return { status: 'sent', environment };
    const reason = reasonOf(response);
    if (response.status === 410 || reason === 'Unregistered' || reason === 'ExpiredToken') {
      return { status: 'gone', reason: reason ?? 'Unregistered' };
    }
    if (reason === 'BadDeviceToken') return { status: 'bad_token' };
    const error = `${gateway} ${response.status} ${reason ?? 'error'}${hintFor(reason, settings)}`;
    this.logger.warn(`APNs send failed: ${error}`);
    return { status: 'failed', error };
  }

  private headers(settings: ApnsSettings, message: PushMessage, messageId: string): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `bearer ${this.bearer(settings)}`,
      'apns-topic': settings.topic,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + EXPIRATION_SECONDS),
      'apns-id': messageId,
    };
    // One notification per order on the phone: a newer status replaces the
    // older one instead of stacking (the same tag FCM uses).
    if (message.orderId) headers['apns-collapse-id'] = `order-${message.orderId}`.slice(0, 64);
    return headers;
  }

  /** The ES256 provider token, reused for 50 minutes. */
  private bearer(settings: ApnsSettings): string {
    const cached = this.providerToken;
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'ES256', kid: settings.keyId })}.${encode({
      iss: settings.teamId,
      iat: Math.floor(Date.now() / 1000),
    })}`;
    const signature = sign('sha256', Buffer.from(unsigned), {
      key: settings.key,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
    const value = `${unsigned}.${signature}`;
    this.providerToken = { value, expiresAt: Date.now() + PROVIDER_TOKEN_TTL_MS };
    return value;
  }

  /** Writes back what Apple taught us: the right gateway for a token, and tokens that are gone. */
  private async remember(userId: string, targets: PushTarget[], results: DeviceResult[]): Promise<void> {
    const gone: string[] = [];
    const moved: Array<{ token: string; environment: ApnsEnvironment }> = [];
    targets.forEach((t, i) => {
      const r = results[i];
      const token = t.apnsToken as string;
      if (r?.status === 'gone') gone.push(token);
      if (r?.status === 'sent' && r.environment !== (t.apnsEnvironment ?? 'PRODUCTION')) {
        moved.push({ token, environment: r.environment });
      }
    });

    if (gone.length > 0) {
      this.logger.log(`Clearing ${gone.length} dead APNs token(s) of user ${userId}`);
      await this.prisma.device
        .updateMany({
          where: { userId, apnsToken: { in: gone } },
          data: { apnsToken: null, apnsEnvironment: null },
        })
        .catch((err: Error) => this.logger.warn(`Could not clear dead APNs tokens: ${err.message}`));
    }
    for (const m of moved) {
      await this.prisma.device
        .updateMany({ where: { userId, apnsToken: m.token }, data: { apnsEnvironment: m.environment } })
        .catch((err: Error) => this.logger.warn(`Could not store the APNs environment: ${err.message}`));
    }
  }
}

/** Reads the APNs key, falling back to the Sign in with Apple one. Null (with a log line) when push is off. */
export function readApnsSettings(config: ConfigService, logger: Logger): ApnsSettings | null {
  const enabled = config.get<string>('APNS_ENABLED')?.trim().toLowerCase();
  if (enabled === 'false' || enabled === '0' || enabled === 'off') {
    logger.log('APNS_ENABLED=false — iOS push goes through FCM');
    return null;
  }
  const own = config.get<string>('APNS_PRIVATE_KEY')?.trim();
  // Env files carry the PEM on one line with literal "\n".
  const pem = (own || config.get<string>('APPLE_PRIVATE_KEY'))?.replace(/\\n/g, '\n').trim();
  const keyId = config.get<string>(own ? 'APNS_KEY_ID' : 'APPLE_KEY_ID')?.trim();
  const teamId = (config.get<string>('APNS_TEAM_ID')?.trim() || config.get<string>('APPLE_TEAM_ID'))?.trim();
  const topic = config.get<string>('APNS_TOPIC')?.trim() || DEFAULT_APNS_TOPIC;
  const source = own ? 'APNS_*' : 'APPLE_*';
  if (!pem || !keyId || !teamId) {
    logger.warn('APNS_KEY_ID/APNS_TEAM_ID/APNS_PRIVATE_KEY (or APPLE_*) missing — iOS push goes through FCM only');
    return null;
  }
  let key: KeyObject;
  try {
    key = createPrivateKey(pem);
  } catch (err) {
    logger.warn(`APNs key from ${source} is not a readable PEM (${describe(err)}) — iOS push goes through FCM only`);
    return null;
  }
  if (key.asymmetricKeyType !== 'ec') {
    logger.warn(`APNs key from ${source} is not an EC (.p8) key — iOS push goes through FCM only`);
    return null;
  }
  logger.log(`APNs direct push on: key ${keyId} (${source}), team ${teamId}, topic ${topic}`);
  return { keyId, teamId, key, topic };
}

function reasonOf(response: ApnsResponse): string | undefined {
  if (!response.body) return undefined;
  try {
    const reason = (JSON.parse(response.body) as { reason?: unknown }).reason;
    return typeof reason === 'string' ? reason : undefined;
  } catch {
    return undefined;
  }
}

/** What an operator should check for the errors that mean "our side is misconfigured". */
function hintFor(reason: string | undefined, settings: ApnsSettings): string {
  switch (reason) {
    case 'InvalidProviderToken':
    case 'MissingProviderToken':
      return ` — check the key id ${settings.keyId}, team ${settings.teamId} and that the key has APNs enabled`;
    case 'DeviceTokenNotForTopic':
    case 'TopicDisallowed':
    case 'BadTopic':
      return ` — the token is not for ${settings.topic}; check APNS_TOPIC`;
    default:
      return '';
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code;
    return typeof code === 'string' && !err.message.includes(code) ? `${code} ${err.message}` : err.message;
  }
  return String(err);
}
