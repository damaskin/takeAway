import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { AdminOrderReview, AdminOrderReviewPage } from '@takeaway/shared-types';

import { API_CONFIG } from '../../core/api/api.config';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { OrderReviewsPage, periodStart } from './reviews.page';

function review(overrides: Partial<AdminOrderReview> = {}): AdminOrderReview {
  return {
    id: 'rev-1',
    rating: 2,
    comment: 'Латте был холодный',
    createdAt: '2026-11-06T10:00:00.000Z',
    orderId: 'order-1',
    orderCode: '1234',
    brand: { id: 'b1', name: 'NoName Coffee' },
    store: { id: 's1', name: 'Центр' },
    customer: {
      id: 'u1',
      name: 'Иван',
      email: 'ivan@example.com',
      phone: null,
      telegramUserId: '777',
      deleted: false,
    },
    ...overrides,
  };
}

function pageOf(items: AdminOrderReview[], over: Partial<AdminOrderReviewPage> = {}): AdminOrderReviewPage {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    count: 5,
    averageRating: 4.2,
    ratingCounts: { '1': 0, '2': 1, '3': 0, '4': 1, '5': 3 },
    ...over,
  };
}

describe('OrderReviewsPage', () => {
  let fixture: ComponentFixture<OrderReviewsPage>;
  let http: HttpTestingController;
  const activeId = signal<string | null>('b1');
  const loaded = signal(true);

  beforeEach(async () => {
    activeId.set('b1');
    loaded.set(true);
    TestBed.configureTestingModule({
      imports: [OrderReviewsPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
        {
          provide: ActiveBrandService,
          useValue: {
            brands: signal([
              { id: 'b1', name: 'NoName Coffee' },
              { id: 'b2', name: 'Качели' },
            ]),
            activeId,
            loaded,
          },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(OrderReviewsPage);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const byTestId = (id: string) => el().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const expectList = (query: string) => {
    const req = http.expectOne((r) => r.url === '/api/admin/order-reviews');
    expect(req.request.params.toString()).toBe(query);
    return req;
  };
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const select = (id: string, value: string) => {
    const s = byTestId(id) as HTMLSelectElement;
    s.value = value;
    s.dispatchEvent(new Event('change'));
  };

  it('opens on every brand and all time, with the average, the count and each review', async () => {
    expectList('page=1&pageSize=20').flush(
      pageOf([
        review(),
        review({
          id: 'rev-2',
          rating: 5,
          comment: null,
          orderId: 'order-2',
          orderCode: '5678',
          customer: { id: 'u2', name: null, email: null, phone: null, telegramUserId: null, deleted: true },
        }),
      ]),
    );
    await settle();

    expect(byTestId('reviews-average')?.textContent?.trim()).toBe('4,2');
    expect(byTestId('reviews-count')?.textContent?.trim()).toBe('Отзывов: 5');
    expect(byTestId('reviews-rating-5')?.textContent?.trim()).toBe('5 ★ · 3');

    const cards = Array.from(el().querySelectorAll<HTMLElement>('[data-testid="review"]'));
    expect(cards).toHaveLength(2);
    const [first, second] = cards;
    expect(first?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Оценка 2 из 5');
    expect(first?.textContent).toContain('Латте был холодный');
    expect(first?.textContent).toContain('NoName Coffee · Центр');
    expect(first?.textContent).toContain('Иван');
    expect(first?.textContent).toContain('ivan@example.com · Telegram ID 777');
    expect(second?.textContent).toContain('Без комментария');
    expect(second?.textContent).toContain('Без имени (аккаунт удалён)');
  });

  it('filters by brand, rating and period, back to the first page each time', async () => {
    expectList('page=1&pageSize=20').flush(pageOf([review()], { total: 45 }));
    await settle();

    el().querySelector<HTMLButtonElement>('.rv-pager button:last-child')?.click();
    await settle();
    expectList('page=2&pageSize=20').flush(pageOf([review()], { total: 45, page: 2 }));
    await settle();

    select('reviews-brand', 'b2');
    await settle();
    expectList('brandId=b2&page=1&pageSize=20').flush(pageOf([review()]));
    await settle();

    byTestId('reviews-rating-2')?.click();
    await settle();
    expect(byTestId('reviews-rating-2')?.getAttribute('aria-pressed')).toBe('true');
    expectList('brandId=b2&rating=2&page=1&pageSize=20').flush(pageOf([review()]));
    await settle();

    select('reviews-period', 'd7');
    await settle();
    const req = http.expectOne((r) => r.url === '/api/admin/order-reviews');
    expect(req.request.params.get('from')).toBe(periodStart('d7'));
    expect(req.request.params.get('rating')).toBe('2');
    expect(req.request.params.get('page')).toBe('1');
    req.flush(pageOf([], { total: 0 }));
    await settle();

    expect(byTestId('reviews-empty')?.textContent?.trim()).toBe('Под эти фильтры отзывов нет.');
  });

  it('follows the brand picked in the top bar while the page is open', async () => {
    expectList('page=1&pageSize=20').flush(pageOf([]));
    await settle();

    activeId.set('b2');
    await settle();

    expectList('brandId=b2&page=1&pageSize=20').flush(pageOf([]));
    await settle();
    expect((byTestId('reviews-brand') as HTMLSelectElement).value).toBe('b2');
  });

  it('opens the order detail from the order number', async () => {
    expectList('page=1&pageSize=20').flush(pageOf([review()]));
    await settle();

    byTestId('review-order-1234')?.click();
    await settle();

    http.expectOne('/api/admin/orders/order-1');
    expect(el().querySelector('app-order-detail-panel')).not.toBeNull();
  });

  it('says so when there are no reviews at all', async () => {
    expectList('page=1&pageSize=20').flush(
      pageOf([], { count: 0, averageRating: null, ratingCounts: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } }),
    );
    await settle();

    expect(byTestId('reviews-empty')?.textContent?.trim()).toBe('Отзывов пока нет.');
    expect(byTestId('reviews-average')).toBeNull();
    expect(byTestId('reviews-summary')?.textContent).toContain('Оценок пока нет');
  });

  it('counts the period from the start of the day N − 1 days ago', () => {
    expectList('page=1&pageSize=20').flush(pageOf([]));
    const now = new Date(2026, 10, 6, 15, 30);
    expect(periodStart('all', now)).toBeUndefined();
    expect(periodStart('d7', now)).toBe(new Date(2026, 9, 31).toISOString());
    expect(periodStart('d30', now)).toBe(new Date(2026, 9, 8).toISOString());
  });
});
