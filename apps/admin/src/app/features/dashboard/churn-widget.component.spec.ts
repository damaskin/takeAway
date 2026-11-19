import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { PlanFeature } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { AnalyticsApi, type AnalyticsPeriod, type InactiveNow } from '../../core/analytics/analytics.service';
import { AuthStore } from '../../core/auth/auth.store';
import { PlanAccess } from '../../core/plans/plan-access.service';
import { ChurnWidgetComponent } from './churn-widget.component';

const STATS: InactiveNow = {
  inactiveDays: 14,
  asOf: '2026-11-18',
  timeZone: 'Europe/Chisinau',
  count: 4,
  lostRevenueCents: 52_000,
  currency: 'MDL',
  customers: [
    {
      userId: 'u1',
      name: 'Ира',
      phone: null,
      orders: 9,
      totalCents: 117_000,
      avgCheckCents: 13_000,
      lastOrderAt: '2026-10-29T09:00:00.000Z',
      daysSinceLastOrder: 20,
      visits: 9,
      visitIntervalDays: 5,
      lostRevenueCents: 52_000,
    },
  ],
  activeElsewhere: null,
};

/** Text with every run of whitespace (NBSP included) as one space. */
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('ChurnWidgetComponent', () => {
  let inactive: jest.Mock;

  async function render(
    opts: { role?: string; features?: PlanFeature[]; stats?: InactiveNow; period?: AnalyticsPeriod } = {},
  ) {
    inactive = jest.fn().mockReturnValue(of(opts.stats ?? STATS));
    TestBed.configureTestingModule({
      imports: [ChurnWidgetComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: AnalyticsApi, useValue: { inactive } },
        { provide: AuthStore, useValue: { user: signal({ role: opts.role ?? 'BRAND_ADMIN' }) } },
        {
          provide: PlanAccess,
          useValue: {
            has: (f: PlanFeature) => (opts.features ?? ['churnList', 'winBack', 'customers']).includes(f),
          },
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

  async function settle(fixture: Awaited<ReturnType<typeof render>>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const pill = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('app-inactive-days button')].find((b) => text(b) === label);

  beforeEach(() => TestBed.resetTestingModule());

  it('is called «Неактивные клиенты» and puts the missed revenue first, then who is inactive now', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('h2'))).toBe('Неактивные клиенты');
    const tiles = [...el.querySelectorAll('.churn-figures > div')];
    expect(tiles[0]?.classList).toContain('churn-money');
    expect(text(tiles[0])).toContain('упущенная выручка');
    expect(text(tiles[0])).toContain('520 MDL');
    expect(text(tiles[1])).toContain('сейчас неактивны');
    expect(text(el.querySelector('[data-testid="churn-count"]'))).toBe('4');
  });

  it('explains the estimate: days away ÷ usual interval × average check, a forecast', async () => {
    const fixture = await render();
    const money = (fixture.nativeElement as HTMLElement).querySelector('.churn-money');
    expect(text(money)).toContain(
      'Сколько клиент принёс бы, если бы заходил в своём обычном темпе: дни без визитов ÷ обычный интервал × средний чек. Это прогноз, а не потерянная прибыль.',
    );
    expect(money?.getAttribute('title')).toContain('средний интервал по бренду');
  });

  it('lists each customer with their own estimate, not their average check', async () => {
    const fixture = await render();
    const item = text((fixture.nativeElement as HTMLElement).querySelector('.churn-list li'));
    expect(item).toContain('≈ 520 MDL');
    expect(item).toContain('20 дн. назад');
    expect(item).not.toContain('130 MDL');
  });

  it('asks for the inactive right now on 14 days and the dashboard’s store, not its period', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('.dash-muted'))).toContain('14 дн.');
    expect(pill(el, '14 дн.')?.getAttribute('aria-pressed')).toBe('true');
    expect(inactive).toHaveBeenLastCalledWith('b1', { storeId: 's1', currency: null }, 14, 3);

    // Another period alone does not ask again: who is inactive now does not depend on it.
    fixture.componentRef.setInput('period', { days: 7, storeId: 's1' });
    await settle(fixture);
    expect(inactive).toHaveBeenCalledTimes(1);
  });

  it('offers 7 / 14 / 30 / 90 days and a custom number, and asks again with the one picked', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    const labels = [...el.querySelectorAll('app-inactive-days button')].map(text);
    expect(labels).toEqual(['7 дн.', '14 дн.', '30 дн.', '90 дн.', 'Свой…']);

    pill(el, '30 дн.')?.click();
    await settle(fixture);
    expect(inactive).toHaveBeenLastCalledWith('b1', { storeId: 's1', currency: null }, 30, 3);
    expect(text(el.querySelector('.dash-muted'))).toContain('30 дн.');

    pill(el, 'Свой…')?.click();
    await settle(fixture);
    const field = el.querySelector('app-inactive-days input') as HTMLInputElement;
    field.value = '45';
    field.dispatchEvent(new Event('input'));
    await settle(fixture);
    (el.querySelector('.idays-apply') as HTMLButtonElement).click();
    await settle(fixture);
    expect(inactive).toHaveBeenLastCalledWith('b1', { storeId: 's1', currency: null }, 45, 3);
    expect(pill(el, '45 дн.')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('opens «Возврат клиентов» on the same threshold, period and store', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    pill(el, '30 дн.')?.click();
    await settle(fixture);
    const link = el.querySelector('a.churn-cta') as HTMLAnchorElement;
    expect(text(link)).toBe('Возврат клиентов');
    const url = new URL(link.href);
    expect(url.pathname).toBe('/analytics');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tab: 'retention',
      inactiveDays: '30',
      days: '30',
      storeId: 's1',
    });
  });

  it('opens «Клиенты → Неактивные» on the same threshold and store — the same people', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    pill(el, '90 дн.')?.click();
    await settle(fixture);
    const link = el.querySelector('a.churn-all') as HTMLAnchorElement;
    expect(text(link)).toBe('Все неактивные →');
    const url = new URL(link.href);
    expect(url.pathname).toBe('/customers');
    expect(Object.fromEntries(url.searchParams)).toEqual({ segment: 'inactive', inactiveDays: '90', storeId: 's1' });
  });

  it('keeps a custom range in the «Возврат клиентов» link', async () => {
    const fixture = await render({ period: { from: '2026-09-01', to: '2026-09-30', storeId: null } });
    const link = (fixture.nativeElement as HTMLElement).querySelector('a.churn-cta') as HTMLAnchorElement;
    expect(Object.fromEntries(new URL(link.href).searchParams)).toEqual({
      tab: 'retention',
      inactiveDays: '14',
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('shows a store manager the figures without links into sections they cannot open', async () => {
    const fixture = await render({ role: 'STORE_MANAGER' });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('a.churn-cta')).toBeNull();
    expect(el.querySelector('a.churn-all')).toBeNull();
    expect(el.querySelector('.churn-list a')).toBeNull();
    expect(text(el.querySelector('.churn-list'))).toContain('Ира');
  });

  it('across the stores, counts who left one store but orders at another, linking to that store', async () => {
    const fixture = await render({
      period: { days: 30 },
      stats: {
        ...STATS,
        activeElsewhere: {
          count: 2,
          stores: [
            { storeId: 's1', storeName: 'Центр', count: 2 },
            { storeId: 's2', storeName: 'Балка', count: 1 },
          ],
        },
      },
    });
    const note = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="churn-active-elsewhere"]');

    expect(text(note)).toContain('Ещё 2 чел. перестали ходить в одну из точек, но заказывают в другой');
    const links = [...(note?.querySelectorAll('a') ?? [])];
    expect(links.map(text)).toEqual(['Центр — 2', 'Балка — 1']);
    const url = new URL((links[1] as HTMLAnchorElement).href);
    expect(url.searchParams.get('storeId')).toBe('s2');
    expect(url.searchParams.get('inactiveDays')).toBe('14');
  });

  it('names the stores without links on BASIC, where the win-back tab is locked', async () => {
    const fixture = await render({
      features: [],
      period: { days: 30 },
      stats: {
        ...STATS,
        customers: null,
        activeElsewhere: { count: 1, stores: [{ storeId: 's1', storeName: 'Центр', count: 1 }] },
      },
    });
    const note = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="churn-active-elsewhere"]');

    expect(text(note)).toContain('Центр — 1');
    expect(note?.querySelector('a')).toBeNull();
  });

  it('shows the PRO lock instead of the names on BASIC, the count and the picker stay', async () => {
    const fixture = await render({ features: [], stats: { ...STATS, customers: null } });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-plan-lock')).not.toBeNull();
    expect(el.querySelector('a.churn-cta')).toBeNull();
    expect(text(el.querySelector('[data-testid="churn-count"]'))).toBe('4');
    expect(el.querySelector('app-inactive-days')).not.toBeNull();
  });
});
