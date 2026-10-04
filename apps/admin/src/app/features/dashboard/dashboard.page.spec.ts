import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterLink, provideRouter } from '@angular/router';
import { TranslatePipe, TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { BusinessOverview, OverviewRow, OverviewTotals, PlanFeature } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { AnalyticsApi } from '../../core/analytics/analytics.service';
import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { OrderAlertsService } from '../../core/kitchen/order-alerts.service';
import { AdminOrdersApi } from '../../core/orders/orders.service';
import { PlanAccess } from '../../core/plans/plan-access.service';
import { BarChartComponent } from '../../shared/charts/bar-chart.component';
import { DonutChartComponent } from '../../shared/charts/donut-chart.component';
import { KpiCardComponent } from '../../shared/charts/kpi-card.component';
import { MiniBarsComponent } from '../../shared/charts/mini-bars.component';
import { ShareBarsComponent } from '../../shared/charts/share-bars.component';
import { SparklineComponent } from '../../shared/charts/sparkline.component';
import { OrderStatusPanelComponent } from '../../shared/order-status-panel.component';
import { OverviewHeaderComponent } from '../../shared/overview/overview-header.component';
import { PlanLockComponent } from '../../shared/plan-lock.component';
import { DashboardPage } from './dashboard.page';

function totals(over: Partial<OverviewTotals> = {}): OverviewTotals {
  return {
    revenueCents: 1_234_500,
    orders: 42,
    placed: 45,
    customers: 30,
    newCustomers: 6,
    avgCheckCents: 29_393,
    cancelled: 2,
    expired: 1,
    cancelRatePercent: 6.7,
    avgPickupSeconds: 270,
    activeUnits: 2,
    commissionCents: 123_450,
    ...over,
  };
}

function store(id: string, name: string, revenueCents: number, orders: number, previousOrders: number): OverviewRow {
  return {
    id,
    name,
    revenueCents,
    orders,
    sharePercent: 50,
    ordersSharePercent: 50,
    detailed: true,
    previousRevenueCents: revenueCents,
    previousOrders,
    revenueDeltaPercent: 0,
    avgCheckCents: orders ? Math.round(revenueCents / orders) : null,
    customers: orders,
    cancelled: 1,
    expired: 0,
    cancelRatePercent: 2,
    avgPickupSeconds: 150,
  };
}

const PRO: BusinessOverview = {
  period: {
    from: '2026-09-28',
    to: '2026-10-04',
    days: 7,
    timeZone: 'Europe/Chisinau',
    previousFrom: '2026-09-21',
    previousTo: '2026-09-27',
  },
  current: totals(),
  previous: totals({ revenueCents: 1_097_333, orders: 44, customers: 30 }),
  daily: ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map(
    (date, i) => ({
      date,
      revenueCents: 150_000 + i * 1000,
      orders: 6,
      customers: 5,
      newCustomers: 1,
      cancelled: 0,
      expired: 0,
      commissionCents: 0,
    }),
  ),
  statuses: { PICKED_UP: 40, PAID: 2, CANCELLED: 2, EXPIRED: 1 },
  byStore: [store('s1', 'Центр', 800_000, 20, 30), store('s2', 'Балка', 434_500, 22, 10)],
  storeComparison: true,
  byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, orders: hour === 8 ? 10 : 1, revenueCents: 100 })),
  byWeekday: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, orders: i, revenueCents: 100 })),
};

const BASIC: BusinessOverview = {
  ...PRO,
  storeComparison: false,
  byHour: null,
  byWeekday: null,
  byStore: PRO.byStore.map((s) => ({
    ...s,
    detailed: false,
    previousRevenueCents: null,
    previousOrders: null,
    revenueDeltaPercent: null,
    avgCheckCents: null,
    customers: null,
    cancelled: null,
    expired: null,
    cancelRatePercent: null,
    avgPickupSeconds: null,
  })),
};

const STATUSES = {
  from: '2026-09-28',
  to: '2026-10-04',
  timeZone: 'Europe/Chisinau',
  days: 7,
  live: { CREATED: 1, PAID: 2, ACCEPTED: 1, IN_PROGRESS: 3, READY: 0, OUT_FOR_DELIVERY: 0 },
  liveTotal: 7,
  period: { total: 40, completed: 30, cancelled: 2, expired: 1, completionRatePercent: 90.9, byStatus: {} },
};

