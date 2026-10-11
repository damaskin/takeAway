import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { Promo } from '@takeaway/shared-types';
import { BehaviorSubject, of } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminPromoApi } from '../../core/promo/promo.service';
import { AdminPromoPage } from './promo.page';

const DAY = 24 * 60 * 60_000;
const promo = (over: Partial<Promo>): Promo => ({
  id: 'p',
  brandId: 'b1',
  code: 'CODE',
  label: 'Скидка',
  type: 'PERCENT',
  value: 10,
  minSubtotalCents: null,
  maxRedemptions: 0,
  perUserLimit: 0,
  startsAt: new Date(Date.now() - DAY).toISOString(),
  endsAt: new Date(Date.now() + 7 * DAY).toISOString(),
  status: 'RUNNING',
  currency: 'MDL',
  redemptionsCount: 0,
  inactiveDays: null,
  segmentStoreId: null,
  ...over,
});

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('AdminPromoPage', () => {
  let updateStatus: jest.Mock;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  async function render(promos: Promo[], params: Record<string, string> = {}) {
    updateStatus = jest.fn((id: string, status: string) => of(promo({ id, status: status as Promo['status'] })));
    query = new BehaviorSubject(convertToParamMap(params));
    TestBed.configureTestingModule({
      imports: [AdminPromoPage],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: ActivatedRoute, useValue: { queryParamMap: query } },
        { provide: AdminPromoApi, useValue: { list: jest.fn().mockReturnValue(of(promos)), updateStatus } },
        {
          provide: ActiveBrandService,
          useValue: {
            activeId: signal('b1'),
            active: signal({ id: 'b1', currency: 'MDL' }),
            loaded: signal(true),
            refresh: jest.fn(),
          },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(AdminPromoPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const rowActions = (row: Element) => [...row.querySelectorAll('.promo-action')].map((a) => text(a));

  beforeEach(() => TestBed.resetTestingModule());

  it('offers the next steps of each promo as buttons, and editing while nothing depends on it', async () => {
    const fixture = await render([
      promo({ id: 'draft', status: 'DRAFT' }),
      promo({ id: 'live', status: 'RUNNING', redemptionsCount: 4 }),
      promo({ id: 'paused', status: 'PAUSED' }),
      promo({ id: 'used', status: 'PAUSED', redemptionsCount: 2 }),
      promo({ id: 'ended', status: 'EXPIRED' }),
    ]);
    const rows = [...(fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')];
    expect(rows.map(rowActions)).toEqual([
      ['Изменить', 'Запустить'],
      ['Пауза', 'Завершить'],
      ['Изменить', 'Возобновить', 'Завершить'],
      ['Возобновить', 'Завершить'],
      [],
    ]);
  });

  it('starts a draft at once and asks before ending a promo', async () => {
    const fixture = await render([promo({ id: 'draft', status: 'DRAFT' }), promo({ id: 'live' })]);
    const el = fixture.nativeElement as HTMLElement;
    const button = (label: string) =>
      [...el.querySelectorAll('button.promo-action')].find((b) => text(b) === label) as HTMLButtonElement;

    button('Запустить').click();
    expect(updateStatus).toHaveBeenCalledWith('draft', 'RUNNING');

    button('Завершить').click();
    fixture.detectChanges();
    expect(updateStatus).toHaveBeenCalledTimes(1);
    expect(el.querySelector('app-confirm-dialog')).not.toBeNull();
  });

  it('after a win-back code is saved, offers to send it to the inactive customers', async () => {
    const fixture = await render([], { created: 'COMEBACK123', inactiveDays: '7', storeId: 's1' });
    const banner = (fixture.nativeElement as HTMLElement).querySelector('.promo-created');
    expect(text(banner)).toContain('Промокод COMEBACK123 сохранён.');
    const link = new URL((banner?.querySelector('a') as HTMLAnchorElement).href);
    expect(link.pathname).toBe('/campaigns/new');
    expect(Object.fromEntries(link.searchParams)).toEqual({
      audience: 'INACTIVE',
      inactiveDays: '7',
      storeId: 's1',
      code: 'COMEBACK123',
    });
  });

  it('marks a code that only inactive customers can use', async () => {
    const fixture = await render([promo({ inactiveDays: 14 })]);
    expect(text((fixture.nativeElement as HTMLElement).querySelector('.promo-audience'))).toBe(
      'Для неактивных · 14+ дн.',
    );
  });
});
