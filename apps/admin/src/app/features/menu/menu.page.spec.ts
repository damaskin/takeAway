import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { of } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type CategoryAdminDto, type ProductAdminDto } from '../../core/catalog/admin-catalog.service';
import { OnboardingFlowService } from '../../core/onboarding/onboarding-flow.service';
import { MenuPage } from './menu.page';

function product(id: string, name: string, imageUrls: string[]): ProductAdminDto {
  return {
    id,
    brandId: 'b1',
    categoryId: 'bakery',
    slug: id,
    name,
    description: null,
    basePriceCents: 2500,
    prepTimeSeconds: 60,
    visible: true,
    sortOrder: 0,
    imageUrls,
    caffeineLevel: null,
    calories: null,
    proteinsGrams: null,
    fatsGrams: null,
    carbsGrams: null,
    allergens: [],
    dietTags: [],
    storeIds: ['s1'],
  };
}

const CATEGORIES: CategoryAdminDto[] = [
  {
    id: 'bakery',
    brandId: 'b1',
    slug: 'bakery',
    name: 'Выпечка',
    description: null,
    sortOrder: 0,
    visible: true,
    kind: 'BAKERY',
    _count: { products: 2 },
    productsWithoutPhoto: 1,
  },
  {
    id: 'extras',
    brandId: 'b1',
    slug: 'extras',
    name: 'Дополнительные ингредиенты',
    description: null,
    sortOrder: 1,
    visible: true,
    addOnsOnly: true,
    _count: { products: 4 },
    productsWithoutPhoto: 4,
  },
];

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('MenuPage — products without a photo', () => {
  async function render() {
    TestBed.configureTestingModule({
      imports: [MenuPage],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        {
          provide: AdminCatalogApi,
          useValue: {
            listCategories: () => of(CATEGORIES),
            listProducts: () =>
              of([product('croissant', 'Круассан', ['https://cdn/croissant.jpg']), product('bagel', 'Бублик', [])]),
            listStores: () => of([]),
            listProductStores: () => of([]),
            listStopList: () => of([]),
          },
        },
        { provide: AuthStore, useValue: { user: signal({ role: 'BRAND_ADMIN' }) } },
        {
          provide: ActiveBrandService,
          useValue: {
            active: signal({ id: 'b1', slug: 'b1', name: 'Ромашка', currency: 'MDL', locale: 'RU', logoUrl: null }),
            loaded: signal(true),
            loadError: signal(null),
            isEmpty: signal(false),
            loading: signal(false),
            refresh: jest.fn(),
          },
        },
        {
          provide: OnboardingFlowService,
          useValue: { refreshProgress: jest.fn(), progress: signal(null), forOwner: signal(false), hint: signal(null) },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(MenuPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('counts them across the menu, leaving out add-ons that are never shown as products', async () => {
    const el = (await render()).nativeElement as HTMLElement;

    expect(text(el.querySelector('[data-testid="menu-no-photo-summary"]'))).toContain('Товаров без фото в меню: 1.');
    expect([...el.querySelectorAll('[data-testid="category-no-photo"]')].map(text)).toEqual(['без фото: 1']);
  });

  it('marks the row of a product without a photo', async () => {
    const el = (await render()).nativeElement as HTMLElement;

    const rows = [...el.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.querySelector('[data-testid="product-no-photo"]') !== null)).toEqual([false, true]);
  });

  it('shows only them on request, with reordering off while filtered', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;

    (el.querySelector('[data-testid="menu-no-photo-filter"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const rows = [...el.querySelectorAll('tbody tr')];
    expect(rows.map((r) => text(r.querySelector('.col-name')))).toEqual([expect.stringMatching(/^Бублик без фото/)]);
    expect([...rows[0].querySelectorAll<HTMLButtonElement>('button.arrow')].every((b) => b.disabled)).toBe(true);
  });
});
