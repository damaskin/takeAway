import {
  COPURCHASE_MIN_BASKETS,
  COPURCHASE_MIN_ORDERS,
  type CoPurchaseRow,
  pickCoPurchased,
  rankCoPurchases,
} from './copurchase';

const baskets = (here: number, brand: number): CoPurchaseRow => ({ productId: null, here, brand });
const row = (productId: string, here: number, brand: number): CoPurchaseRow => ({ productId, here, brand });

describe('rankCoPurchases', () => {
  it("ranks by the store's own baskets once it has enough of them", () => {
    const ranked = rankCoPurchases([
      row('croissant', 6, 30),
      baskets(COPURCHASE_MIN_BASKETS, 120),
      row('cheesecake', 9, 9),
      row('sandwich', 4, 60),
    ]);
    expect(ranked).toEqual([
      { productId: 'cheesecake', orders: 9 },
      { productId: 'croissant', orders: 6 },
      { productId: 'sandwich', orders: 4 },
    ]);
  });

  it("falls back to the brand's baskets for a store with too few of its own", () => {
    const ranked = rankCoPurchases([
      baskets(COPURCHASE_MIN_BASKETS - 1, 50),
      row('croissant', 6, 30),
      row('cheesecake', 9, 9),
    ]);
    expect(ranked).toEqual([
      { productId: 'croissant', orders: 30 },
      { productId: 'cheesecake', orders: 9 },
    ]);
  });

  it('gives up when the brand has too few as well, or nothing was bought with the products', () => {
    expect(rankCoPurchases([baskets(5, COPURCHASE_MIN_BASKETS - 1), row('croissant', 5, 19)])).toBeNull();
    expect(rankCoPurchases([baskets(0, 0)])).toBeNull();
    expect(rankCoPurchases([])).toBeNull();
  });

  it('leaves out what was bought with them only now and then', () => {
    const ranked = rankCoPurchases([
      baskets(40, 40),
      row('croissant', COPURCHASE_MIN_ORDERS, COPURCHASE_MIN_ORDERS),
      row('salad', COPURCHASE_MIN_ORDERS - 1, COPURCHASE_MIN_ORDERS - 1),
    ]);
    expect(ranked?.map((c) => c.productId)).toEqual(['croissant']);
  });
});

describe('pickCoPurchased', () => {
  const product = (id: string, onStopList = false) => ({ id, onStopList });
  const menu = {
    categories: [
      { products: [product('latte'), product('americano')] },
      { products: [product('croissant'), product('cookie', true), product('muffin')] },
      { products: [product('sandwich')] },
    ],
  } as unknown as Parameters<typeof pickCoPurchased>[0];

  it('offers only what the menu sells now and is not in hand, best first', () => {
    const ranked = [
      { productId: 'cookie', orders: 40 },
      { productId: 'gone-from-menu', orders: 30 },
      { productId: 'latte', orders: 25 },
      { productId: 'sandwich', orders: 12 },
      { productId: 'croissant', orders: 20 },
    ];
    expect(pickCoPurchased(menu, ranked, ['latte'], 6)).toEqual(['croissant', 'sandwich']);
  });

  it("breaks ties by the menu's order and stops at the limit", () => {
    const ranked = [
      { productId: 'sandwich', orders: 5 },
      { productId: 'muffin', orders: 5 },
      { productId: 'americano', orders: 5 },
    ];
    expect(pickCoPurchased(menu, ranked, ['latte'], 2)).toEqual(['americano', 'muffin']);
    expect(pickCoPurchased(menu, ranked, ['latte'], 0)).toEqual([]);
  });
});
