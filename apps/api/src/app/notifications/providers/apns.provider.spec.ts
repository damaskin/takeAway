import { generateKeyPairSync, verify } from 'node:crypto';
import { createServer, type Http2Server, type ServerHttp2Session } from 'node:http2';
import type { AddressInfo } from 'node:net';

import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../prisma/prisma.service';
import {
  APNS_MAX_PAYLOAD_BYTES,
  ApnsPushProvider,
  type ApnsResponse,
  ApnsTimeoutError,
  type ApnsTransport,
  Http2ApnsTransport,
  buildApnsPayload,
} from './apns.provider';
import type { PushMessage, PushRecipient, PushTarget } from './push-provider.interface';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
// The way it sits in an .env file: one line, escaped newlines.
const ENV_PEM = PEM.replace(/\n/g, '\\n');

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

const appleEnv = { APPLE_TEAM_ID: 'FGN8R2D6QW', APPLE_KEY_ID: 'Q2P4JD5796', APPLE_PRIVATE_KEY: ENV_PEM };

const message: PushMessage = {
  kind: 'order_ready',
  title: 'Заказ #A42 готов',
  body: 'Можно забирать',
  orderId: 'ord_1',
};

interface Call {
  environment: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

/** Stands in for Apple: answers each request with the next scripted reply (or 200). */
class FakeTransport implements ApnsTransport {
  readonly calls: Call[] = [];
  private readonly replies: Array<ApnsResponse | Error | ((call: Call) => ApnsResponse | Error)> = [];

  reply(...replies: Array<ApnsResponse | Error | ((call: Call) => ApnsResponse | Error)>): this {
    this.replies.push(...replies);
    return this;
  }

  async post(environment: string, path: string, headers: Record<string, string>, body: string): Promise<ApnsResponse> {
    const call = { environment, path, headers, body };
    this.calls.push(call);
    const next = this.replies.shift() ?? { status: 200, body: '' };
    const answer = typeof next === 'function' ? next(call) : next;
    if (answer instanceof Error) throw answer;
    return answer;
  }

  close(): void {
    /* nothing to close */
  }
}

const apple = (status: number, reason?: string): ApnsResponse => ({
  status,
  body: reason ? JSON.stringify({ reason }) : '',
});

function ios(apnsToken: string | null, apnsEnvironment: PushTarget['apnsEnvironment'] = 'PRODUCTION'): PushTarget {
  return { token: `fcm-${apnsToken ?? 'none'}`, deviceType: 'IOS', apnsToken, apnsEnvironment };
}

function recipient(...pushTokens: PushTarget[]): PushRecipient {
  return { userId: 'user_1', locale: 'RU', pushTokens };
}

function make(env: Record<string, string | undefined> = appleEnv, transport = new FakeTransport()) {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = { device: { updateMany } } as unknown as PrismaService;
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const provider = new ApnsPushProvider(config, prisma, transport);
  return { provider, transport, updateMany };
}

function decodeJwt(bearer: string): { header: Record<string, unknown>; claims: Record<string, unknown>; ok: boolean } {
  const [header = '', claims = '', signature = ''] = bearer.replace(/^bearer /, '').split('.');
  const ok = verify(
    'sha256',
    Buffer.from(`${header}.${claims}`),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signature, 'base64url'),
  );
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString()) as Record<string, unknown>,
    claims: JSON.parse(Buffer.from(claims, 'base64url').toString()) as Record<string, unknown>,
    ok,
  };
}

