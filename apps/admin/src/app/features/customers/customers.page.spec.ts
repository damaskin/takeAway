import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { PlanFeature } from '@takeaway/shared-types';
import { BehaviorSubject, of } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi } from '../../core/catalog/admin-catalog.service';
import { CustomersApi, type CustomerSummary } from '../../core/customers/customers.service';
import { PlanAccess } from '../../core/plans/plan-access.service';
import { CustomersPage } from './customers.page';

const customer: CustomerSummary = {
  userId: 'u1',
  name: 'Ира',
  phone: null,
  orders: 9,
  totalCents: 90_000,
  avgCheckCents: 10_000,
  firstOrderAt: '2026-08-01T09:00:00.000Z',
  lastOrderAt: '2026-09-20T09:00:00.000Z',
  avgDaysBetweenOrders: 6,
  daysSinceLastOrder: 20,
  favouriteStoreId: 's1',
  favouriteStoreName: 'Центр',
  favouriteProduct: { name: 'Латте', quantity: 12, kind: 'DRINK' },
};

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('CustomersPage', () => {
  let list: jest.Mock;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  async function render(params: Record<string, string> = {}, features: PlanFeature[] = ['customers', 'campaigns']) {
    list = jest.fn().mockReturnValue(of({ items: [customer], total: 1, page: 1, pageSize: 25 }));
    query = new BehaviorSubject(convertToParamMap(params));
    TestBed.configureTestingModule({
      imports: [CustomersPage],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: ActivatedRoute, useValue: { queryParamMap: query } },
        { provide: CustomersApi, useValue: { list } },
        {
          provide: AdminCatalogApi,
          useValue: {
            listStores: jest.fn().mockReturnValue(
              of([
                { id: 's1', name: 'Центр' },
                { id: 's2', name: 'Балка' },
              ]),
            ),
          },
        },
        {
          provide: ActiveBrandService,
          useValue: { activeId: signal('b1'), active: signal({ id: 'b1', currency: 'MDL' }) },
        },
        { provide: PlanAccess, useValue: { has: (f: PlanFeature) => features.includes(f) } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(CustomersPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('lists everyone by default', async () => {
    await render();
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ brandId: 'b1', segment: 'all', storeId: null }));
    expect(list.mock.lastCall?.[0].inactiveDays).toBeUndefined();
  });

  it('opens on the segment a link brought — the list the win-back tab counts', async () => {
    const fixture = await render({ segment: 'inactive', days: '7', storeId: 's1' });
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ brandId: 'b1', segment: 'inactive', inactiveDays: 7, storeId: 's1' }),
    );
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('.cu-segment-hint'))).toContain('не заказывали 7 дн.');
    const broadcast = new URL((el.querySelector('.cu-segment-hint a') as HTMLAnchorElement).href);
    expect(broadcast.pathname).toBe('/campaigns/new');
    expect(Object.fromEntries(broadcast.searchParams)).toEqual({
      audience: 'INACTIVE',
      inactiveDays: '7',
      storeId: 's1',
    });
  });

  it('keeps the segment in the address when one is picked', async () => {
    const fixture = await render();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const inactive = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.cu-segments button')].find(
      (b) => text(b) === 'Неактивные',
    ) as HTMLButtonElement;
    inactive.click();
    expect(navigate).toHaveBeenCalledWith([], {
      queryParams: { segment: 'inactive', days: 14, storeId: null },
      replaceUrl: true,
    });
  });

  it('marks the product a customer keeps ordering', async () => {
    const fixture = await render();
    const badge = (fixture.nativeElement as HTMLElement).querySelector('.cu-table .cu-fav');
    expect(text(badge)).toBe('Любимое: Латте');
    expect(badge?.getAttribute('data-kind')).toBe('DRINK');
  });
});