/** Text with every run of whitespace (NBSP included) as one space. */
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('DashboardPage', () => {
  let overview: jest.Mock;
  let orderStatuses: jest.Mock;
  let revision: ReturnType<typeof signal<number>>;

  async function render(data: BusinessOverview = PRO, features: PlanFeature[] = ['promo']) {
    overview = jest.fn().mockReturnValue(of(data));
    orderStatuses = jest.fn().mockReturnValue(of(STATUSES));
    revision = signal(0);
    TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: AuthStore, useValue: { user: signal({ name: 'Ира', role: 'BRAND_ADMIN' }) } },
        {
          provide: ActiveBrandService,
          useValue: { activeId: signal('b1'), active: signal({ id: 'b1', currency: 'MDL' }) },
        },
        { provide: AnalyticsApi, useValue: { overview, orderStatuses } },
        { provide: PlanAccess, useValue: { has: (f: PlanFeature) => features.includes(f) } },
        { provide: OrderAlertsService, useValue: { revision } },
        { provide: FeatureFlagsStore, useValue: { deliveryEnabled: signal(false) } },
        { provide: AdminOrdersApi, useValue: { list: jest.fn().mockReturnValue(of([])) } },
      ],
    });
    // The launch checklist and the widgets have their own specs and APIs.
    TestBed.overrideComponent(DashboardPage, {
      set: {
        imports: [
          RouterLink,
          TranslatePipe,
          OverviewHeaderComponent,
          KpiCardComponent,
          SparklineComponent,
          MiniBarsComponent,
          ShareBarsComponent,
          DonutChartComponent,
          BarChartComponent,
          PlanLockComponent,
          OrderStatusPanelComponent,
        ],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');

    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  async function settle(fixture: Awaited<ReturnType<typeof render>>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('asks for the picked period in one request, 30 days to begin with', async () => {
    const fixture = await render();
    expect(overview).toHaveBeenCalledTimes(1);
    expect(overview).toHaveBeenLastCalledWith('b1', { days: 30, storeId: null });

    fixture.componentInstance.range.set({ from: '2026-09-01', to: '2026-09-15' });
    await settle(fixture);
    expect(overview).toHaveBeenLastCalledWith('b1', { from: '2026-09-01', to: '2026-09-15', storeId: null });
    expect(orderStatuses).toHaveBeenLastCalledWith('b1', { from: '2026-09-01', to: '2026-09-15', storeId: null });
  });

  it('writes the KPIs with their change against the period before', async () => {
    const fixture = await render();
    const cards = [...(fixture.nativeElement as HTMLElement).querySelectorAll('app-kpi-card')];
    const revenue = cards[0];
    expect(text(revenue)).toContain('12 345 MDL');
    expect(text(revenue)).toContain('+12,5 %');
    expect(revenue?.querySelector('[data-tone="up"]')).not.toBeNull();
    const orders = cards.find((c) => text(c).startsWith('Заказы'));
    expect(orders?.querySelector('[data-tone="down"]')).not.toBeNull();
    // More cancellations is bad news: the colour flips.
    const cancelRate = cards.find((c) => text(c).startsWith('Доля отмен'));
    expect(text(cancelRate)).toContain('6,7 %');
    expect(text(fixture.nativeElement)).toContain('сравнение с предыдущими 7 днями');
  });

  it('lists the stores, highest revenue first, and sorts by a header', async () => {
    const fixture = await render();
    const names = () =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll('.ov-table tbody tr .ov-name')].map((td) => text(td));
    expect(names()).toEqual(['Центр', 'Балка']);

    const ordersHeader = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.ov-table th button')].find(
      (b) => text(b) === 'Заказы',
    ) as HTMLButtonElement;
    ordersHeader.click();
    await settle(fixture);
    expect(names()).toEqual(['Балка', 'Центр']);
    ordersHeader.click();
    await settle(fixture);
    expect(names()).toEqual(['Центр', 'Балка']);
  });

  it('narrows the whole page to a store picked in the table, and back', async () => {
    const fixture = await render();
    const row = (fixture.nativeElement as HTMLElement).querySelector('.ov-table tbody tr') as HTMLElement;
    row.click();
    await settle(fixture);
    expect(overview).toHaveBeenLastCalledWith('b1', { days: 30, storeId: 's1' });
    expect(orderStatuses).toHaveBeenLastCalledWith('b1', { days: 30, storeId: 's1' });
    expect(text(fixture.nativeElement.querySelector('.ov-chip'))).toContain('Центр');
    // Every store stays in the selector while one is picked.
    expect(fixture.componentInstance.storeOptions().map((s) => s.id)).toEqual(['s1', 's2']);

    fixture.componentInstance.pickStore('s1');
    await settle(fixture);
    expect(overview).toHaveBeenLastCalledWith('b1', { days: 30, storeId: null });
  });

  it('shows the comparison and the load on PRO', async () => {
    const fixture = await render(PRO);
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('.ov-table thead'))).toContain('Δ заказов');
    expect(text(el.querySelector('.ov-table thead'))).toContain('Время выдачи');
    expect(el.querySelectorAll('app-bar-chart')).toHaveLength(2);
    expect(el.querySelector('app-plan-lock')).toBeNull();
    // Center: 20 orders now, 30 before.
    expect(text(el.querySelector('.ov-table tbody tr'))).toContain('−10');
  });

  it('keeps BASIC on revenue, orders and shares, and offers PRO for the rest', async () => {
    const fixture = await render(BASIC);
    const el = fixture.nativeElement as HTMLElement;
    const head = text(el.querySelector('.ov-table thead'));
    expect(head).toContain('Выручка');
    expect(head).toContain('Доля');
    expect(head).not.toContain('Δ заказов');
    expect(el.querySelectorAll('app-bar-chart')).toHaveLength(0);
    const locks = [...el.querySelectorAll('app-plan-lock')].map((l) => l.getAttribute('feature') ?? '');
    expect(locks.length).toBe(2);
    expect(text(el)).toContain('Сравнение точек');
    // The KPIs, the store shares and the statuses stay.
    expect(el.querySelectorAll('app-kpi-card').length).toBe(9);
    expect(el.querySelector('app-share-bars')).not.toBeNull();
    expect(el.querySelector('app-donut-chart')).not.toBeNull();
  });

  it('says there is nothing yet when neither period has an order', async () => {
    const empty = { ...PRO, current: totals({ placed: 0, orders: 0 }), previous: totals({ placed: 0, orders: 0 }) };
    const fixture = await render(empty);
    expect(text(fixture.nativeElement)).toContain('Заказов за период нет');
    expect((fixture.nativeElement as HTMLElement).querySelector('.ov-table')).toBeNull();
  });

  it('shows where the orders stand, waiting ones together', async () => {
    const fixture = await render();
    const panel = fixture.nativeElement.querySelector('.dash-statuses') as HTMLElement;
    expect(panel.textContent).toContain('Ждут принятия');
    expect(panel.querySelector('.dash-status-hot .dash-status-value')?.textContent?.trim()).toBe('3');
  });

  it('re-reads the live figures when the kitchen feed reports a change, not the whole overview', async () => {
    const fixture = await render();
    const calls = orderStatuses.mock.calls.length;
    revision.set(1);
    await settle(fixture);
    expect(orderStatuses.mock.calls.length).toBe(calls + 1);
    expect(overview).toHaveBeenCalledTimes(1);
  });

  it('reloads on the refresh button', async () => {
    const fixture = await render();
    (fixture.nativeElement.querySelector('.oh-refresh') as HTMLButtonElement).click();
    await settle(fixture);
    expect(overview).toHaveBeenCalledTimes(2);
  });

  it('offers a new promo code only on a plan that has them', async () => {
    const pro = await render(PRO, ['promo']);
    expect((pro.nativeElement as HTMLElement).querySelector('a[href="/promo/new"]')).not.toBeNull();
    TestBed.resetTestingModule();
    const basic = await render(PRO, []);
    expect((basic.nativeElement as HTMLElement).querySelector('a[href="/promo/new"]')).toBeNull();
  });
});
