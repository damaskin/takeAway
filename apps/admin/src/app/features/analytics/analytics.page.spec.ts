import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { TranslatePipe, TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { PlanFeature } from '@takeaway/shared-types';
import { of } from 'rxjs';

import {
  AnalyticsApi,
  type CohortStats,
  type RevenueSeries,
  type TopProduct,
} from '../../core/analytics/analytics.service';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { PlanAccess } from '../../core/plans/plan-access.service';
import { AdminAnalyticsPage } from './analytics.page';

/** The tester's week at «Кофейни Качели», on the reconciled basis. */
const WEEK: RevenueSeries = {
  from: '2026-10-02',
  to: '2026-10-08',
  timeZone: 'Europe/Chisinau',
  totalRevenueCents: 6_300,
  totalOrders: 10,
  avgBasketCents: 630,
  salesCents: 10_500,
  discountCents: 4_200,
  giftCardCents: 1_400,
  bestDay: { date: '2026-10-07', revenueCents: 3_900, orderCount: 4 },
  revenueDeltaPercent: null,
  previousRevenueCents: 0,
  points: [{ date: '2026-10-07', revenueCents: 3_900, orderCount: 4 }],
  currency: 'RUP',
  currencies: ['RUP'],
};

const TOP: TopProduct[] = [{ name: 'Американо', unitsSold: 10, revenueCents: 5_100, salesCents: 10_500 }];

const COHORT: CohortStats = {
  customers: 1,
  newCustomers: 1,
  returningCustomers: 0,
  repeatRatePercent: 100,
  avgBasketCents: 630,
  pickupSlaPercent: 90,
};

const store = (id: string, name: string, currency: string) => ({ id, name, currency }) as StoreAdminDto;

/** Text with every run of whitespace (NBSP included) as one space. */
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('AdminAnalyticsPage', () => {
  let revenue: jest.Mock;

  async function render(
    stores: StoreAdminDto[] = [store('s1', 'Балка', 'RUP')],
    series: RevenueSeries = WEEK,
    query: Record<string, string> | null = null,
  ) {
    revenue = jest.fn().mockReturnValue(of(series));
    const params = convertToParamMap(query ?? {});
    TestBed.configureTestingModule({
      imports: [AdminAnalyticsPage],
      providers: [
        provideRouter([]),
        ...(query
          ? [{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: params }, queryParamMap: of(params) } }]
          : []),
        provideTranslateService(),
        {
          provide: AnalyticsApi,
          useValue: {
            revenue,
            topProducts: jest.fn().mockReturnValue(of(TOP)),
            cohort: jest.fn().mockReturnValue(of(COHORT)),
          },
        },
        { provide: AdminCatalogApi, useValue: { listStores: jest.fn().mockReturnValue(of(stores)) } },
        {
          provide: ActiveBrandService,
          useValue: { activeId: signal('b1'), active: signal({ id: 'b1', currency: 'RUP' }) },
        },
        { provide: PlanAccess, useValue: { has: (_f: PlanFeature) => true } },
      ],
    });
    // The retention tab, the range picker and the plan lock have their own specs.
    TestBed.overrideComponent(AdminAnalyticsPage, { set: { imports: [TranslatePipe], schemas: [NO_ERRORS_SCHEMA] } });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(AdminAnalyticsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('says «new in the period» instead of +100 % against nothing', async () => {
    const fixture = await render();
    const head = text((fixture.nativeElement as HTMLElement).querySelector('.an-revenue-head'));
    expect(head).toContain('новое за период');
    expect(head).not.toContain('100 %');
    expect(head).not.toContain('к прошлому периоду');
  });

  it('writes the same money as the dashboard, kopecks included, and how it is made up', async () => {
    const fixture = await render();
    const head = text((fixture.nativeElement as HTMLElement).querySelector('.an-revenue-head'));
    expect(head).toContain('63 руб.');
    expect(head).toContain('10 заказов · средний чек 6,30 руб.');
    expect(head).toContain(
      'Продажи 105 руб. − скидки 42 руб. = выручка 63 руб. · из них оплачено подарочными картами 14 руб.',
    );
  });

  it('ranks products after discounts and shows the menu-price sum beside them', async () => {
    const fixture = await render();
    const page = text(fixture.nativeElement);
    expect(page).toContain('после скидок — в сумме не больше выручки');
    expect(page).toContain('10 продано · 51 руб. · до скидок 105 руб.');
  });

  it('counts a lone first-time customer as new, not as a returning one', async () => {
    const fixture = await render();
    const tiles = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.an-tile')].map(
      (t) => `${text(t.querySelector('span'))}: ${text(t.querySelector('strong'))}`,
    );
    expect(tiles).toEqual(
      expect.arrayContaining([
        'Клиенты: 1',
        'Новые клиенты: 1',
        'Постоянные: 0 %',
        'Заказали больше раза: 100 %',
        'Средний чек: 6,30 руб.',
      ]),
    );
  });

  it('asks for one currency when the stores price in several, and follows a picked store', async () => {
    const fixture = await render([store('s1', 'Балка', 'RUP'), store('s2', 'Кишинёв', 'MDL')]);
    expect(revenue).toHaveBeenLastCalledWith('b1', { days: 14, storeId: null, currency: 'RUP' });
    expect(text(fixture.nativeElement)).toContain('Показаны точки с валютой RUP');

    fixture.componentInstance.storeId.set('s2');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.currency()).toBe('MDL');
    expect(fixture.componentInstance.price(630).replace(/\s+/g, ' ')).toBe('6,30 MDL');

    fixture.componentInstance.pickCurrency('RUP');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(revenue).toHaveBeenLastCalledWith('b1', { days: 14, storeId: null, currency: 'RUP' });
  });

  it('opens «Возврат клиентов» on the threshold a link brought, older `window` links too', async () => {
    const fromCard = await render(undefined, undefined, { tab: 'retention', inactiveDays: '30' });
    expect(fromCard.componentInstance.inactiveDays()).toBe(30);
    TestBed.resetTestingModule();
    const older = await render(undefined, undefined, { tab: 'retention', window: '3' });
    expect(older.componentInstance.inactiveDays()).toBe(3);
    TestBed.resetTestingModule();
    const plain = await render(undefined, undefined, { tab: 'retention' });
    expect(plain.componentInstance.inactiveDays()).toBe(14);
  });

  it('puts a threshold picked on the tab into the address', async () => {
    const fixture = await render(undefined, undefined, { tab: 'retention', window: '7' });
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.componentInstance.pickInactiveDays(45);
    expect(fixture.componentInstance.inactiveDays()).toBe(45);
    expect(navigate).toHaveBeenCalledWith([], {
      queryParams: { inactiveDays: 45, window: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });
});
