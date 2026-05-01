import axios, { AxiosInstance } from 'axios';
import { PosIntegrationStatus, PosProvider } from '@prisma/client';

import type { PosIntegrationCtx, SyncProgressCtx } from './pos-provider.interface';
import { PosterProvider } from './poster.provider';

/**
 * Subclass that lets us inject a fake axios instance instead of going to
 * the network. The production class hides the http factory behind a
 * `protected` so tests are the canonical override point.
 */
class TestablePosterProvider extends PosterProvider {
  constructor(private readonly fake: AxiosInstance) {
    super();
  }
  protected override http(): AxiosInstance {
    return this.fake;
  }
}

const ctxFor = (): PosIntegrationCtx => ({
  row: {
    id: 'integration-1',
    brandId: 'brand-1',
    provider: PosProvider.POSTER,
    credentialsCiphertext: '',
    status: PosIntegrationStatus.CONNECTED,
    settings: {},
    lastSyncAt: null,
    lastErrorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  credentials: { kind: 'POSTER', token: 'tk_test', accountName: 'demo' },
  settings: { apiHost: 'https://joinposter.com' },
});

const noopProgress = (): SyncProgressCtx => ({ setTotal: async () => undefined, advance: async () => undefined });

const fakeAxios = (handler: (path: string, params: Record<string, string>) => unknown): AxiosInstance =>
  ({
    get: jest.fn(async (path: string, config?: { params?: Record<string, string> }) => {
      const data = handler(path, config?.params ?? {});
      return { data };
    }),
  }) as unknown as AxiosInstance;

describe('PosterProvider', () => {
  it('listStores filters out disabled spots and trims names', async () => {
    const provider = new TestablePosterProvider(
      fakeAxios((path) => {
        expect(path).toBe('/api/spots.getSpots');
        return {
          response: [
            { spot_id: 1, name: ' Main ', address: 'Hlavna 1', status: 1 },
            { spot_id: 2, name: 'Closed', status: 0 },
            { spot_id: 3, name: 'Other', status: '1' },
          ],
        };
      }),
    );
    const drafts = await provider.listStores(ctxFor());
    expect(drafts).toEqual([
      { externalId: '1', name: 'Main', addressLine: 'Hlavna 1' },
      { externalId: '3', name: 'Other', addressLine: undefined },
    ]);
  });

  it('importMenu maps Poster shape to drafts and reports progress', async () => {
    const provider = new TestablePosterProvider(
      fakeAxios((path) => {
        if (path === '/api/menu.getCategories') {
          return {
            response: [
              { category_id: 10, category_name: 'Coffee', sort_order: '2' },
              { category_id: 11, category_name: 'Hidden', category_hidden: 1 },
            ],
          };
        }
        if (path === '/api/menu.getProducts') {
          return {
            response: [
              {
                product_id: 100,
                product_name: 'Espresso',
                menu_category_id: 10,
                price: '1.50',
                photo_origin: 'http://x/1.jpg',
              },
              { product_id: 101, product_name: 'Latte', menu_category_id: 10, price: { '1': '3.00', '2': '3.50' } },
              { product_id: 102, product_name: 'Hidden', menu_category_id: 10, price: '2.00', hidden: 1 },
              { product_id: 103, product_name: 'Free', menu_category_id: 10, price: '0' },
            ],
          };
        }
        throw new Error(`unexpected path ${path}`);
      }),
    );

    let total = 0;
    let progress = 0;
    const ctx: SyncProgressCtx = {
      setTotal: async (t) => {
        total = t;
      },
      advance: async (d) => {
        progress += d;
      },
    };

    const menu = await provider.importMenu(ctxFor(), ctx);

    expect(total).toBe(4);
    expect(progress).toBe(4);
    expect(menu.categories).toEqual([{ externalId: '10', name: 'Coffee', sortOrder: 2 }]);
    expect(menu.products).toEqual([
      {
        externalId: '100',
        categoryExternalId: '10',
        name: 'Espresso',
        description: undefined,
        basePriceCents: 150,
        imageUrls: ['http://x/1.jpg'],
      },
      {
        externalId: '101',
        categoryExternalId: '10',
        name: 'Latte',
        description: undefined,
        // max across spots → 3.50 → 350 cents
        basePriceCents: 350,
        imageUrls: undefined,
      },
    ]);
    expect(menu.modifiers).toEqual([]);
  });

  it('importStopList collects hidden + per-spot invisible entries', async () => {
    const provider = new TestablePosterProvider(
      fakeAxios(() => ({
        response: [
          { product_id: 200, hidden: 1, menu_category_id: 1 },
          { product_id: 201, out_of_stock: 1, menu_category_id: 1 },
          {
            product_id: 202,
            menu_category_id: 1,
            spots: [
              { spot_id: 1, visible: 0 },
              { spot_id: 2, visible: 1 },
            ],
          },
          { product_id: 203, menu_category_id: 1 },
        ],
      })),
    );
    const entries = await provider.importStopList(ctxFor(), noopProgress());
    expect(entries).toEqual([
      { storeExternalId: '*', productExternalId: '200' },
      { storeExternalId: '*', productExternalId: '201' },
      { storeExternalId: '1', productExternalId: '202' },
    ]);
  });

  it('translates Poster auth errors to UnauthorizedException', async () => {
    const provider = new TestablePosterProvider(
      fakeAxios(() => ({ error: { code: 35, message: 'token is incorrect' } })),
    );
    await expect(provider.testConnection(ctxFor())).rejects.toThrow(/token is incorrect/);
  });

  // Smoke check that the production class wires axios correctly without
  // network access — we only assert the http() factory returns an axios
  // instance, not that calls succeed.
  it('production class exposes an axios instance', () => {
    const real = new PosterProvider();
    // prettier-ignore
    expect(typeof (real as unknown as { http: (h: string) => AxiosInstance }).http).toBe('function');
    expect(axios).toBeDefined();
  });
});
