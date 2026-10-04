import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { of } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type StoreAvailabilityDto } from '../../core/catalog/admin-catalog.service';
import { StopListPage } from './stop-list.page';

const VIEW: StoreAvailabilityDto = {
  storeId: 's1',
  storeName: 'Бургерная',
  timezone: 'Europe/Chisinau',
  products: [
    { id: 'p-burger', name: 'Чизбургер', categoryId: 'c1', categoryName: 'Бургеры', imageUrl: null, stop: null },
    {
      id: 'p-fries',
      name: 'Картофель фри',
      categoryId: 'c1',
      categoryName: 'Бургеры',
      imageUrl: null,
      stop: { expiresAt: null },
    },
  ],
  ingredients: [
    { id: 'ing-cheddar', name: 'Чеддер', isAvailable: true, stop: null, productNames: ['Чизбургер'] },
    { id: 'ing-oat', name: 'Овсяное молоко', isAvailable: false, stop: null, productNames: ['Латте'] },
  ],
};

/** The n-th row, or a clear failure instead of a non-null assertion. */
function at<T>(rows: readonly T[], index: number): T {
  const row = rows[index];
  if (row === undefined) throw new Error(`no row ${index}`);
  return row;
}

function setup(api: Partial<Record<keyof AdminCatalogApi, jest.Mock>> = {}) {
  const mocks = {
    listStores: jest.fn().mockReturnValue(
      of([
        { id: 's1', name: 'Бургерная', timezone: 'Europe/Chisinau' },
        { id: 's2', name: 'Пиццерия', timezone: 'Europe/Chisinau' },
      ]),
    ),
    getStoreAvailability: jest.fn().mockReturnValue(of(VIEW)),
    addStopListEntry: jest.fn((_store: string, input: { expiresAt?: string }) =>
      of({ expiresAt: input.expiresAt ?? null }),
    ),
    removeStopListEntry: jest.fn().mockReturnValue(of(undefined)),
    stopIngredientInStore: jest.fn().mockReturnValue(of({ expiresAt: null })),
    resumeIngredientInStore: jest.fn().mockReturnValue(of(undefined)),
    ...api,
  };
  TestBed.configureTestingModule({
    imports: [StopListPage],
    providers: [
      provideTranslateService(),
      provideRouter([]),
      { provide: AdminCatalogApi, useValue: mocks },
      {
        provide: ActiveBrandService,
        useValue: { loaded: () => true, refresh: jest.fn(), activeId: signal('b1') },
      },
    ],
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
  translate.use('ru');
  const fixture = TestBed.createComponent(StopListPage);
  fixture.detectChanges();
  return { fixture, page: fixture.componentInstance, mocks };
}

describe('StopListPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it("opens on one of the account's stores and shows what it sells", () => {
    const { fixture, mocks } = setup();

    expect(mocks.listStores).toHaveBeenCalledWith('b1');
    expect(mocks.getStoreAvailability).toHaveBeenCalledWith('s1');
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Чизбургер');
    expect(text).toContain('В стопе');
  });

  it('puts a dish in the stop until the end of the day in the store zone', () => {
    const { page, mocks } = setup();
    page.pickUntil('endOfDay');

    const burger = page.productRows().find((r) => r.id === 'p-burger');
    if (!burger) throw new Error('no burger row');
    page.toggle(burger);

    expect(mocks.addStopListEntry).toHaveBeenCalledWith('s1', {
      productId: 'p-burger',
      expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/),
    });
    expect(page.stopped(at(page.productRows(), 0))).toBe(true);
  });

  it('takes a dish back out of the stop', () => {
    const { page, mocks } = setup();

    page.toggle(at(page.productRows(), 1));

    expect(mocks.removeStopListEntry).toHaveBeenCalledWith('s1', 'p-fries');
    expect(page.stopped(at(page.productRows(), 1))).toBe(false);
  });

  it('stops an add-in in this store only', () => {
    const { page, mocks } = setup();
    page.tab.set('addons');

    page.toggle(at(page.addonRows(), 0));

    expect(mocks.stopIngredientInStore).toHaveBeenCalledWith('s1', 'ing-cheddar', undefined);
    expect(page.stopped(at(page.addonRows(), 0))).toBe(true);
  });

  it('marks an add-in switched off brand-wide and offers no switch for it', () => {
    const { fixture, page } = setup();
    page.tab.set('addons');
    fixture.detectChanges();

    const toggles = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '[data-testid="stop-toggle"]',
    );
    expect(toggles[1]?.disabled).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Выключено во всём бренде');
  });

  it('filters by name and by what is stopped', () => {
    const { page } = setup();

    page.onlyStopped.set(true);
    expect(page.shown().map((r) => r.id)).toEqual(['p-fries']);

    page.onlyStopped.set(false);
    page.query.set('чиз');
    expect(page.shown().map((r) => r.id)).toEqual(['p-burger']);
  });
});
