import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { ProductOptionGroup } from '@takeaway/shared-types';
import { defaultOptionPicks } from '@takeaway/utils';

import { COFFEE_GROUPS, MEAT_PORTIONS } from './option-groups.testing';
import { optionChoiceProblem, ProductOptionGroupsComponent } from './product-option-groups.component';

describe('ProductOptionGroupsComponent', () => {
  let fixture: ComponentFixture<ProductOptionGroupsComponent>;

  async function render(groups: ProductOptionGroup[], picks = defaultOptionPicks(groups)) {
    TestBed.configureTestingModule({
      imports: [ProductOptionGroupsComponent],
      providers: [provideTranslateService({ fallbackLang: 'ru' })],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    fixture = TestBed.createComponent(ProductOptionGroupsComponent);
    fixture.componentRef.setInput('groups', groups);
    fixture.componentRef.setInput('currency', 'RUP');
    fixture.componentRef.setInput('picks', picks);
    await fixture.whenStable();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  /** What a row or a heading reads: its pieces of text in order, spaced as the layout spaces them. */
  const reads = (node: Element | null | undefined, separator = ' ') =>
    Array.from(node?.querySelectorAll('*') ?? [])
      .filter((child) => child.children.length === 0)
      .map(text)
      .filter(Boolean)
      .join(separator);
  const picks = () => fixture.componentInstance.picks();
  const group = (name: string) =>
    Array.from(el().querySelectorAll<HTMLElement>('[data-testid="option-group"]')).find(
      (g) => g.getAttribute('aria-label') === name,
    );
  const head = (name: string) => group(name)?.querySelector<HTMLButtonElement>('button.head');
  const row = (name: string) =>
    Array.from(el().querySelectorAll<HTMLElement>('[data-testid="option-row"]')).find((r) =>
      text(r.querySelector('.name')).startsWith(name),
    );
  const input = (name: string) => row(name)?.querySelector<HTMLInputElement>('input');
  const tap = async (name: string) => {
    input(name)?.click();
    await fixture.whenStable();
  };
  const open = async (name: string) => {
    head(name)?.click();
    await fixture.whenStable();
  };

  it('asks for the variants first, each a list with its note and what it changes in the price', async () => {
    await render(COFFEE_GROUPS);

    expect(
      Array.from(el().querySelectorAll('[data-testid="option-group"]')).map((g) => g.getAttribute('aria-label')),
    ).toEqual(['Размер (кофе)', 'Подача', 'Без кофеина', 'Молоко', 'Сиропы', 'Топинг-соус', 'Добавки к кофе']);
    expect(group('Размер (кофе)')?.getAttribute('role')).toBe('radiogroup');
    expect(reads(row('S'))).toMatch(/^S 150–250 мл −5\s?руб\.$/);
    expect(reads(row('M'))).toBe('M 300–350 мл');
    expect(reads(row('L'))).toMatch(/^L 400–450 мл \+7\s?руб\.$/);
  });

  it('marks a group still waiting for a pick «обязательно» until it has one', async () => {
    await render(COFFEE_GROUPS);
    expect(text(group('Размер (кофе)')?.querySelector('.required'))).toBe('обязательно');
    expect(group('Подача')?.querySelector('.required')).toBeNull();

    await tap('M');
    expect(picks()).toEqual({ m: 1, hot: 1, cow: 1 });
    expect(group('Размер (кофе)')?.querySelector('.required')).toBeNull();
  });

  it('moves the pick of a one-of list, and keeps a required one from being emptied', async () => {
    await render(COFFEE_GROUPS);
    await tap('M');
    await tap('L');
    expect(picks()['l']).toBe(1);
    expect(picks()['m']).toBeUndefined();

    await tap('L');
    expect(picks()['l']).toBe(1);
    expect(input('L')?.checked).toBe(true);
  });

  it('clears an optional one-of pick on a second tap', async () => {
    await render(COFFEE_GROUPS);
    await open('Топинг-соус');
    await tap('Карамельный');
    expect(picks()['caramel-sauce']).toBe(1);

    await tap('Карамельный');
    expect(picks()['caramel-sauce']).toBeUndefined();
    expect(input('Карамельный')?.checked).toBe(false);
  });

  it('folds an add-on group into one row with what is picked, opening in place', async () => {
    await render(COFFEE_GROUPS);
    expect(reads(head('Молоко'))).toBe('Молоко · Коровье');
    expect(head('Молоко')?.getAttribute('aria-expanded')).toBe('false');
    expect(row('Овсяное')).toBeUndefined();

    await open('Молоко');
    expect(head('Молоко')?.getAttribute('aria-expanded')).toBe('true');
    await tap('Овсяное');
    expect(picks()['oat']).toBe(1);
    expect(picks()['cow']).toBeUndefined();
    expect(reads(head('Молоко'))).toBe('Молоко · Овсяное');
  });

  it('says «до 2» over the syrups and refuses a third', async () => {
    await render(COFFEE_GROUPS);
    expect(reads(head('Сиропы'))).toBe('Сиропы до 2 · не выбрано');

    await open('Сиропы');
    await tap('Ваниль');
    await tap('Карамель');
    expect(input('Солёная карамель')?.disabled).toBe(true);
    await tap('Солёная карамель');
    expect(picks()['salted']).toBeUndefined();
    expect(reads(head('Сиропы'))).toBe('Сиропы до 2 · Ваниль, Карамель');

    await tap('Карамель');
    expect(input('Солёная карамель')?.disabled).toBe(false);
  });

  it('greys out an option the store has run out of, «Нет в наличии», and will not pick it', async () => {
    await render(COFFEE_GROUPS);
    await open('Молоко');
    expect(row('Кокосовое')?.classList).toContain('off');
    expect(reads(row('Кокосовое'))).toBe('Кокосовое Нет в наличии');
    expect(input('Кокосовое')?.disabled).toBe(true);
  });

  it('turns add-ons on and off with a switch, a single one on its own row', async () => {
    await render(COFFEE_GROUPS);
    expect(row('Без кофеина')?.querySelector('input[role="switch"]')).not.toBeNull();
    expect(group('Без кофеина')?.querySelector('.head')).toBeNull();

    await open('Добавки к кофе');
    expect(reads(row('Корица'))).toMatch(/^Корица \+3\s?руб\.$/);
    await tap('Корица');
    expect(picks()['cinnamon']).toBe(1);
    await tap('Корица');
    expect(picks()['cinnamon']).toBeUndefined();
  });

  it('counts within the bounds, saying what the price includes and what one more costs', async () => {
    await render([MEAT_PORTIONS]);
    const less = () =>
      row('Мясо / котлета')?.querySelector<HTMLButtonElement>('button[aria-label="Меньше: Мясо / котлета"]');
    const more = () =>
      row('Мясо / котлета')?.querySelector<HTMLButtonElement>('button[aria-label="Больше: Мясо / котлета"]');

    expect(reads(row('Мясо / котлета')?.querySelector('.meta'), ' · ')).toMatch(/^1 входит · \+15\s?руб\. за шт\.$/);
    expect(picks()).toEqual({ meat: 1 });
    expect(less()?.disabled).toBe(true);

    more()?.click();
    await fixture.whenStable();
    expect(picks()).toEqual({ meat: 2 });
    expect(more()?.disabled).toBe(true);
  });

  it('shows ice only while the coffee is iced, and drops it with the condition', async () => {
    await render(COFFEE_GROUPS);
    expect(group('Лёд')).toBeUndefined();

    await tap('Холодный');
    expect(group('Лёд')).toBeDefined();
    row('Лёд')?.querySelector<HTMLButtonElement>('button[aria-label="Больше: Лёд"]')?.click();
    await fixture.whenStable();
    expect(picks()['ice-qty']).toBe(1);

    await tap('Горячий');
    expect(group('Лёд')).toBeUndefined();
    expect(picks()['ice-qty']).toBeUndefined();
  });
});

describe('optionChoiceProblem', () => {
  it('names the groups still waiting for a pick', () => {
    expect(optionChoiceProblem(COFFEE_GROUPS, defaultOptionPicks(COFFEE_GROUPS))).toEqual({
      key: 'common.product.choose',
      names: 'Размер (кофе)',
    });
  });

  it('names a pick the store has run out of', () => {
    expect(optionChoiceProblem(COFFEE_GROUPS, { m: 1, hot: 1, coconut: 1 })).toEqual({
      key: 'common.product.soldOutPicked',
      names: 'Кокосовое',
    });
  });

  it('has nothing to say about a choice that can go in the cart', () => {
    expect(optionChoiceProblem(COFFEE_GROUPS, { m: 1, hot: 1, cow: 1 })).toBeNull();
  });
});