describe('ApnsPushProvider configuration', () => {
  it('stays off without a key', async () => {
    const { provider, transport } = make({});
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.attempt(recipient(ios(TOKEN_A)), message)).resolves.toEqual({
      status: 'skipped',
      reason: 'not_configured',
    });
    expect(transport.calls).toHaveLength(0);
  });

  it('works off the Sign in with Apple key when no APNs key of its own is set', () => {
    expect(make(appleEnv).provider.isConfigured()).toBe(true);
  });

  it('prefers APNS_* over APPLE_* and can be switched off', async () => {
    const { provider, transport } = make({
      ...appleEnv,
      APNS_KEY_ID: 'APNSKEY001',
      APNS_PRIVATE_KEY: ENV_PEM,
      APNS_TOPIC: 'md.takeaway.beta',
    });
    await provider.attempt(recipient(ios(TOKEN_A)), message);
    expect(decodeJwt(transport.calls[0]?.headers['authorization'] ?? '').header['kid']).toBe('APNSKEY001');
    expect(transport.calls[0]?.headers['apns-topic']).toBe('md.takeaway.beta');

    expect(make({ ...appleEnv, APNS_ENABLED: 'false' }).provider.isConfigured()).toBe(false);
  });

  it('refuses a key that is not an EC .p8', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ format: 'pem', type: 'pkcs8' })
      .toString();
    expect(make({ ...appleEnv, APPLE_PRIVATE_KEY: rsa }).provider.isConfigured()).toBe(false);
    expect(make({ ...appleEnv, APPLE_PRIVATE_KEY: 'not a key' }).provider.isConfigured()).toBe(false);
  });
});

