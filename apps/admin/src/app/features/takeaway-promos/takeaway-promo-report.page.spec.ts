import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { TakeawayPromoReport } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { TakeawayPromosApi } from '../../core/takeaway-promos/takeaway-promos.service';
import { TakeawayPromoReportPage } from './takeaway-promo-report.page';

const REPORT: TakeawayPromoReport = {
  promo: {
    id: 'tp1',
    name: 'Приветственный бонус',
    code: 'HELLO10',
    percent: 10,
    startsAt: '2026-11-01T00:00:00.000Z',
    endsAt: '2026-12-01T00:00:00.000Z',
    currency: 'RUP',
    budgetCents: 100_000,
    // 16,50 counted + 4,50 held by an order still waiting for its payment.
    spentCents: 2_100,
    leftCents: 97_900,
    status: 'ACTIVE',
    effectiveStatus: 'ACTIVE',
    isWelcome: true,
    redemptionsCount: 4,
    editable: false,
    createdAt: '2026-11-01T00:00:00.000Z',
  },
  orders: 3,
  customers: 3,
  menuTotalCents: 16_500,
  discountCents: 1_650,
  byBrand: [
    { brandId: 'b1', brandName: 'NoName Coffee', orders: 2, menuTotalCents: 11_500, discountCents: 1_150 },
    { brandId: 'b2', brandName: 'Качели', orders: 1, menuTotalCents: 5_000, discountCents: 500 },
  ],
  byStore: [
    {
      brandId: 'b1',
      brandName: 'NoName Coffee',
      storeId: 's1',
      storeName: 'Центр',
      orders: 2,
      menuTotalCents: 11_500,
      discountCents: 1_150,
    },
    {
      brandId: 'b2',
      brandName: 'Качели',
      storeId: 's2',
      storeName: 'Балка',
      orders: 1,
      menuTotalCents: 5_000,
      discountCents: 500,
    },
  ],
  byDay: [
    { date: '2026-11-03', orders: 1, discountCents: 1_000 },
    { date: '2026-11-04', orders: 2, discountCents: 650 },
  ],
};

describe('TakeawayPromoReportPage', () => {
  let fixture: ComponentFixture<TakeawayPromoReportPage>;
  let report: jest.Mock;

  async function render(data: TakeawayPromoReport = REPORT) {
    report = jest.fn().mockReturnValue(of(data));
    TestBed.configureTestingModule({
      imports: [TakeawayPromoReportPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: TakeawayPromosApi, useValue: { report } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    fixture = TestBed.createComponent(TakeawayPromoReportPage);
    fixture.componentRef.setInput('promoId', 'tp1');
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => TestBed.resetTestingModule());

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (node: Element | null | undefined) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const rows = (testId: string) =>
    [...el().querySelectorAll(`[data-testid="${testId}"] tbody tr`)].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => text(td)),
    );

  it('shows the tiles: orders, customers, budget, spent (with what still waits for payment) and left', async () => {
    await render();
    expect(report).toHaveBeenCalledWith('tp1');
    expect(text(el().querySelector('h1'))).toBe('Отчёт: Приветственный бонус Приветственная');

    const tiles = [...el().querySelectorAll('[data-testid="takeaway-promo-kpis"] app-kpi-card')].map((t) =>
      [t.querySelector('.kpi-label'), t.querySelector('.kpi-value'), ...t.querySelectorAll('.kpi-foot span')]
        .map((n) => text(n))
        .filter(Boolean)
        .join(' | '),
    );
    expect(tiles).toEqual([
      'Заказы | 3 | по меню 165 руб.',
      'Клиенты | 3',
      'Бюджет | 1 000 руб.',
      'Израсходовано | 21 руб. | скидки 16,50 руб. | ждут оплаты 4,50 руб.',
      'Остаток | 979 руб.',
    ]);
  });

  it('breaks the counted orders down by brand, by venue and by day', async () => {
    await render();
    expect(rows('takeaway-promo-by-brand')).toEqual([
      ['NoName Coffee', '2', '115 руб.', '11,50 руб.'],
      ['Качели', '1', '50 руб.', '5 руб.'],
    ]);
    expect(rows('takeaway-promo-by-store')[0]).toEqual(['Центр NoName Coffee', '2', '115 руб.', '11,50 руб.']);
    expect(rows('takeaway-promo-by-day').map((r) => r.slice(1))).toEqual([
      ['1', '10 руб.'],
      ['2', '6,50 руб.'],
    ]);
  });

  it('says so when no order counted yet', async () => {
    await render({
      ...REPORT,
      orders: 0,
      customers: 0,
      menuTotalCents: 0,
      discountCents: 0,
      byBrand: [],
      byStore: [],
      byDay: [],
    });
    expect(text(el())).toContain('По акции ещё нет учтённых заказов.');
    expect(el().querySelector('[data-testid="takeaway-promo-by-brand"]')).toBeNull();
  });
});
