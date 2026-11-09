import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { CatalogGroup, CatalogOption } from '@takeaway/shared-types';
import { of, throwError } from 'rxjs';

import { OptionCatalogApi } from '../../core/catalog/option-catalog.service';
import { OptionCatalogPage } from './option-catalog.page';

const M: CatalogOption = {
  id: 'opt-m',
  groupId: 'g-size',
  name: 'M',
  note: '300–350 мл',
  isDefault: true,
  minQty: null,
  maxQty: null,
  defaultQty: null,
  sortOrder: 0,
};
const SIZE: CatalogGroup = {
  id: 'g-size',
  kind: 'VARIANT',
  type: 'A',
  name: 'Размер (кофе)',
  minSelect: 1,
  maxSelect: 1,
  showIfOptionId: null,
  sortOrder: 0,
  productCount: 3,
  options: [M],
};
const SERVE: CatalogGroup = {
  ...SIZE,
  id: 'g-serve',
  name: 'Подача',
  sortOrder: 1,
  productCount: 0,
  options: [{ ...M, id: 'opt-cold', groupId: 'g-serve', name: 'Холодный', note: null, isDefault: false }],
};
const ICE: CatalogGroup = {
  id: 'g-ice',
  kind: 'ADDON',
  type: 'C',
  name: 'Лёд',
  minSelect: null,
  maxSelect: null,
  showIfOptionId: 'opt-cold',
  sortOrder: 2,
  productCount: 0,
  options: [
    {
      id: 'opt-ice',
      groupId: 'g-ice',
      name: 'Лёд',
      note: null,
      isDefault: false,
      minQty: 0,
      maxQty: 3,
      defaultQty: 0,
      sortOrder: 0,
    },
  ],
};

function setup(api: Partial<Record<keyof OptionCatalogApi, jest.Mock>> = {}) {
  const mocks = {
    listGroups: jest.fn().mockReturnValue(of([ICE, SERVE, SIZE])),
    createGroup: jest.fn((input: Partial<CatalogGroup>) => of({ ...SIZE, ...input, id: 'g-new', options: [] })),
    updateGroup: jest.fn().mockReturnValue(of(SIZE)),
    deleteGroup: jest.fn().mockReturnValue(of(undefined)),
    createOption: jest.fn().mockReturnValue(of(M)),
    updateOption: jest.fn().mockReturnValue(of(M)),
    deleteOption: jest.fn().mockReturnValue(of(undefined)),
    ...api,
  };
  TestBed.configureTestingModule({
    imports: [OptionCatalogPage],
    providers: [provideTranslateService(), { provide: OptionCatalogApi, useValue: mocks }],
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
  translate.use('ru');
  const fixture = TestBed.createComponent(OptionCatalogPage);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, page: fixture.componentInstance, mocks, el };
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('OptionCatalogPage («Каталог добавок»)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('lists variants, then add-ons, each group with its type, bounds, condition and products', () => {
    const { el } = setup();

    const groups = [...el.querySelectorAll('[data-testid="option-group"]')];
    expect(groups.map((g) => g.getAttribute('data-group'))).toEqual(['Размер (кофе)', 'Подача', 'Лёд']);
    expect(text(groups[0]?.querySelector('[data-testid="option-group-meta"]'))).toBe(
      'A · Выбор из списка · выбрать от 1 до 1 · в товарах: 3',
    );
    expect(text(groups[0])).toContain('по умолчанию');
    expect(text(groups[2]?.querySelector('[data-testid="option-group-meta"]'))).toBe(
      'C · Счётчик · только если выбрано: Холодный (Подача) · в товарах: 0',
    );
    expect(text(groups[2])).toContain('0–3, сначала 0');
  });

  it('creates a group at the end of the catalog and opens its first option', () => {
    const { page, mocks, fixture } = setup();

    page.createGroup({ kind: 'ADDON', type: 'B', name: 'Убрать', minSelect: null, maxSelect: null });
    fixture.detectChanges();

    expect(mocks.createGroup).toHaveBeenCalledWith({
      kind: 'ADDON',
      type: 'B',
      name: 'Убрать',
      minSelect: null,
      maxSelect: null,
      sortOrder: 3,
    });
    expect(mocks.listGroups).toHaveBeenCalledTimes(2);
    expect(page.addingOptionTo()).toBe('g-new');
  });

  it('moves a group by swapping its number with the one above', () => {
    const { page, mocks } = setup();

    page.moveGroup('VARIANT', 1, -1);

    expect(mocks.updateGroup).toHaveBeenCalledWith('g-serve', { sortOrder: 0 });
    expect(mocks.updateGroup).toHaveBeenCalledWith('g-size', { sortOrder: 1 });
  });

  it('warns before deleting a group on products and says why the API refused', () => {
    const refusal = new HttpErrorResponse({
      status: 409,
      error: { statusCode: 409, code: 'OPTION_GROUP_IN_USE', message: 'The group is attached to products' },
    });
    const { page, fixture, el } = setup({ deleteGroup: jest.fn().mockReturnValue(throwError(() => refusal)) });

    page.askDelete(SIZE, null);
    fixture.detectChanges();
    expect(text(el.querySelector('app-confirm-dialog'))).toContain('Группа подключена к товарам (3)');

    page.confirmDelete({ group: SIZE, option: null });
    fixture.detectChanges();
    expect(el.querySelector('app-confirm-dialog')).toBeNull();
    expect(text(el.querySelector('[data-testid="option-catalog-error"]'))).toBe(
      'Группа подключена к товарам — сначала её отключат в карточках этих товаров.',
    );
  });

  it('adds an option after the group’s last one and keeps the form open for the next', () => {
    const { page, mocks } = setup();
    page.startAddOption(SIZE);
    const before = page.addFormKey();

    page.createOption(SIZE, {
      name: 'L',
      note: '400–450 мл',
      isDefault: false,
      minQty: null,
      maxQty: null,
      defaultQty: null,
    });

    expect(mocks.createOption).toHaveBeenCalledWith('g-size', expect.objectContaining({ name: 'L', sortOrder: 1 }));
    expect(page.addingOptionTo()).toBe('g-size');
    expect(page.addFormKey()).toBe(before + 1);
  });
});
