import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { CatalogGroup, UpsertCatalogGroupRequest, UpsertCatalogOptionRequest } from '@takeaway/shared-types';

import { OptionGroupFormComponent } from './option-group-form.component';
import { OptionItemFormComponent } from './option-item-form.component';

const SERVE: CatalogGroup = {
  id: 'g-serve',
  kind: 'VARIANT',
  type: 'A',
  name: 'Подача',
  minSelect: 1,
  maxSelect: 1,
  showIfOptionId: null,
  sortOrder: 0,
  options: [
    {
      id: 'opt-cold',
      groupId: 'g-serve',
      name: 'Холодный',
      note: null,
      isDefault: false,
      minQty: null,
      maxQty: null,
      defaultQty: null,
      sortOrder: 0,
    },
  ],
};
const SUGAR: CatalogGroup = { ...SERVE, id: 'g-sugar', kind: 'ADDON', type: 'C', name: 'Сахар', options: [] };

function translations(): void {
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
  translate.use('ru');
}

describe('OptionGroupFormComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function render(group: CatalogGroup | null = null) {
    TestBed.configureTestingModule({ imports: [OptionGroupFormComponent], providers: [provideTranslateService()] });
    translations();
    const fixture = TestBed.createComponent(OptionGroupFormComponent);
    fixture.componentRef.setInput('group', group);
    fixture.componentRef.setInput('groups', [SERVE, SUGAR]);
    fixture.detectChanges();
    const sent: UpsertCatalogGroupRequest[] = [];
    fixture.componentInstance.submitted.subscribe((r) => sent.push(r));
    return { fixture, form: fixture.componentInstance, sent };
  }

  it('sends an add-on list with its bounds and condition', () => {
    const { form, sent } = render();
    form.form.patchValue({ name: ' Пенка-топ ', minSelect: '0', maxSelect: '1', showIfOptionId: 'opt-cold' });
    form.submit();
    expect(sent).toEqual([
      { kind: 'ADDON', type: 'A', name: 'Пенка-топ', minSelect: 0, maxSelect: 1, showIfOptionId: 'opt-cold' },
    ]);
  });

  it('starts a variant list at one pick and never lets a variant be a counter', () => {
    const { form, sent } = render();
    form.form.controls.type.setValue('C');
    form.form.controls.kind.setValue('VARIANT');
    expect(form.form.controls.type.value).toBe('A');
    expect(form.form.controls.minSelect.value).toBe('1');
    form.form.patchValue({ name: 'Основа' });
    form.submit();
    expect(sent[0]).toMatchObject({ kind: 'VARIANT', type: 'A', minSelect: 1, maxSelect: 1, showIfOptionId: null });
  });

  it('refuses bounds the API would refuse', () => {
    const { form, sent, fixture } = render();
    form.form.patchValue({ name: 'Сиропы', minSelect: '3', maxSelect: '2' });
    form.submit();
    fixture.detectChanges();
    expect(sent).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Минимум и максимум — целые числа');
  });

  it('sends no bounds for a yes/no group and does not offer its own options as the condition', () => {
    const { form, sent } = render(SERVE);
    expect(form.conditionGroups().map((g) => g.id)).toEqual([]);
    form.form.patchValue({ kind: 'ADDON', type: 'B' });
    form.submit();
    expect(sent[0]).toMatchObject({ type: 'B', minSelect: null, maxSelect: null, name: 'Подача' });
  });
});

describe('OptionItemFormComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function render(group: CatalogGroup) {
    TestBed.configureTestingModule({ imports: [OptionItemFormComponent], providers: [provideTranslateService()] });
    translations();
    const fixture = TestBed.createComponent(OptionItemFormComponent);
    fixture.componentRef.setInput('group', group);
    fixture.detectChanges();
    const sent: UpsertCatalogOptionRequest[] = [];
    fixture.componentInstance.submitted.subscribe((r) => sent.push(r));
    return { form: fixture.componentInstance, sent };
  }

  it('sends a list option with its note and default, and no counter', () => {
    const { form, sent } = render(SERVE);
    form.form.patchValue({ name: 'M', note: '300–350 мл', isDefault: true });
    form.submit();
    expect(sent).toEqual([
      { name: 'M', note: '300–350 мл', isDefault: true, minQty: null, maxQty: null, defaultQty: null },
    ]);
  });

  it('sends a counter with its bounds and refuses a start outside them', () => {
    const { form, sent } = render(SUGAR);
    form.form.patchValue({ name: 'Сахар', minQty: '0', maxQty: '3', defaultQty: '4' });
    form.submit();
    expect(sent).toEqual([]);
    form.form.patchValue({ defaultQty: '' });
    form.submit();
    expect(sent).toEqual([{ name: 'Сахар', note: null, isDefault: false, minQty: 0, maxQty: 3, defaultQty: null }]);
  });
});
