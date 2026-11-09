import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { LegacyOptionsSummary } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { OptionCatalogApi } from '../../core/catalog/option-catalog.service';
import { LegacyOptionsComponent } from './legacy-options.component';

const SOME: LegacyOptionsSummary = { products: 4, variations: 6, modifiers: 9, categoryOptions: 2, ingredients: 5 };
const NONE: LegacyOptionsSummary = { products: 0, variations: 0, modifiers: 0, categoryOptions: 0, ingredients: 0 };

function setup(summaries: LegacyOptionsSummary[]) {
  const api = {
    legacySummary: jest.fn(),
    clearLegacy: jest.fn().mockReturnValue(of(SOME)),
  };
  for (const s of summaries) api.legacySummary.mockReturnValueOnce(of(s));
  TestBed.configureTestingModule({
    imports: [LegacyOptionsComponent],
    providers: [provideTranslateService(), { provide: OptionCatalogApi, useValue: api }],
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
  translate.use('ru');
  const fixture = TestBed.createComponent(LegacyOptionsComponent);
  fixture.componentRef.setInput('brandId', 'b1');
  fixture.componentRef.setInput('brandName', 'NoName Coffee');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const byTestId = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const click = (id: string) => {
    byTestId(id)?.click();
    fixture.detectChanges();
  };
  return { fixture, api, byTestId, click };
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('LegacyOptionsComponent («Старые опции бренда»)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('loads the counts only when opened', () => {
    const { api, click, byTestId } = setup([SOME]);
    expect(api.legacySummary).not.toHaveBeenCalled();
    click('legacy-options-toggle');
    expect(api.legacySummary).toHaveBeenCalledWith('b1');
    expect(text(byTestId('legacy-options-counts'))).toBe(
      'Товаров со старыми опциями: 4 · вариаций: 6 · добавок товаров: 9 · опций категорий: 2 · добавок справочника: 5',
    );
  });

  it('deletes only after the brand name is typed, then shows what went', () => {
    const { api, fixture, click, byTestId } = setup([SOME, NONE]);
    click('legacy-options-toggle');
    click('legacy-options-clear');

    const confirm = byTestId('legacy-options-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const name = byTestId('legacy-options-name') as HTMLInputElement;
    name.value = 'NoName';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(confirm.disabled).toBe(true);
    name.value = '  noname coffee ';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(confirm.disabled).toBe(false);

    click('legacy-options-confirm');
    expect(api.clearLegacy).toHaveBeenCalledWith('b1');
    expect(text(byTestId('legacy-options-cleared'))).toBe(
      'Удалено: вариаций 6, добавок товаров 9, опций категорий 2, добавок справочника 5.',
    );
    expect(text(byTestId('legacy-options-none'))).toBe('Старых опций нет.');
  });
});
