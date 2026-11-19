import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { PlanFeature } from '@takeaway/shared-types';
import { of } from 'rxjs';

import {
  AnalyticsApi,
  type ChurnStats,
  type InactiveNow,
  type WinBackStats,
} from '../../core/analytics/analytics.service';
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
      visits: 5,
      visitIntervalDays: 1.4444,
      lostRevenueCents: 99_692,
    },
    {
      userId: 'u2',
      name: 'Олег',
      phone: null,
      orders: 3,
      totalCents: 9_000,
      avgCheckCents: 3_000,
      lastOrderAt: '2026-09-28T09:00:00.000Z',
      daysSinceLastOrder: 12,
      visits: 1,
      visitIntervalDays: null,
      lostRevenueCents: 6_000,
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

const NOW: InactiveNow = {
  inactiveDays: 7,
  asOf: '2026-10-10',
  timeZone: 'Europe/Chisinau',
  count: 17,
  lostRevenueCents: 120_000,
  currency: 'MDL',
  customers: null,
  activeElsewhere: null,
};

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('RetentionTabComponent', () => {
  let inactive: jest.Mock;
  let churn: jest.Mock;
  let winBack: jest.Mock;

  async function render(
    features: PlanFeature[] = ['winBack', 'customers', 'campaigns', 'promo'],
    stats: ChurnStats = CHURN,
    days: number | null = 7,
  ) {
    inactive = jest.fn().mockReturnValue(of(NOW));
    churn = jest.fn().mockReturnValue(of(stats));
    winBack = jest.fn().mockReturnValue(of(WIN_BACK));
    TestBed.configureTestingModule({
      imports: [RetentionTabComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: AnalyticsApi, useValue: { churn, winBack, inactive } },
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
    if (days !== null) fixture.componentRef.setInput('inactiveDays', days);
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

  it('across the stores, says who left one store but orders at another, and picks that store on a click', async () => {
    const fixture = await render(undefined, {
      ...CHURN,
      activeElsewhere: { count: 1, stores: [{ storeId: 's2', storeName: 'Балка', count: 1 }] },
    });
    const picked: string[] = [];
    fixture.componentInstance.storePicked.subscribe((id) => picked.push(id));
    const note = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="retention-active-elsewhere"]');

    expect(text(note)).toContain('Ещё 1 чел. перестали ходить в одну из точек, но заказывают в другой');
    (note?.querySelector('button') as HTMLButtonElement).click();
    expect(picked).toEqual(['s2']);
  });

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

  it('explains the estimate and what happens to a customer who came once', async () => {
    const fixture = await render();
    const money = (fixture.nativeElement as HTMLElement).querySelector('.rt-figure-money');
    expect(text(money)).toContain(
      'дни без визитов ÷ обычный интервал × средний чек. Это прогноз, а не потерянная прибыль.',
    );
    expect(text(money?.querySelector('[data-testid="retention-one-visit"]'))).toContain(
      'Кто был всего один раз, тому берём средний интервал по бренду',
    );
  });

  it('shows each lost customer’s usual interval and estimate', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    expect([...el.querySelectorAll('.an-table th')].map((th) => text(th))).toEqual(
      expect.arrayContaining(['Обычно раз в', 'Упущено']),
    );
    const rows = [...el.querySelectorAll('.an-table tbody tr')].map((tr) => text(tr));
    expect(rows[0]).toContain('1,4 дн.');
    expect(rows[0]).toContain('≈ 996,92 MDL');
    expect(rows[1]).toContain('один визит');
    expect(rows[1]).toContain('≈ 60 MDL');
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

  it('counts the segment those buttons reach with the dashboard card’s request — the people of «Клиенты → Неактивные»', async () => {
    const fixture = await render();
    // The card's own endpoint, the count alone.
    expect(inactive).toHaveBeenCalledWith('b1', { days: 14, storeId: 's1' }, 7, 0);
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('.rt-now'))).toContain('Сейчас неактивны: 17');
    const all = [...el.querySelectorAll('a.dash-link')].find((a) => text(a).startsWith('Все неактивные'));
    const url = new URL((all as HTMLAnchorElement).href);
    expect(url.pathname).toBe('/customers');
    expect(Object.fromEntries(url.searchParams)).toEqual({ segment: 'inactive', inactiveDays: '7', storeId: 's1' });
  });

  it('opens each inactive customer on the customers page', async () => {
    const fixture = await render();
    const row = (fixture.nativeElement as HTMLElement).querySelector('.an-table a.an-row-name') as HTMLAnchorElement;
    expect(new URL(row.href).pathname).toBe('/customers/u1');
  });

  it('has the threshold picker next to the definition, on the threshold it counts by', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    const picker = el.querySelector('.rt-definition app-inactive-days');
    expect(picker).not.toBeNull();
    expect([...(picker?.querySelectorAll('button') ?? [])].map(text)).toEqual([
      '7 дн.',
      '14 дн.',
      '30 дн.',
      '90 дн.',
      'Свой…',
    ]);
    expect(text(picker?.querySelector('button[aria-pressed="true"]'))).toBe('7 дн.');
    expect(text(el.querySelector('.rt-definition strong'))).toContain('последние 7 дн.');
    expect(churn).toHaveBeenLastCalledWith('b1', { days: 14, storeId: 's1' }, 7, 50);
  });

  it('counts everything again by the threshold picked, and tells the page', async () => {
    const fixture = await render();
    const picked: number[] = [];
    fixture.componentInstance.inactiveDays.subscribe((d) => picked.push(d));
    const el = fixture.nativeElement as HTMLElement;
    const thirty = [...el.querySelectorAll<HTMLButtonElement>('app-inactive-days button')].find(
      (b) => text(b) === '30 дн.',
    );
    thirty?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(picked).toEqual([30]);
    expect(churn).toHaveBeenLastCalledWith('b1', { days: 14, storeId: 's1' }, 30, 50);
    expect(winBack).toHaveBeenLastCalledWith('b1', { days: 14, storeId: 's1' }, 30, 20);
    expect(inactive).toHaveBeenLastCalledWith('b1', { days: 14, storeId: 's1' }, 30, 0);
    expect(text(el.querySelector('.rt-definition strong'))).toContain('последние 30 дн.');
    expect(links(el)[0]?.query).toEqual({ audience: 'INACTIVE', inactiveDays: '30', storeId: 's1' });
  });

  it('shows a custom threshold from a link as its own pill', async () => {
    const fixture = await render(undefined, undefined, 3);
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('app-inactive-days button[aria-pressed="true"]'))).toBe('3 дн.');
    expect(churn).toHaveBeenLastCalledWith('b1', { days: 14, storeId: 's1' }, 3, 50);
  });

  it('counts by 14 days when the page does not pass a threshold', async () => {
    const fixture = await render(undefined, undefined, null);
    expect(churn).toHaveBeenLastCalledWith('b1', { days: 14, storeId: 's1' }, 14, 50);
    expect(text((fixture.nativeElement as HTMLElement).querySelector('.rt-definition strong'))).toContain(
      'последние 14 дн.',
    );
  });

  it('leaves out what the plan does not include', async () => {
    const fixture = await render(['winBack']);
    expect(links(fixture.nativeElement as HTMLElement)).toEqual([]);
    expect(text((fixture.nativeElement as HTMLElement).querySelector('.rt-now'))).toContain('Сейчас неактивны: 17');
  });
});
