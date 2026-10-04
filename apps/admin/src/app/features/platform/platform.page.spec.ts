import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { OverviewTotals, PlatformBrandRow, PlatformOverview } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { AnalyticsApi } from '../../core/analytics/analytics.service';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { BrandsService } from '../../core/brands/brands.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { PlatformPage } from './platform.page';

const totals = (over: Partial<OverviewTotals> = {}): OverviewTotals => ({
  revenueCents: 1_000_000,
  orders: 100,
  placed: 104,
  customers: 80,
  newCustomers: 20,
  avgCheckCents: 10_000,
  cancelled: 3,
  expired: 1,
  cancelRatePercent: 3.8,
  avgPickupSeconds: 120,
  activeUnits: 2,
  commissionCents: 135_000,
  ...over,
});

function brand(id: string, name: string, revenueCents: number, plan: 'BASIC' | 'PRO', bps: number): PlatformBrandRow {
  return {
    id,
    name,
    revenueCents,
    orders: revenueCents / 10_000,
    sharePercent: revenueCents / 10_000,
    ordersSharePercent: revenueCents / 10_000,
    detailed: true,
    previousRevenueCents: revenueCents / 2,
    previousOrders: revenueCents / 20_000,
    revenueDeltaPercent: 100,
    avgCheckCents: 10_000,
    customers: 10,
    cancelled: 1,
    expired: 0,
    cancelRatePercent: 1,
    avgPickupSeconds: 100,
    currency: 'RUP',
    plan,
    commissionBps: bps,
    commissionCents: (revenueCents * bps) / 10_000,
    previousCommissionCents: 0,
    stores: 1,
    moderationStatus: 'APPROVED',
  };
}

const DATA: PlatformOverview = {
  period: {
    from: '2026-09-05',
    to: '2026-10-04',
    days: 30,
    timeZone: 'Europe/Chisinau',
    previousFrom: '2026-08-06',
    previousTo: '2026-09-04',
  },
  currency: 'RUP',
  currencies: ['MDL', 'RUP'],
  current: totals(),
  previous: totals({ commissionCents: 100_000 }),
  daily: [],
  statuses: {},
  byBrand: [brand('b1', 'NoName Coffee', 700_000, 'PRO', 1500), brand('b2', 'Утро', 300_000, 'BASIC', 1000)],
  byHour: [],
  byWeekday: [],
};

describe('PlatformPage', () => {
  let platformOverview: jest.Mock;
  let select: jest.Mock;

  async function render() {
    platformOverview = jest.fn().mockReturnValue(of(DATA));
    select = jest.fn();
    TestBed.configureTestingModule({
      imports: [PlatformPage],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        {
          provide: AnalyticsApi,
          useValue: { platformOverview, orderStatuses: jest.fn().mockReturnValue(of(null)) },
        },
        { provide: ActiveBrandService, useValue: { select } },
        { provide: BrandsService, useValue: { pendingCount: signal(2), loadPendingCount: jest.fn() } },
        { provide: FeatureFlagsStore, useValue: { deliveryEnabled: signal(false) } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(PlatformPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('reads the platform overview and lets the currency be switched', async () => {
    const fixture = await render();
    expect(platformOverview).toHaveBeenLastCalledWith({ days: 30 }, null);
    fixture.componentInstance.currency.set('MDL');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(platformOverview).toHaveBeenLastCalledWith({ days: 30 }, 'MDL');
  });

  it('shows the platform commission and each business with its plan and commission', async () => {
    const fixture = await render();
    const page = (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';
    expect(page).toContain('Комиссия платформы');
    expect(page).toContain('+35 %');
    const rows = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.ov-table tbody tr')];
    expect(rows.map((r) => r.querySelector('.ov-name')?.textContent?.trim().split(/\s+/)[0])).toEqual([
      'NoName',
      'Утро',
    ]);
    expect(rows[0]?.textContent?.replace(/\s+/g, ' ')).toContain('PRO · 15 %');
    expect(rows[0]?.textContent?.replace(/\s+/g, ' ')).toContain('1 050 руб.');
  });

  it('drills into a business as its owner sees it', async () => {
    const fixture = await render();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (fixture.nativeElement.querySelector('.ov-table tbody tr') as HTMLElement).click();
    expect(select).toHaveBeenCalledWith('b1');
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});
