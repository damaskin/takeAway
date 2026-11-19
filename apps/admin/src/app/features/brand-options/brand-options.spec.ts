import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { BrandOptionCatalog, CatalogGroup, CatalogOption } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { OptionCatalogApi } from '../../core/catalog/option-catalog.service';
import { BrandOptionCatalogComponent } from './brand-option-catalog.component';
import { BrandOptionsPage } from './brand-options.page';

function option(groupId: string, id: string, name: string, extra: Partial<CatalogOption> = {}): CatalogOption {
  return {
    id,
    groupId,
    name,
    note: null,
    isDefault: false,
    minQty: null,
    maxQty: null,
    defaultQty: null,
    sortOrder: 0,
    ...extra,
  };
}

const SIZE: CatalogGroup = {
  id: 'g-size',
  kind: 'VARIANT',
  type: 'A',
  name: 'Размер (кофе)',
  minSelect: 1,
  maxSelect: 1,
  showIfOptionId: null,
  scope: 'DRINKS',
  sortOrder: 0,
  options: [option('g-size', 'opt-m', 'M', { note: '300–350 мл' })],
};
const SYRUPS: CatalogGroup = {
  ...SIZE,
  id: 'g-syrup',
  kind: 'ADDON',
  name: 'Сиропы',
  scope: 'BOTH',
  minSelect: 0,
  maxSelect: 2,
  sortOrder: 1,
  options: [option('g-syrup', 'opt-vanilla', 'Ваниль'), option('g-syrup', 'opt-caramel', 'Карамель', { sortOrder: 1 })],
};
const MEAT: CatalogGroup = {
  ...SIZE,
  id: 'g-meat',
  kind: 'ADDON',
  type: 'C',
  name: 'Мясо (порции)',
  minSelect: null,
  maxSelect: null,
  scope: 'FOOD',
  sortOrder: 2,
  options: [option('g-meat', 'opt-meat', 'Мясо / котлета', { minQty: 1, maxQty: 2, defaultQty: 1 })],
};
const CATALOG: BrandOptionCatalog = {
  groups: [MEAT, SYRUPS, SIZE],
  settings: [
    { optionId: 'opt-vanilla', priceCents: 800, enabled: true, stoppedStoreIds: [] },
    { optionId: 'opt-caramel', priceCents: 0, enabled: false, stoppedStoreIds: [] },
  ],
  productPrices: [
    { optionId: 'opt-m', productId: 'p-flat', productName: 'Флэт уайт', priceCents: 0 },
    { optionId: 'opt-m', productId: 'p-latte', productName: 'Латте', priceCents: 1000 },
    { optionId: 'opt-vanilla', productId: 'p-raf', productName: 'Раф', priceCents: 500 },
  ],
};
const STORE: StoreAdminDto = {
  id: 's1',
  brandId: 'b1',
  slug: 'center',
  name: 'Центр',
  city: 'Tiraspol',
  country: 'MD',
  latitude: 46.84,
  longitude: 29.63,
  status: 'OPEN',
  currency: 'MDL',
  timezone: 'Europe/Chisinau',
};

