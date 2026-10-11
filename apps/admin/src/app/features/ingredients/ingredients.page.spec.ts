import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { of } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type IngredientDto } from '../../core/catalog/admin-catalog.service';
import { IngredientsPage } from './ingredients.page';

const VANILLA: IngredientDto = {
  id: 'ing-vanilla',
  brandId: 'b1',
  name: 'Ванильный сироп',
  priceCents: 500,
  isAvailable: true,
  products: [
    { id: 'p-cap', name: 'Капучино' },
    { id: 'p-latte', name: 'Латте' },
  ],
};
const CINNAMON: IngredientDto = {
  id: 'ing-cinnamon',
  brandId: 'b1',
  name: 'Корица',
  priceCents: 0,
  isAvailable: true,
  products: [],
};

function setup(api: Partial<Record<keyof AdminCatalogApi, jest.Mock>> = {}) {
  const mocks = {
    listIngredients: jest.fn().mockReturnValue(of([VANILLA, CINNAMON])),
    createIngredient: jest.fn((input: { name: string; priceCents: number }) =>
      of({ ...CINNAMON, id: 'ing-new', ...input }),
    ),
    updateIngredient: jest.fn((id: string, input: Partial<IngredientDto>) => of({ ...VANILLA, id, ...input })),
    deleteIngredient: jest.fn().mockReturnValue(of(undefined)),
    ...api,
  };
  TestBed.configureTestingModule({
    imports: [IngredientsPage],
    providers: [
      provideTranslateService(),
      provideRouter([]),
      { provide: AdminCatalogApi, useValue: mocks },
      {
        provide: ActiveBrandService,
        useValue: { active: signal({ id: 'b1', name: 'NoName Coffee', currency: 'RUP' }) },
      },
    ],
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
  translate.use('ru');
  const fixture = TestBed.createComponent(IngredientsPage);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, page: fixture.componentInstance, mocks, el };
}

function type(input: HTMLInputElement | null, value: string): void {
  if (!input) throw new Error('no input');
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('IngredientsPage («Добавки»)', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => jest.restoreAllMocks());

  // The bug from the manager: the add form was a bare `<form (ngSubmit)>`
  // that never fired, so "Add" reloaded the page and nothing was added.
  it('adds an add-on with its price when the form is submitted', () => {
    const { fixture, mocks, el } = setup();
    const form = el.querySelector<HTMLFormElement>('[data-testid="ingredient-add"]');
    type(form?.querySelector('input[formcontrolname="name"]') ?? null, 'Шот эспрессо');
    type(form?.querySelector('input[formcontrolname="price"]') ?? null, '10');

    const submit = new Event('submit', { cancelable: true });
    form?.dispatchEvent(submit);
    fixture.detectChanges();

    expect(submit.defaultPrevented).toBe(true);
    expect(mocks.createIngredient).toHaveBeenCalledWith({ brandId: 'b1', name: 'Шот эспрессо', priceCents: 1000 });
    expect(el.textContent).toContain('Шот эспрессо');
  });

  it('adds a free add-on when the price is left empty, and refuses a price it cannot read', () => {
    const { page, mocks } = setup();

    page.addForm.setValue({ name: 'Корица молотая', price: 'пять', group: '' });
    page.add();
    expect(mocks.createIngredient).not.toHaveBeenCalled();

    page.addForm.setValue({ name: 'Корица молотая', price: '', group: '' });
    page.add();
    expect(mocks.createIngredient).toHaveBeenCalledWith({ brandId: 'b1', name: 'Корица молотая', priceCents: 0 });
  });

  it('shows each add-on with its price and the products that offer it', () => {
    const { el } = setup();

    const rows = [...el.querySelectorAll('[data-testid="ingredient-row"]')].map((r) => r.textContent ?? '');
    expect(rows[0]).toContain('Ванильный сироп');
    // The Transnistrian rouble is «руб.» in Russian.
    expect(rows[0]).toContain('+5\u00a0руб.');
    expect(rows[0]).toContain('В товарах (2): Капучино, Латте');
    expect(rows[1]).toContain('без доплаты');
    expect(rows[1]).toContain('Пока ни в одном товаре');
  });

  it('lists only the add-ons no product uses under «Не используются»', () => {
    const { fixture, el } = setup();

    el.querySelector<HTMLButtonElement>('[data-testid="ingredient-filter-unused"]')?.click();
    fixture.detectChanges();

    const rows = [...el.querySelectorAll('[data-testid="ingredient-row"]')].map((r) => r.textContent ?? '');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('Корица');
  });

  it('edits name and price in place, sending only what changed', () => {
    const { page, mocks } = setup();

    page.startEdit(VANILLA);
    expect(page.editForm.getRawValue()).toEqual({ name: 'Ванильный сироп', price: '5', group: '' });
    page.editForm.controls.price.setValue('7,50');
    page.saveEdit(VANILLA);

    expect(mocks.updateIngredient).toHaveBeenCalledWith('ing-vanilla', { priceCents: 750 });
    expect(page.editingId()).toBeNull();
  });

  it('asks before deleting an add-on products use, naming them, then takes it off the list', () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, page, mocks, el } = setup();

    page.remove(VANILLA);
    fixture.detectChanges();

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('пропадёт из всех товаров, где есть (2): Капучино, Латте'),
    );
    expect(mocks.deleteIngredient).toHaveBeenCalledWith('ing-vanilla');
    expect(el.textContent).not.toContain('Ванильный сироп');
  });

  // «Ваниль» picked for a latte lands under «Сиропы» on the customer's screen.
  it('files an add-on under a group, and sends a new group only when it changed', () => {
    const { page, mocks } = setup();

    page.addForm.setValue({ name: 'Карамель', price: '5', group: ' Сиропы ' });
    page.add();
    expect(mocks.createIngredient).toHaveBeenCalledWith({
      brandId: 'b1',
      name: 'Карамель',
      priceCents: 500,
      group: 'Сиропы',
    });
    // The group stays for the next syrup.
    expect(page.addForm.controls.group.value).toBe(' Сиропы ');

    page.startEdit(VANILLA);
    page.editForm.controls.group.setValue('Сиропы');
    page.saveEdit(VANILLA);
    expect(mocks.updateIngredient).toHaveBeenLastCalledWith('ing-vanilla', { group: 'Сиропы' });

    page.startEdit({ ...VANILLA, group: 'Сиропы' });
    page.editForm.controls.group.setValue('');
    page.saveEdit({ ...VANILLA, group: 'Сиропы' });
    expect(mocks.updateIngredient).toHaveBeenLastCalledWith('ing-vanilla', { group: null });
  });

  it('deletes nothing when the question is declined', () => {
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    const { page, mocks } = setup();

    page.remove(VANILLA);

    expect(mocks.deleteIngredient).not.toHaveBeenCalled();
  });
});
