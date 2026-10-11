import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { PlanFeature } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { AnalyticsApi, type ChurnStats, type WinBackStats } from '../../core/analytics/analytics.service';
import { CustomersApi } from '../../core/customers/customers.service';
import { PlanAccess } from '../../core/plans/plan-access.service';
import { RetentionTabComponent } from './retention-tab.component';

const CHURN: ChurnStats = {
  from: '2026-09-27',
  to: '2026-10-10',
  timeZone: 'Europe/Chisinau',
  window: 7,
  count: 3,
  lostRevenueCents: 36_000,
  previous: { count: 3, lostRevenueCents: 30_000 },
  countDeltaPercent: 0,
  customers: [
    {
      userId: 'u1',
      name: 'Ира',
      phone: null,
      orders: 5,
      totalCents: 60_000,
      avgCheckCents: 12_000,
      lastOrderAt: '2026-09-28T09:00:00.000Z',
      daysSinceLastOrder: 12,
    },
  ],
};

const WIN_BACK: WinBackStats = {
  from: '2026-09-27',
  to: '2026-10-10',
  timeZone: 'Europe/Chisinau',
  window: 7,
  current: { lapsedAtStart: 10, returned: 2, returnRatePercent: 20, orders: 3, revenueCents: 9_000 },
  previous: { lapsedAtStart: 8, returned: 1, returnRatePercent: 12.5, orders: 1, revenueCents: 3_000 },
  returnedDeltaPercent: 100,
  revenueDeltaPercent: 200,
  customers: [],
};

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('RetentionTabComponent', () => {
  let list: jest.Mock;
  let churn: jest.Mock;

  async function render(features: PlanFeature[] = ['winBack', 'customers', 'campaigns', 'promo']) {
    list = jest.fn().mockReturnValue(of({ items: [], total: 17, page: 1, pageSize: 1 }));
    churn = jest.fn().mockReturnValue(of(CHURN));
    TestBed.configureTestingModule({
      imports: [RetentionTabComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: AnalyticsApi, useValue: { churn, winBack: jest.fn().mockReturnValue(of(WIN_BACK)) } },
        { provide: CustomersApi, useValue: { list } },
        { provide: PlanAccess, useValue: { has: (f: PlanFeature) => features.includes(f) } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(RetentionTabComponent);
    fixture.componentRef.setInput('brandId', 'b1');
    fixture.componentRef.setInput('period', { days: 14, storeId: 's1' });
    fixture.componentRef.setInput('currency', 'MDL');
    fixture.componentRef.setInput('window', 7);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const links = (el: HTMLElement) =>
    [...el.querySelectorAll('a.rt-action')].map((a) => {
      const url = new URL((a as HTMLAnchorElement).href);
      return {
        label: text(a.querySelector('strong')),
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
      };
    });

  beforeEach(() => TestBed.resetTestingModule());

  it('says who counts as inactive in plain words', async () => {
    const fixture = await render();
    expect(text((fixture.nativeElement as HTMLElement).querySelector('.rt-definition'))).toContain(
      'Неактивный клиент — тот, кто заказывал у вас минимум 3 раза, но не делал заказ последние 7 дн.',
    );
  });

  it('shows the missed revenue first and highlighted, then the count', async () => {
    const fixture = await render();
    const figures = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.rt-figure')];
    expect(figures[0]?.classList).toContain('rt-figure-money');
    expect(text(figures[0])).toContain('360 MDL');
    expect(text(figures[1])).toContain('3');
  });

  it('offers a campaign, a code and an offer for the same days and store', async () => {
    const fixture = await render();
    expect(links(fixture.nativeElement as HTMLElement)).toEqual([
      {
        label: 'Сделать рассылку неактивным',
        path: '/campaigns/new',
        query: { audience: 'INACTIVE', inactiveDays: '7', storeId: 's1' },
      },
      {
        label: 'Создать промокод для неактивных',
        path: '/promotions/promo/new',
        query: { for: 'inactive', inactiveDays: '7', storeId: 's1' },
      },
      {
        label: 'Создать акцию',
        path: '/promotions/promo/new',
        query: { for: 'inactive', inactiveDays: '7', storeId: 's1', then: 'campaign' },
      },
    ]);
  });

  it('counts the segment those buttons reach — the same list as «Клиенты → Неактивные»', async () => {
    const fixture = await render();
    expect(list).toHaveBeenCalledWith({
      brandId: 'b1',
      storeId: 's1',
      segment: 'inactive',
      inactiveDays: 7,
      pageSize: 1,
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('.rt-now'))).toContain('Сейчас неактивны: 17');
    const all = [...el.querySelectorAll('a.dash-link')].find((a) => text(a).startsWith('Все неактивные'));
    const url = new URL((all as HTMLAnchorElement).href);
    expect(url.pathname).toBe('/customers');
    expect(Object.fromEntries(url.searchParams)).toEqual({ segment: 'inactive', days: '7', storeId: 's1' });
  });

  it('opens each inactive customer on the customers page', async () => {
    const fixture = await render();
    const row = (fixture.nativeElement as HTMLElement).querySelector('.an-table a.an-row-name') as HTMLAnchorElement;
    expect(new URL(row.href).pathname).toBe('/customers/u1');
  });

  it('switches the window to 3 days', async () => {
    const fixture = await render();
    const three = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.an-window button')].find(
      (b) => text(b) === '3 дн.',
    ) as HTMLButtonElement;
    three.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(churn).toHaveBeenLastCalledWith('b1', { days: 14, storeId: 's1' }, 3, 50);
  });

  it('leaves out what the plan does not include', async () => {
    const fixture = await render(['winBack']);
    expect(links(fixture.nativeElement as HTMLElement)).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });
});
