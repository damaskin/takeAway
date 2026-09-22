import { createVerify, generateKeyPairSync } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, type AxiosResponse } from 'axios';

import type { PrismaService } from '../../prisma/prisma.service';
import { FcmPushProvider } from './fcm.provider';
import type { PushMessage, PushRecipient } from './push-provider.interface';

jest.mock('axios', () => {
  const actual = jest.requireActual<typeof import('axios')>('axios');
  return { __esModule: true, ...actual, default: { post: jest.fn() }, isAxiosError: actual.isAxiosError };
});
const post = axios.post as jest.Mock;

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

const message: PushMessage = { kind: 'order_ready', title: 'Order #4821 ready', body: 'Pick it up', orderId: 'ord_1' };

function recipient(
  tokens: Array<{ token: string; deviceType: 'IOS' | 'ANDROID' | 'WEB' | 'TELEGRAM' }>,
): PushRecipient {
  return { userId: 'user_1', locale: 'EN', pushTokens: tokens };
}

function make(env: Record<string, string | undefined>) {
  const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = { device: { deleteMany } } as unknown as PrismaService;
  const provider = new FcmPushProvider({ get: (key: string) => env[key] } as unknown as ConfigService, prisma);
  return { provider, deleteMany };
}

const configured = {
  FIREBASE_PROJECT_ID: 'takeaway-test',
  FIREBASE_CLIENT_EMAIL: 'push@takeaway-test.iam.gserviceaccount.com',
  // The way it sits in an .env file: one line, escaped newlines.
  FIREBASE_PRIVATE_KEY: PEM.replace(/\n/g, '\\n'),
};

function gone(): AxiosError {
  const response = { status: 404, data: { error: { status: 'UNREGISTERED' } } } as AxiosResponse;
  return new AxiosError('Not found', '404', undefined, undefined, response);
}

describe('FcmPushProvider', () => {
  beforeEach(() => post.mockReset());

  it('stays silent without a service account', async () => {
    const { provider } = make({});
    await expect(provider.send(recipient([{ token: 't1', deviceType: 'ANDROID' }]), message)).resolves.toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('ignores web and Telegram recipients', async () => {
    const { provider } = make(configured);
    await expect(provider.send(recipient([{ token: 'w', deviceType: 'WEB' }]), message)).resolves.toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('signs a service-account JWT, then sends to Android and iOS tokens with the order id', async () => {
    post.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('oauth2')
          ? { data: { access_token: 'ya29.token', expires_in: 3600 } }
          : { data: { name: 'projects/takeaway-test/messages/1' } },
      ),
    );
    const { provider } = make(configured);

    const ok = await provider.send(
      recipient([
        { token: 'android-token', deviceType: 'ANDROID' },
        { token: 'ios-token', deviceType: 'IOS' },
      ]),
      message,
    );

    expect(ok).toBe(true);
    const [tokenUrl, form] = post.mock.calls[0] as [string, string];
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    const assertion = new URLSearchParams(form).get('assertion') ?? '';
    const [header = '', claims = '', signature = ''] = assertion.split('.');
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({
      iss: configured.FIREBASE_CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    });
    const valid = createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, signature, 'base64url');
    expect(valid).toBe(true);

    const sends = post.mock.calls.slice(1) as Array<
      [string, { message: Record<string, unknown> }, { headers: Record<string, string> }]
    >;
    expect(sends).toHaveLength(2);
    const [first] = sends;
    expect(first?.[0]).toBe('https://fcm.googleapis.com/v1/projects/takeaway-test/messages:send');
    expect(first?.[2].headers['Authorization']).toBe('Bearer ya29.token');
    expect(sends.map((s) => s[1].message['token'])).toEqual(['android-token', 'ios-token']);
    expect(first?.[1].message['data']).toEqual({ kind: 'order_ready', orderId: 'ord_1' });
  });

  it('reuses the OAuth token across sends', async () => {
    post.mockImplementation((url: string) =>
      Promise.resolve(url.includes('oauth2') ? { data: { access_token: 'cached', expires_in: 3600 } } : { data: {} }),
    );
    const { provider } = make(configured);
    await provider.send(recipient([{ token: 'a', deviceType: 'ANDROID' }]), message);
    await provider.send(recipient([{ token: 'b', deviceType: 'ANDROID' }]), message);
    expect(post.mock.calls.filter(([url]) => String(url).includes('oauth2'))).toHaveLength(1);
  });

  it('prunes tokens FCM reports as unregistered', async () => {
    post.mockImplementation((url: string, body: { message?: { token: string } }) => {
      if (url.includes('oauth2')) return Promise.resolve({ data: { access_token: 't', expires_in: 3600 } });
      return body.message?.token === 'stale' ? Promise.reject(gone()) : Promise.resolve({ data: {} });
    });
    const { provider, deleteMany } = make(configured);

    const ok = await provider.send(
      recipient([
        { token: 'stale', deviceType: 'ANDROID' },
        { token: 'fresh', deviceType: 'IOS' },
      ]),
      message,
    );

    expect(ok).toBe(true);
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'user_1', pushToken: { in: ['stale'] } } });
  });
});
