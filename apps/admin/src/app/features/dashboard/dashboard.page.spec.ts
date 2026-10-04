import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterLink, provideRouter } from '@angular/router';
import { TranslatePipe, TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { PlanFeature } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { AnalyticsApi, type DashboardSummary } from '../../core/analytics/analytics.service';
import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { OrderAlertsService } from '../../core/kitchen/order-alerts.service';
import { AdminOrdersApi } from '../../core/orders/orders.service';
import { PlanAccess } from '../../core/plans/plan-access.service';
import { OrderStatusPanelComponent } from '../../shared/order-status-panel.component';
import { DashboardPage } from './dashboard.page';

const WEEK: DashboardSummary = {
  from: '2026-09-28',
  to: '2026-10-04',
  timeZone: 'Europe/Chisinau',
  days: 7,
  revenueCents: 1_234_500,
  orders: 42,
  avgCheckCents: 29_393,
  avgPickupSeconds: 270,
  nps: null,
  revenueDeltaPercent: 12.5,
  ordersDeltaPercent: -5,
  avgCheckDeltaPercent: 0,
  pickupDeltaSeconds: -30,
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

describe('DashboardPage', () => {
  let summary: jest.Mock;
  let storePerformance: jest.Mock;
  let orderStatuses: jest.Mock;
  let revision: ReturnType<typeof signal<number>>;

  async function render(data: DashboardSummary = WEEK, features: PlanFeature[] = ['promo']) {
    summary = jest.fn().mockReturnValue(of(data));
    storePerformance = jest.fn().mockReturnValue(of([]));
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
        { provide: AnalyticsApi, useValue: { summary, storePerformance, orderStatuses } },
        { provide: PlanAccess, useValue: { has: (f: PlanFeature) => features.includes(f) } },
        { provide: OrderAlertsService, useValue: { revision } },
        { provide: FeatureFlagsStore, useValue: { deliveryEnabled: signal(false) } },
        { provide: AdminOrdersApi, useValue: { list: jest.fn().mockReturnValue(of([])) } },
      ],
    });
    // The launch checklist, the period picker and the widgets have their own
    // specs and their own APIs.
    TestBed.overrideComponent(DashboardPage, {
      set: { imports: [RouterLink, TranslatePipe, OrderStatusPanelComponent], schemas: [NO_ERRORS_SCHEMA] },
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');

    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('asks for the picked period and counts the stores over the same days', async () => {
    const fixture = await render();
    expect(summary).toHaveBeenLastCalledWith('b1', { days: 7 });
    expect(storePerformance).toHaveBeenLastCalledWith('b1', { days: 7 });

    fixture.componentInstance.range.set({ days: 30 });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(summary).toHaveBeenLastCalledWith('b1', { days: 30 });
    expect(storePerformance).toHaveBeenLastCalledWith('b1', { days: 30 });
  });

  it('sends a calendar range as from and to', async () => {
    const fixture = await render();
    fixture.componentInstance.range.set({ from: '2026-09-01', to: '2026-09-15' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(summary).toHaveBeenLastCalledWith('b1', { from: '2026-09-01', to: '2026-09-15' });
    expect(orderStatuses).toHaveBeenLastCalledWith('b1', { from: '2026-09-01', to: '2026-09-15' });
  });

  it('writes the figures and their change in words, with units', async () => {
    const fixture = await render();
    const [revenue, orders, check, active, pickup] = fixture.componentInstance.kpis();

    expect(revenue?.value).toBe('12 345 MDL');
    expect(revenue?.delta).toBe('▲ 12,5 % к прошлым 7 дням');
    expect(revenue?.tone).toBe('good');
    expect(orders?.delta).toBe('▼ 5 % к прошлым 7 дням');
    expect(orders?.tone).toBe('bad');
    expect(check?.value).toBe('294 MDL');
    expect(check?.tone).toBe('neutral');
    // Open orders right now, whatever the period.
    expect(active?.value).toBe('7');
    // A shorter wait is good news, and seconds are «с», not "s".
    expect(pickup?.value).toBe('4 мин 30 с');
    expect(pickup?.delta).toBe('▼ 30 с к прошлым 7 дням');
    expect(pickup?.tone).toBe('good');
  });

  it('says so when the period before had nothing to compare with', async () => {
    const fixture = await render({
      ...WEEK,
      revenueDeltaPercent: null,
      ordersDeltaPercent: null,
      pickupDeltaSeconds: null,
    });
    const [revenue] = fixture.componentInstance.kpis();

    expect(revenue?.delta).toBe('Пока не с чем сравнить');
    expect(revenue?.tone).toBe('neutral');
  });

  it('shows where the orders stand, waiting ones together', async () => {
    const fixture = await render();
    expect(orderStatuses).toHaveBeenLastCalledWith('b1', { days: 7 });
    const panel = fixture.nativeElement.querySelector('.dash-statuses') as HTMLElement;
    expect(panel.textContent).toContain('Ждут принятия');
    expect(panel.querySelector('.dash-status-hot .dash-status-value')?.textContent?.trim()).toBe('3');
    expect(panel.textContent).toContain('Отменены');
  });

  it('re-reads the live figures when the kitchen feed reports a change', async () => {
    const fixture = await render();
    const calls = orderStatuses.mock.calls.length;
    revision.set(1);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(orderStatuses.mock.calls.length).toBe(calls + 1);
  });

  it('offers a new promo code only on a plan that has them', async () => {
    const pro = await render(WEEK, ['promo']);
    expect((pro.nativeElement as HTMLElement).querySelector('a[href="/promo/new"]')).not.toBeNull();
    TestBed.resetTestingModule();
    const basic = await render(WEEK, []);
    expect((basic.nativeElement as HTMLElement).querySelector('a[href="/promo/new"]')).toBeNull();
  });
});