describe('ApnsPushProvider delivery', () => {
  it('ignores devices without an APNs token', async () => {
    const { provider, transport } = make();
    const result = await provider.deliver(
      recipient(ios(null), { token: 'android', deviceType: 'ANDROID' }, { token: '{}', deviceType: 'WEB' }),
      message,
    );
    expect(result).toEqual({ attempt: { status: 'skipped', reason: 'no_target' }, unreached: [] });
    expect(transport.calls).toHaveLength(0);
  });

  it('sends an alert with a signed ES256 provider token, the order id and a collapse id', async () => {
    const { provider, transport } = make();
    await expect(provider.attempt(recipient(ios(TOKEN_A)), message)).resolves.toEqual({ status: 'sent' });

    const [call] = transport.calls;
    expect(call?.environment).toBe('PRODUCTION');
    expect(call?.path).toBe(`/3/device/${TOKEN_A}`);
    expect(call?.headers).toMatchObject({
      'apns-topic': 'md.takeaway.ios',
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-collapse-id': 'order-ord_1',
    });
    expect(Number(call?.headers['apns-expiration'])).toBeGreaterThan(Date.now() / 1000);

    const jwt = decodeJwt(call?.headers['authorization'] ?? '');
    expect(jwt.ok).toBe(true);
    expect(jwt.header).toEqual({ alg: 'ES256', kid: 'Q2P4JD5796' });
    expect(jwt.claims).toMatchObject({ iss: 'FGN8R2D6QW' });

    expect(JSON.parse(call?.body ?? '{}')).toEqual({
      aps: {
        alert: { title: 'Заказ #A42 готов', body: 'Можно забирать' },
        sound: 'default',
        'thread-id': 'order-ord_1',
      },
      kind: 'order_ready',
      orderId: 'ord_1',
      // The Flutter plugin only surfaces pushes that carry an FCM message id.
      'gcm.message_id': call?.headers['apns-id'],
    });
  });

  it('reuses the provider token across sends', async () => {
    const { provider, transport } = make();
    await provider.attempt(recipient(ios(TOKEN_A)), message);
    await provider.attempt(recipient(ios(TOKEN_B)), { kind: 'generic', title: 'Акция', body: '−20%' });
    expect(transport.calls[0]?.headers['authorization']).toBe(transport.calls[1]?.headers['authorization']);
    expect(transport.calls[1]?.headers['apns-collapse-id']).toBeUndefined();
  });

  it('pushes each APNs token once even when two rows share it', async () => {
    const { provider, transport } = make();
    await provider.attempt(recipient(ios(TOKEN_A), { ...ios(TOKEN_A.toUpperCase()), token: 'other-fcm' }), message);
    expect(transport.calls).toHaveLength(1);
  });

  it('tries the other gateway on BadDeviceToken and remembers the one that worked', async () => {
    const transport = new FakeTransport().reply(apple(400, 'BadDeviceToken'), apple(200));
    const { provider, updateMany } = make(appleEnv, transport);
    await expect(provider.deliver(recipient(ios(TOKEN_A)), message)).resolves.toEqual({
      attempt: { status: 'sent' },
      unreached: [],
    });
    expect(transport.calls.map((c) => c.environment)).toEqual(['PRODUCTION', 'SANDBOX']);
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', apnsToken: TOKEN_A },
      data: { apnsEnvironment: 'SANDBOX' },
    });
  });

  it('clears a token both gateways reject and hands the device back for FCM', async () => {
    const transport = new FakeTransport().reply(apple(400, 'BadDeviceToken'), apple(400, 'BadDeviceToken'));
    const { provider, updateMany } = make(appleEnv, transport);
    const target = ios(TOKEN_A, 'SANDBOX');
    const result = await provider.deliver(recipient(target), message);
    expect(transport.calls.map((c) => c.environment)).toEqual(['SANDBOX', 'PRODUCTION']);
    expect(result.attempt).toEqual({
      status: 'failed',
      error: expect.stringContaining('no longer valid') as string,
    });
    expect(result.unreached).toEqual([target]);
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', apnsToken: { in: [TOKEN_A] } },
      data: { apnsToken: null, apnsEnvironment: null },
    });
  });

  it('clears a token Apple reports as unregistered, keeping the other device', async () => {
    const transport = new FakeTransport().reply((call) =>
      call.path.endsWith(TOKEN_A) ? apple(410, 'Unregistered') : apple(200),
    );
    const { provider, updateMany } = make(appleEnv, transport);
    const result = await provider.deliver(recipient(ios(TOKEN_A), ios(TOKEN_B)), message);
    expect(result.attempt).toEqual({ status: 'sent' });
    expect(result.unreached.map((t) => t.apnsToken)).toEqual([TOKEN_A]);
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', apnsToken: { in: [TOKEN_A] } },
      data: { apnsToken: null, apnsEnvironment: null },
    });
  });

  it('mints a fresh provider token when Apple says it expired, and resends once', async () => {
    const transport = new FakeTransport().reply(apple(403, 'ExpiredProviderToken'), apple(200));
    const { provider } = make(appleEnv, transport);
    await expect(provider.attempt(recipient(ios(TOKEN_A)), message)).resolves.toEqual({ status: 'sent' });
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[0]?.headers['authorization']).not.toBe(transport.calls[1]?.headers['authorization']);
  });

  it('explains a rejected key without touching the device', async () => {
    const transport = new FakeTransport().reply(apple(403, 'InvalidProviderToken'));
    const { provider, updateMany } = make(appleEnv, transport);
    const result = await provider.deliver(recipient(ios(TOKEN_A)), message);
    expect(result.attempt).toEqual({
      status: 'failed',
      error:
        'APNs 403 InvalidProviderToken — check the key id Q2P4JD5796, team FGN8R2D6QW and that the key has APNs enabled',
    });
    expect(result.unreached).toHaveLength(1);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not prune tokens on a topic mismatch — that is a configuration error', async () => {
    const transport = new FakeTransport().reply(apple(400, 'DeviceTokenNotForTopic'));
    const { provider, updateMany } = make(appleEnv, transport);
    await expect(provider.attempt(recipient(ios(TOKEN_A)), message)).resolves.toEqual({
      status: 'failed',
      error: 'APNs 400 DeviceTokenNotForTopic — the token is not for md.takeaway.ios; check APNS_TOPIC',
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('retries once on a dropped connection, but not after a timeout', async () => {
    const dropped = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const retried = make(appleEnv, new FakeTransport().reply(dropped, apple(200)));
    await expect(retried.provider.attempt(recipient(ios(TOKEN_A)), message)).resolves.toEqual({ status: 'sent' });
    expect(retried.transport.calls).toHaveLength(2);

    const timedOut = make(appleEnv, new FakeTransport().reply(new ApnsTimeoutError(10_000)));
    await expect(timedOut.provider.attempt(recipient(ios(TOKEN_A)), message)).resolves.toEqual({
      status: 'failed',
      error: 'APNs: no answer from APNs within 10000 ms',
    });
    expect(timedOut.transport.calls).toHaveLength(1);
  });
});

describe('buildApnsPayload', () => {
  it('cuts a body that would not fit into 4 KB', () => {
    const payload = buildApnsPayload({ kind: 'generic', title: 'Акция', body: 'Кофе '.repeat(800) }, 'id-1');
    expect(Buffer.byteLength(payload)).toBeLessThanOrEqual(APNS_MAX_PAYLOAD_BYTES);
    const body = (JSON.parse(payload) as { aps: { alert: { body: string } } }).aps.alert.body;
    expect(body.endsWith('…')).toBe(true);
    expect(body.length).toBeGreaterThan(1500);
  });
});

describe('Http2ApnsTransport', () => {
  let server: Http2Server;
  let origin: string;
  const sessions: ServerHttp2Session[] = [];
  const unanswered: Array<{ close(): void }> = [];
  let handler: (path: string, headers: Record<string, string>, body: string) => { status: number; body: string } | null;

  beforeAll(async () => {
    server = createServer();
    server.on('session', (s) => sessions.push(s));
    server.on('stream', (stream, headers) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        const answer = handler(
          String(headers[':path']),
          headers as unknown as Record<string, string>,
          Buffer.concat(chunks).toString(),
        );
        if (!answer) {
          // Never answer: the client times out. Closed after the test.
          unanswered.push(stream);
          return;
        }
        stream.respond({ ':status': answer.status, 'content-type': 'application/json' });
        stream.end(answer.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const s of unanswered) s.close();
    for (const s of sessions) s.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const transport = (timeoutMs = 2_000) =>
    new Http2ApnsTransport({ timeoutMs, origins: { PRODUCTION: origin, SANDBOX: origin } });

  it('posts the headers and body and returns Apple’s status and reason', async () => {
    let seen: { path: string; topic: string; body: string } | null = null;
    handler = (path, headers, body) => {
      seen = { path, topic: headers['apns-topic'] ?? '', body };
      return { status: 400, body: '{"reason":"BadDeviceToken"}' };
    };
    const t = transport();
    try {
      await expect(
        t.post('PRODUCTION', '/3/device/abc', { 'apns-topic': 'md.takeaway.ios' }, '{"aps":{}}'),
      ).resolves.toEqual({
        status: 400,
        body: '{"reason":"BadDeviceToken"}',
      });
      expect(seen).toEqual({ path: '/3/device/abc', topic: 'md.takeaway.ios', body: '{"aps":{}}' });
    } finally {
      t.close();
    }
  });

  it('keeps one connection for consecutive pushes and reconnects after Apple closes it', async () => {
    handler = () => ({ status: 200, body: '' });
    const t = transport();
    try {
      const before = sessions.length;
      await t.post('PRODUCTION', '/3/device/a', {}, '{}');
      await t.post('PRODUCTION', '/3/device/b', {}, '{}');
      expect(sessions.length - before).toBe(1);

      // Apple says goodbye (GOAWAY) — the next push opens a new connection.
      sessions[sessions.length - 1]?.close();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await expect(t.post('PRODUCTION', '/3/device/c', {}, '{}')).resolves.toMatchObject({ status: 200 });
      expect(sessions.length - before).toBe(2);
    } finally {
      t.close();
    }
  });

  it('gives up on a request Apple does not answer', async () => {
    handler = () => null;
    const t = transport(200);
    try {
      await expect(t.post('PRODUCTION', '/3/device/a', {}, '{}')).rejects.toBeInstanceOf(ApnsTimeoutError);
    } finally {
      t.close();
    }
  });
});
