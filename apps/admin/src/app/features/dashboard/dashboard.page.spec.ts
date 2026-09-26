import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterLink, provideRouter } from '@angular/router';
import { TranslatePipe, TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { of } from 'rxjs';

import { AnalyticsApi, type DashboardSummary } from '../../core/analytics/analytics.service';
import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { OrderAlertsService } from '../../core/kitchen/order-alerts.service';
import { AdminOrdersApi } from '../../core/orders/orders.service';
import { OrderStatusPanelComponent } from '../../shared/order-status-panel.component';
import { DashboardPage } from './dashboard.page';

const WEEK: DashboardSummary = {
  days: 7,
  revenueCents: 1_234_500,
  orders: 42,
  avgPickupSeconds: 270,
  nps: null,
  revenueDeltaPercent: 12.5,
  ordersDeltaPercent: -5,
  pickupDeltaSeconds: -30,
};

const STATUSES = {
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

  async function render(data: DashboardSummary = WEEK) {
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
        { provide: OrderAlertsService, useValue: { revision } },
        { provide: FeatureFlagsStore, useValue: { deliveryEnabled: signal(false) } },
        { provide: AdminOrdersApi, useValue: { list: jest.fn().mockReturnValue(of([])) } },
      ],
    });
    // The launch checklist has its own spec and its own API.
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
    expect(summary).toHaveBeenLastCalledWith('b1', 7);
    expect(storePerformance).toHaveBeenLastCalledWith(7, 'b1');

    fixture.componentInstance.setDays('30');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(summary).toHaveBeenLastCalledWith('b1', 30);
    expect(storePerformance).toHaveBeenLastCalledWith(30, 'b1');
  });

  it('ignores a period the selector does not offer', async () => {
    const fixture = await render();
    fixture.componentInstance.setDays('365');
    expect(fixture.componentInstance.days()).toBe(7);
  });

  it('writes the figures and their change in words, with units', async () => {
    const fixture = await render();
    const [revenue, orders, pickup, nps] = fixture.componentInstance.kpis();

    expect(revenue?.value).toBe('12\u00a0345\u00a0MDL');
    expect(revenue?.delta).toBe('▲ 12,5\u00a0% к прошлым 7 дням');
    expect(revenue?.tone).toBe('good');
    expect(orders?.delta).toBe('▼ 5\u00a0% к прошлым 7 дням');
    expect(orders?.tone).toBe('bad');
    // A shorter wait is good news, and seconds are «с», not "s".
    expect(pickup?.value).toBe('4 мин 30 с');
    expect(pickup?.delta).toBe('▼ 30 с к прошлым 7 дням');
    expect(pickup?.tone).toBe('good');
    expect(nps?.value).toBe('—');
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
    expect(orderStatuses).toHaveBeenLastCalledWith('b1', 7);
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
});
