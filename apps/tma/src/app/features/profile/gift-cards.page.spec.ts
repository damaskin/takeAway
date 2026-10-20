import { TmaGiftCardsPage } from './gift-cards.page';
import { openProfileScreen } from './testing';

describe('TmaGiftCardsPage', () => {
  it('lists the cards applied to the customer’s orders', async () => {
    const { http, el, fixture } = await openProfileScreen(TmaGiftCardsPage);
    http.expectOne('/api/me/gift-cards').flush([
      {
        orderId: 'ord-1',
        orderCode: 'A-12',
        code: 'GIFT-7Q2K',
        amountCents: 5000,
        currency: 'RUP',
        brandName: 'NoName Coffee',
        createdAt: '2026-10-19T09:00:00Z',
      },
    ]);
    await fixture.whenStable();
    const card = el.querySelector<HTMLAnchorElement>('[data-testid="gift-card"]');
    expect(card?.textContent).toContain('GIFT-7Q2K');
    expect(card?.textContent).toContain('NoName Coffee · #A-12');
    expect(card?.getAttribute('href')).toBe('/orders/ord-1');
  });

  it('says so when there are none yet', async () => {
    const { http, el, fixture } = await openProfileScreen(TmaGiftCardsPage);
    http.expectOne('/api/me/gift-cards').flush([]);
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="gift-cards-empty"]')?.textContent?.trim()).toBe(
      'Пока нет применённых карт. Коды выпускаются брендами и вводятся на чекауте.',
    );
  });
});
