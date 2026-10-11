import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { PlanFeature } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { AnalyticsApi, type AnalyticsPeriod, type ChurnStats } from '../../core/analytics/analytics.service';
import { AuthStore } from '../../core/auth/auth.store';
import { PlanAccess } from '../../core/plans/plan-access.service';
import { ChurnWidgetComponent } from './churn-widget.component';

const STATS: ChurnStats = {
  from: '2026-09-11',
  to: '2026-10-10',
  timeZone: 'Europe/Chisinau',
  window: 14,
  count: 4,
  lostRevenueCents: 52_000,
  previous: { count: 2, lostRevenueCents: 20_000 },
  countDeltaPercent: 100,
  customers: [
    {
      userId: 'u1',
      name: 'Ира',
      phone: null,
      orders: 9,
      totalCents: 117_000,
      avgCheckCents: 13_000,
      lastOrderAt: '2026-09-20T09:00:00.000Z',
      daysSinceLastOrder: 20,
    },
  ],
};

/** Text with every run of whitespace (NBSP included) as one space. */
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('ChurnWidgetComponent', () => {
  let churn: jest.Mock;

  async function render(
    opts: { role?: string; features?: PlanFeature[]; stats?: ChurnStats; period?: AnalyticsPeriod } = {},
  ) {
    churn = jest.fn().mockReturnValue(of(opts.stats ?? STATS));
    TestBed.configureTestingModule({
      imports: [ChurnWidgetComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: AnalyticsApi, useValue: { churn } },
        { provide: AuthStore, useValue: { user: signal({ role: opts.role ?? 'BRAND_ADMIN' }) } },
        {
          provide: PlanAccess,
          useValue: { has: (f: PlanFeature) => (opts.features ?? ['churnList', 'winBack']).includes(f) },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(ChurnWidgetComponent);
    fixture.componentRef.setInput('brandId', 'b1');
    fixture.componentRef.setInput('period', opts.period ?? { days: 30, storeId: 's1' });
    fixture.componentRef.setInput('currency', 'MDL');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('is called «Неактивные клиенты» and puts the missed revenue first, highlighted', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('h2'))).toBe('Неактивные клиенты');
    const tiles = [...el.querySelectorAll('.churn-figures > div')];
    expect(tiles[0]?.classList).toContain('churn-money');
    expect(text(tiles[0])).toContain('упущенная выручка');
    expect(text(tiles[0])).toContain('520 MDL');
    expect(text(tiles[1])).toContain('4');
  });

  it('offers 3, 7 and 14 days and asks again for the one picked', async () => {
    const fixture = await render();
    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.churn-window button')];
    expect(buttons.map((b) => text(b))).toEqual(['3 дн.', '7 дн.', '14 дн.']);
    (buttons[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(churn).toHaveBeenLastCalledWith('b1', { days: 30, storeId: 's1' }, 3, 3);
  });

  it('opens «Возврат» on the same period, store and window', async () => {
    const fixture = await render();
    const link = (fixture.nativeElement as HTMLElement).querySelector('a.churn-cta') as HTMLAnchorElement;
    expect(text(link)).toBe('Возврат');
    const url = new URL(link.href);
    expect(url.pathname).toBe('/analytics');
    expect(Object.fromEntries(url.searchParams)).toEqual({ tab: 'retention', window: '14', days: '30', storeId: 's1' });
  });

  it('keeps a custom range in the link', async () => {
    const fixture = await render({ period: { from: '2026-09-01', to: '2026-09-30', storeId: null } });
    const link = (fixture.nativeElement as HTMLElement).querySelector('a.churn-cta') as HTMLAnchorElement;
    expect(Object.fromEntries(new URL(link.href).searchParams)).toEqual({
      tab: 'retention',
      window: '14',
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('shows a store manager the figures without links into sections they cannot open', async () => {
    const fixture = await render({ role: 'STORE_MANAGER' });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('a.churn-cta')).toBeNull();
    expect(el.querySelector('.churn-list a')).toBeNull();
    expect(text(el.querySelector('.churn-list'))).toContain('Ира');
  });

  it('shows the PRO lock instead of the names on BASIC', async () => {
    const fixture = await render({ features: [], stats: { ...STATS, customers: null } });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-plan-lock')).not.toBeNull();
    expect(el.querySelector('a.churn-cta')).toBeNull();
  });
});
