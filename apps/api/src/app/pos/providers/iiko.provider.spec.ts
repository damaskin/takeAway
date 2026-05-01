import axios, { AxiosInstance } from 'axios';
import { PosIntegrationStatus, PosProvider } from '@prisma/client';

import { RedisService } from '../../redis/redis.service';
import type { PosIntegrationCtx } from './pos-provider.interface';
import { IikoProvider } from './iiko.provider';

class TestableIikoProvider extends IikoProvider {
  constructor(
    redis: RedisService,
    private readonly fake: AxiosInstance,
  ) {
    super(redis);
  }
  protected override http(): AxiosInstance {
    return this.fake;
  }
}

const fakeRedis = (): RedisService => {
  const store = new Map<string, string>();
  return {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    del: jest.fn(async (k: string) => {
      store.delete(k);
    }),
  } as unknown as RedisService;
};

const ctxFor = (overrides: Partial<{ apiLogin: string; organizationId: string }> = {}): PosIntegrationCtx => ({
  row: {
    id: 'integration-iiko-1',
    brandId: 'brand-1',
    provider: PosProvider.IIKO,
    credentialsCiphertext: '',
    status: PosIntegrationStatus.CONNECTED,
    settings: {},
    lastSyncAt: null,
    lastErrorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  credentials: { kind: 'IIKO', apiLogin: overrides.apiLogin ?? 'login-xyz' },
  settings: overrides.organizationId ? { organizationId: overrides.organizationId } : {},
});

describe('IikoProvider', () => {
  it('listStores fans terminal_groups out of every organization when no orgId is pinned', async () => {
    const calls: { path: string; body: unknown; headers: Record<string, string> | undefined }[] = [];
    const fake = {
      post: jest.fn(async (path: string, body: unknown, config?: { headers?: Record<string, string> }) => {
        calls.push({ path, body, headers: config?.headers });
        if (path === '/api/1/access_token') return { data: { token: 'tk-1' } };
        if (path === '/api/1/organizations') {
          return {
            data: {
              organizations: [
                { id: 'org-A', name: 'Brand A' },
                { id: 'org-B', name: 'Brand B' },
              ],
            },
          };
        }
        if (path === '/api/1/terminal_groups') {
          return {
            data: {
              terminalGroups: [
                {
                  organizationId: 'org-A',
                  items: [
                    { id: 'tg-1', organizationId: 'org-A', name: 'Main', address: '1 St.', timeZone: 'Europe/Berlin' },
                    { id: 'tg-2', organizationId: 'org-A', name: 'Side' },
                  ],
                },
                { organizationId: 'org-B', items: [{ id: 'tg-3', organizationId: 'org-B', name: 'Branch' }] },
              ],
            },
          };
        }
        throw new Error(`unexpected path ${path}`);
      }),
    } as unknown as AxiosInstance;

    const provider = new TestableIikoProvider(fakeRedis(), fake);
    const stores = await provider.listStores(ctxFor());

    expect(stores).toEqual([
      { externalId: 'tg-1', name: 'Main', addressLine: '1 St.', timezone: 'Europe/Berlin' },
      { externalId: 'tg-2', name: 'Side', addressLine: undefined, timezone: undefined },
      { externalId: 'tg-3', name: 'Branch', addressLine: undefined, timezone: undefined },
    ]);

    // organisations endpoint was hit (no pinned orgId), then terminal_groups
    // received the resolved org-id list.
    const tgCall = calls.find((c) => c.path === '/api/1/terminal_groups');
    expect(tgCall?.body).toEqual({ organizationIds: ['org-A', 'org-B'] });
    expect(tgCall?.headers?.['Authorization']).toBe('Bearer tk-1');
  });

  it('listStores honours settings.organizationId when set, skipping the org listing', async () => {
    let orgsCalled = false;
    const fake = {
      post: jest.fn(async (path: string) => {
        if (path === '/api/1/access_token') return { data: { token: 'tk-2' } };
        if (path === '/api/1/organizations') {
          orgsCalled = true;
          return { data: { organizations: [] } };
        }
        if (path === '/api/1/terminal_groups') {
          return {
            data: {
              terminalGroups: [
                { organizationId: 'org-pinned', items: [{ id: 'tg-9', organizationId: 'org-pinned', name: 'Pinned' }] },
              ],
            },
          };
        }
        throw new Error(`unexpected path ${path}`);
      }),
    } as unknown as AxiosInstance;

    const provider = new TestableIikoProvider(fakeRedis(), fake);
    const stores = await provider.listStores(ctxFor({ organizationId: 'org-pinned' }));

    expect(stores).toEqual([{ externalId: 'tg-9', name: 'Pinned', addressLine: undefined, timezone: undefined }]);
    expect(orgsCalled).toBe(false);
  });

  it('listStores throws when iiko returns zero organizations', async () => {
    const fake = {
      post: jest.fn(async (path: string) => {
        if (path === '/api/1/access_token') return { data: { token: 'tk-3' } };
        if (path === '/api/1/organizations') return { data: { organizations: [] } };
        throw new Error(`unexpected path ${path}`);
      }),
    } as unknown as AxiosInstance;
    const provider = new TestableIikoProvider(fakeRedis(), fake);
    await expect(provider.listStores(ctxFor())).rejects.toThrow(/no organizations/);
  });

  // Smoke that production class wires axios.
  it('production class exposes an axios instance', () => {
    const real = new IikoProvider(fakeRedis());
    expect(typeof (real as unknown as { http: () => AxiosInstance }).http).toBe('function');
    expect(axios).toBeDefined();
  });
});
