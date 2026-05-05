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

  it('importMenu translates iiko nomenclature into ImportedMenu, dropping Modifier-typed rows', async () => {
    const fake = {
      post: jest.fn(async (path: string, body: unknown) => {
        if (path === '/api/1/access_token') return { data: { token: 'tk-menu' } };
        if (path === '/api/1/nomenclature') {
          expect(body).toEqual({ organizationId: 'org-pinned' });
          return {
            data: {
              groups: [
                { id: 'grp-1', name: 'Coffee', order: 0, isDeleted: false },
                { id: 'grp-deleted', name: 'Old', isDeleted: true },
              ],
              products: [
                {
                  id: 'p-1',
                  type: 'Dish',
                  name: 'Latte',
                  description: 'Smooth',
                  groupId: 'grp-1',
                  sizePrices: [{ price: { currentPrice: 4.5, isIncludedInMenu: true } }],
                  modifiers: [{ id: 'mod-1', minAmount: 0, maxAmount: 2 }],
                  imageLinks: ['https://cdn/x.jpg'],
                },
                { id: 'mod-1', type: 'Modifier', name: 'Extra shot', price: 1.0 },
                { id: 'p-2', type: 'Dish', name: 'Free coffee', groupId: 'grp-1', price: 0 }, // dropped: zero price
                { id: 'p-3', type: 'Dish', name: 'No category', price: 3.0 }, // dropped: no group
              ],
            },
          };
        }
        throw new Error(`unexpected path ${path}`);
      }),
    } as unknown as AxiosInstance;
    const provider = new TestableIikoProvider(fakeRedis(), fake);
    const progress = { setTotal: jest.fn(async () => undefined), advance: jest.fn(async () => undefined) };
    const menu = await provider.importMenu(ctxFor({ organizationId: 'org-pinned' }), progress);

    expect(menu.categories).toEqual([{ externalId: 'grp-1', name: 'Coffee', sortOrder: 0 }]);
    expect(menu.products).toEqual([
      {
        externalId: 'p-1',
        categoryExternalId: 'grp-1',
        name: 'Latte',
        description: 'Smooth',
        basePriceCents: 450,
        imageUrls: ['https://cdn/x.jpg'],
      },
    ]);
    expect(menu.modifiers).toEqual([
      { externalId: 'mod-1', productExternalId: 'p-1', name: 'Extra shot', priceDeltaCents: 100, minCount: 0, maxCount: 2 },
    ]);
    // Total covers the 3 non-Modifier dishes; advance fires once for the partial flush.
    expect(progress.setTotal).toHaveBeenCalledWith(3);
  });

  it('importMenu refuses to run without a pinned organizationId', async () => {
    const fake = {
      post: jest.fn(async (path: string) => {
        if (path === '/api/1/access_token') return { data: { token: 'tk' } };
        throw new Error(`unexpected path ${path}`);
      }),
    } as unknown as AxiosInstance;
    const provider = new TestableIikoProvider(fakeRedis(), fake);
    const progress = { setTotal: jest.fn(), advance: jest.fn() };
    await expect(provider.importMenu(ctxFor(), progress)).rejects.toThrow(/settings\.organizationId/);
  });

  it('importStopList emits one entry per terminal-group×product with non-positive balance', async () => {
    const fake = {
      post: jest.fn(async (path: string, body: unknown) => {
        if (path === '/api/1/access_token') return { data: { token: 'tk-sl' } };
        if (path === '/api/1/stop_lists') {
          expect(body).toEqual({ organizationIds: ['org-pinned'] });
          return {
            data: {
              terminalGroupStopLists: [
                {
                  organizationId: 'org-pinned',
                  items: [
                    {
                      terminalGroupId: 'tg-A',
                      items: [
                        { productId: 'p-1', balance: 0 },
                        { productId: 'p-2', balance: 5 }, // in stock — skipped
                        { productId: 'p-3', balance: -1 },
                      ],
                    },
                    { terminalGroupId: 'tg-B', items: [{ productId: 'p-1', balance: 0 }] },
                  ],
                },
              ],
            },
          };
        }
        throw new Error(`unexpected path ${path}`);
      }),
    } as unknown as AxiosInstance;
    const provider = new TestableIikoProvider(fakeRedis(), fake);
    const progress = { setTotal: jest.fn(), advance: jest.fn() };
    const entries = await provider.importStopList(ctxFor({ organizationId: 'org-pinned' }), progress);

    expect(entries).toEqual([
      { storeExternalId: 'tg-A', productExternalId: 'p-1' },
      { storeExternalId: 'tg-A', productExternalId: 'p-3' },
      { storeExternalId: 'tg-B', productExternalId: 'p-1' },
    ]);
  });

  it('pushOrder posts /api/1/order/create with mapped items and returns posExternalId', async () => {
    let capturedBody: any = null;
    const fake = {
      post: jest.fn(async (path: string, body: unknown) => {
        if (path === '/api/1/access_token') return { data: { token: 'tk-push' } };
        if (path === '/api/1/order/create') {
          capturedBody = body;
          return { data: { orderInfo: { id: 'iiko-order-9' } } };
        }
        throw new Error(`unexpected path ${path}`);
      }),
    } as unknown as AxiosInstance;
    const provider = new TestableIikoProvider(fakeRedis(), fake);
    const result = await provider.pushOrder(ctxFor({ organizationId: 'org-pinned' }), {
      id: 'order-internal',
      orderCode: '4832',
      storeExternalId: 'tg-A',
      customerName: 'Ivan',
      customerPhone: '+71234567890',
      notes: 'No sugar',
      items: [
        {
          productExternalId: 'p-1',
          quantity: 2,
          unitPriceCents: 450,
          modifiers: [{ externalId: 'mod-1', count: 1 }],
        },
      ],
      totalCents: 1000,
      currency: 'USD',
    });

    expect(result).toEqual({ posExternalId: 'iiko-order-9' });
    expect(capturedBody.organizationId).toBe('org-pinned');
    expect(capturedBody.terminalGroupId).toBe('tg-A');
    expect(capturedBody.order.externalNumber).toBe('4832');
    expect(capturedBody.order.items).toEqual([
      {
        type: 'Product',
        productId: 'p-1',
        amount: 2,
        modifiers: [{ productId: 'mod-1', amount: 1 }],
        comment: undefined,
      },
    ]);
    expect(typeof capturedBody.order.id).toBe('string');
    expect(capturedBody.order.id.length).toBeGreaterThan(10); // uuid-ish
  });

  it('pushOrder throws when settings.organizationId is missing', async () => {
    const fake = {
      post: jest.fn(async (path: string) => {
        if (path === '/api/1/access_token') return { data: { token: 'tk' } };
        throw new Error(`unexpected path ${path}`);
      }),
    } as unknown as AxiosInstance;
    const provider = new TestableIikoProvider(fakeRedis(), fake);
    await expect(
      provider.pushOrder(ctxFor(), {
        id: 'o',
        orderCode: '0001',
        storeExternalId: 'tg-A',
        customerName: null,
        customerPhone: null,
        notes: null,
        items: [{ productExternalId: 'p-1', quantity: 1, unitPriceCents: 100, modifiers: [] }],
        totalCents: 100,
        currency: 'USD',
      }),
    ).rejects.toThrow(/organizationId/);
  });

  // Smoke that production class wires axios.
  it('production class exposes an axios instance', () => {
    const real = new IikoProvider(fakeRedis());
    expect(typeof (real as unknown as { http: () => AxiosInstance }).http).toBe('function');
    expect(real.supportsStopListPolling).toBe(true);
    expect(axios).toBeDefined();
  });
});
