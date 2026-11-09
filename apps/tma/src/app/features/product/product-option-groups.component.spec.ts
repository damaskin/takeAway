import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { defaultOptionPicks } from '@takeaway/utils';

import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';
import { COFFEE_GROUPS, MEAT_PORTIONS } from './option-groups.testing';
import { optionChoiceProblem, TmaProductOptionGroupsComponent } from './product-option-groups.component';

describe('TmaProductOptionGroupsComponent', () => {
  let fixture: ComponentFixture<TmaProductOptionGroupsComponent>;
  const haptic = jest.fn();

  beforeEach(async () => {
    haptic.mockClear();
    TestBed.configureTestingModule({
      imports: [TmaProductOptionGroupsComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: TelegramBridgeService, useValue: { haptic } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    fixture = TestBed.createComponent(TmaProductOptionGroupsComponent);
    const groups = [...COFFEE_GROUPS, MEAT_PORTIONS];
    fixture.componentRef.setInput('groups', groups);
    fixture.componentRef.setInput('currency', 'RUP');
    fixture.componentRef.setInput('picks', defaultOptionPicks(groups));
    await fixture.whenStable();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const picks = () => fixture.componentInstance.picks();
  const group = (name: string) =>
    Array.from(el().querySelectorAll<HTMLElement>('[data-testid="option-group"]')).find(
      (g) => g.getAttribute('aria-label') === name,
    );
  const row = (name: string) =>
    Array.from(el().querySelectorAll<HTMLElement>('[data-testid="option-row"]')).find(
      (r) => text(r.querySelector('.name')) === name,
    );
  const tap = async (name: string) => {
    row(name)?.querySelector<HTMLInputElement>('input')?.click();
    await fixture.whenStable();
  };
  const open = async (name: string) => {
    group(name)?.querySelector<HTMLButtonElement>('button.head')?.click();
    await fixture.whenStable();
  };

  it('asks for the variants first, the size marked «обязательно» until picked', async () => {
    expect(
      Array.from(el().querySelectorAll('[data-testid="option-group"]')).map((g) => g.getAttribute('aria-label')),
    ).toEqual([
      'Размер (кофе)',
      'Подача',
      'Без кофеина',
      'Молоко',
      'Сиропы',
      'Топинг-соус',
      'Добавки к кофе',
      'Мясо (порции)',
    ]);
    expect(text(group('Размер (кофе)')?.querySelector('.required'))).toBe('обязательно');

    await tap('M');
    expect(picks()['m']).toBe(1);
    expect(group('Размер (кофе)')?.querySelector('.required')).toBeNull();
    expect(haptic).toHaveBeenCalledWith('light');
  });

  it('refuses a third syrup', async () => {
    await open('Сиропы');
    await tap('Ваниль');
    await tap('Карамель');
    expect(row('Солёная карамель')?.querySelector('input')?.disabled).toBe(true);
    expect(Object.keys(picks())).toEqual(expect.arrayContaining(['vanilla', 'caramel']));
    expect(picks()['salted']).toBeUndefined();
  });

  it('greys out what ran out and keeps the meat counter within its bounds', async () => {
    await open('Молоко');
    expect(row('Кокосовое')?.querySelector('input')?.disabled).toBe(true);
    expect(text(row('Кокосовое'))).toContain('Нет в наличии');

    const more = row('Мясо / котлета')?.querySelector<HTMLButtonElement>('button[aria-label="Больше: Мясо / котлета"]');
    more?.click();
    await fixture.whenStable();
    expect(picks()['meat']).toBe(2);
    expect(more?.disabled).toBe(true);
  });

  it('shows ice only for an iced coffee', async () => {
    expect(group('Лёд')).toBeUndefined();
    await tap('Холодный');
    expect(group('Лёд')).toBeDefined();
    await tap('Горячий');
    expect(group('Лёд')).toBeUndefined();
  });

  it('names what is still to choose', () => {
    expect(optionChoiceProblem([...COFFEE_GROUPS, MEAT_PORTIONS], picks())).toEqual({
      key: 'common.product.choose',
      names: 'Размер (кофе)',
    });
  });
});
