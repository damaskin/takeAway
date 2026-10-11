import type { CategoryWithProducts, ProductSummary, StoreListItem, StoreMenu } from '@takeaway/shared-types';

import { mixMenuPicks, storesToSample } from './menu-picks';

function store(id: string, brandId: string, extra: Partial<StoreListItem> = {}): StoreListItem {
  return {
    id,
    brandId,
    slug: id,
    name: id,
    addressLine: '',
    city: '',
    country: 'MD',
    latitude: 46.84,
    longitude: 29.62,
    status: 'OPEN',
    fulfillmentTypes: ['TAKEAWAY'],
    pickupPointType: 'COUNTER',
    busyMeter: 0,
    currentEtaSeconds: 300,
    acceptingOrders: true,
    openNow: true,
    taxRateBps: 0,
    taxIncludedInPrice: true,
    currency: 'MDL',
    timezone: 'Europe/Chisinau',
    heroImageUrl: null,
    distanceMeters: null,
    ...extra,
  };
}

function product(slug: string, extra: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: slug,
    categoryId: 'c',
    slug,
    name: slug,
    description: null,
    basePriceCents: 100,
    prepTimeSeconds: 120,
    caffeineLevel: null,
    calories: null,
    proteinsGrams: null,
    fatsGrams: null,
    carbsGrams: null,
    allergens: [],
    dietTags: [],
    imageUrls: [`https://cdn/${slug}.jpg`],
    sortOrder: 0,
    onStopList: false,
    ...extra,
  };
}

function menu(storeId: string, categories: ProductSummary[][]): StoreMenu {
  return {
    storeId,
    storeSlug: storeId,
    categories: categories.map(
      (products, i): CategoryWithProducts => ({
        id: `${storeId}-cat-${i}`,
        slug: `cat-${i}`,
        name: `Category ${i}`,
        description: null,
        iconUrl: null,
        sortOrder: i,
        availableFrom: null,
        availableTo: null,
        products,
      }),
    ),
  };
}

describe('storesToSample', () => {
  it('takes one store per business, open ones first, and skips closed ones', () => {
    const stores = [
      store('noname-closed', 'noname', { acceptingOrders: false }),
      store('noname-centre', 'noname'),
      store('noname-second', 'noname'),
      store('kacheli', 'kacheli', { openNow: false }),
      store('turka', 'turka'),
    ];
    expect(storesToSample(stores).map((s) => s.id)).toEqual(['noname-centre', 'turka', 'kacheli']);
  });

  it('stops at the limit', () => {
    const stores = ['a', 'b', 'c', 'd', 'e'].map((id) => store(id, id));
    expect(storesToSample(stores, 2).map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('mixMenuPicks', () => {
  const noname = store('noname', 'noname');
  const turka = store('turka', 'turka');

  it('lets places take turns, one item per category before a second from any', () => {
    const picks = mixMenuPicks([
      { store: noname, menu: menu('noname', [[product('cappuccino'), product('latte')], [product('croissant')]]) },
      { store: turka, menu: menu('turka', [[product('shawarma')], [product('americano')]]) },
    ]);
    expect(picks.map((p) => `${p.store.id}/${p.product.slug}`)).toEqual([
      'noname/cappuccino',
      'turka/shawarma',
      'noname/croissant',
      'turka/americano',
      'noname/latte',
    ]);
  });

  it('leaves out items without a photo and items on the stop list', () => {
    const picks = mixMenuPicks([
      {
        store: noname,
        menu: menu('noname', [[product('no-photo', { imageUrls: [] }), product('stopped', { onStopList: true })]]),
      },
      { store: turka, menu: menu('turka', [[product('shawarma')]]) },
    ]);
    expect(picks.map((p) => p.product.slug)).toEqual(['shawarma']);
  });

  it('stops at the limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => [product(`item-${i}`)]);
    expect(mixMenuPicks([{ store: noname, menu: menu('noname', many) }], 8)).toHaveLength(8);
  });

  it('is empty without menus', () => {
    expect(mixMenuPicks([])).toEqual([]);
  });
});