function translations(): void {
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
  translate.use('ru');
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('BrandOptionCatalogComponent («Добавки» → «Каталог»)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function setup(role = 'BRAND_ADMIN') {
    const options = {
      brandCatalog: jest.fn().mockReturnValue(of(CATALOG)),
      updateBrandOption: jest.fn().mockReturnValue(of({})),
      applyGroupPrice: jest.fn().mockReturnValue(of([])),
      stopInStore: jest.fn((_store: string, _option: string, expiresAt: string | null) => of({ expiresAt })),
      resumeInStore: jest.fn().mockReturnValue(of(undefined)),
    };
    const catalog = { listStores: jest.fn().mockReturnValue(of([STORE])) };
    TestBed.configureTestingModule({
      imports: [BrandOptionCatalogComponent],
      providers: [
        provideTranslateService(),
        { provide: OptionCatalogApi, useValue: options },
        { provide: AdminCatalogApi, useValue: catalog },
        { provide: AuthStore, useValue: { user: signal({ role }) } },
      ],
    });
    translations();
    const fixture = TestBed.createComponent(BrandOptionCatalogComponent);
    fixture.componentRef.setInput('brandId', 'b1');
    fixture.componentRef.setInput('currency', 'MDL');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const open = () => {
      el.querySelectorAll('details').forEach((d) => (d.open = true));
      fixture.detectChanges();
    };
    return { fixture, cmp: fixture.componentInstance, options, catalog, el, open };
  }

  it('lists variants then add-ons; an add-on has a brand price, a variant shows its product prices read-only', () => {
    const { el, open } = setup();
    open();
    const groups = [...el.querySelectorAll('[data-testid="brand-option-group"]')];
    expect(groups.map((g) => text(g.querySelector('summary .name')))).toEqual([
      'Размер (кофе)',
      'Сиропы',
      'Мясо (порции)',
    ]);
    expect(text(groups[1]?.querySelector('summary'))).toContain('есть 1 из 2');
    expect(text(groups[0]?.querySelector('[data-testid="brand-option-product-prices"]'))).toMatch(
      /^В товарах: Флэт уайт — без доплаты, Латте \+10.+ · меняется в карточке товара$/,
    );
    expect(groups[0]?.querySelector('[data-testid="brand-option-price"]')).toBeNull();
    expect(text(groups[1]?.querySelector('[data-testid="brand-option-product-prices"]'))).toMatch(
      /^Своя цена в товарах: Раф 5/,
    );
    const prices = [...el.querySelectorAll<HTMLInputElement>('[data-testid="brand-option-price"]')];
    expect(prices.map((p) => p.value)).toEqual(['8', '', '']);
    expect(text(groups[2])).toContain('За штуку сверх 1, MDL');
  });

  it('switches an option off for the whole brand', () => {
    const { cmp, options } = setup();
    cmp.toggle(option('g-syrup', 'opt-vanilla', 'Ваниль'));
    expect(options.updateBrandOption).toHaveBeenCalledWith('b1', 'opt-vanilla', { enabled: false });
    expect(cmp.setting('opt-vanilla').enabled).toBe(false);
    expect(cmp.counts()).toEqual({ all: 4, on: 2, off: 2 });
  });

  it('saves a typed price once, and puts back one it cannot read', () => {
    const { cmp, options } = setup();
    const field = document.createElement('input');
    field.value = '12,50';
    cmp.savePrice(option('g-syrup', 'opt-caramel', 'Карамель'), { target: field } as unknown as Event);
    expect(options.updateBrandOption).toHaveBeenCalledWith('b1', 'opt-caramel', { priceCents: 1250 });

    field.value = 'дорого';
    cmp.savePrice(option('g-syrup', 'opt-vanilla', 'Ваниль'), { target: field } as unknown as Event);
    expect(field.value).toBe('8');
    expect(options.updateBrandOption).toHaveBeenCalledTimes(1);
  });

  it('stops an option in one store until the end of its day', () => {
    const { cmp, options } = setup();
    cmp.pickUntil('endOfDay');
    cmp.toggleStop(option('g-syrup', 'opt-vanilla', 'Ваниль'), STORE);
    expect(options.stopInStore).toHaveBeenCalledWith(
      's1',
      'opt-vanilla',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/),
    );
    expect(cmp.setting('opt-vanilla').stoppedStoreIds).toEqual(['s1']);
    expect(cmp.stopText('opt-vanilla', STORE, true)).toMatch(/^Центр: в стопе до \d{2}:\d{2}$/);

    cmp.toggleStop(option('g-syrup', 'opt-vanilla', 'Ваниль'), STORE);
    expect(options.resumeInStore).toHaveBeenCalledWith('s1', 'opt-vanilla');
    expect(cmp.setting('opt-vanilla').stoppedStoreIds).toEqual([]);
  });

  it('gives a menu editor no store stops', () => {
    const { el, open, catalog } = setup('MENU_EDITOR');
    open();
    expect(catalog.listStores).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="brand-option-stop"]')).toBeNull();
  });

  it('gives every option of an add-on group one price («Ко всем»)', () => {
    const { cmp, options } = setup();
    cmp.applyToGroup(SYRUPS, option('g-syrup', 'opt-vanilla', 'Ваниль'));
    expect(options.applyGroupPrice).toHaveBeenCalledWith('b1', 'g-syrup', 800);
    expect(cmp.setting('opt-caramel').priceCents).toBe(800);
    expect(cmp.setting('opt-caramel').enabled).toBe(false);
    expect(cmp.notice()).toContain('«Сиропы»');
  });

  // Maxim, 2026-11-18: a business that sells food never wades through the coffee groups.
  it('filters drinks or food, a group for both under each', () => {
    const { cmp } = setup();
    const ids = () => cmp.sections().flatMap((s) => s.groups.map((g) => g.group.id));
    cmp.scopeFilter.set('FOOD');
    expect(ids()).toEqual(['g-syrup', 'g-meat']);
    cmp.scopeFilter.set('DRINKS');
    expect(ids()).toEqual(['g-size', 'g-syrup']);
    cmp.scopeFilter.set('ALL');
    expect(ids()).toEqual(['g-size', 'g-syrup', 'g-meat']);
  });

  it('narrows to what the brand does not have, and finds by name', () => {
    const { cmp } = setup();
    cmp.filter.set('off');
    expect(cmp.sections().flatMap((s) => s.groups.flatMap((g) => g.options.map((o) => o.id)))).toEqual(['opt-caramel']);
    cmp.filter.set('all');
    cmp.query.set('ванил');
    expect(cmp.sections().flatMap((s) => s.groups.flatMap((g) => g.options.map((o) => o.id)))).toEqual(['opt-vanilla']);
    expect(cmp.isOpen('g-syrup')).toBe(true);
  });
});

describe('BrandOptionsPage («Добавки»)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('shows the catalog of the active brand, with no tab of older add-ins', () => {
    TestBed.configureTestingModule({
      imports: [BrandOptionsPage],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        { provide: OptionCatalogApi, useValue: { brandCatalog: jest.fn().mockReturnValue(of(CATALOG)) } },
        { provide: AdminCatalogApi, useValue: { listStores: jest.fn().mockReturnValue(of([])) } },
        { provide: AuthStore, useValue: { user: signal({ role: 'BRAND_ADMIN' }) } },
        {
          provide: ActiveBrandService,
          useValue: {
            active: signal({ id: 'b1', name: 'NoName Coffee', currency: 'MDL' }),
            activeId: signal('b1'),
            loaded: signal(true),
          },
        },
      ],
    });
    translations();
    const fixture = TestBed.createComponent(BrandOptionsPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-brand-option-catalog')).not.toBeNull();
    expect(el.querySelector('[role="tablist"]')).toBeNull();
    expect(text(el)).toContain('NoName Coffee');
  });
});
