import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { Modifier, Variation } from '@takeaway/shared-types';

import { ProductOptionsComponent } from './product-options.component';

function variation(over: Partial<Variation> & Pick<Variation, 'id' | 'type' | 'name'>): Variation {
  return { priceDeltaCents: 0, prepTimeDeltaSeconds: 0, sortOrder: 0, isDefault: false, ...over };
}

function modifier(over: Partial<Modifier> & Pick<Modifier, 'id' | 'name'>): Modifier {
  return {
    slug: over.id,
    priceDeltaCents: 0,
    prepTimeDeltaSeconds: 0,
    minCount: 0,
    maxCount: 1,
    sortOrder: 0,
    ...over,
  };
}

describe('ProductOptionsComponent', () => {
  let fixture: ComponentFixture<ProductOptionsComponent>;

  const variations = [
    variation({ id: 'oat', type: 'MILK', name: 'Овсяное', priceDeltaCents: 300 }),
    variation({ id: 'm', type: 'SIZE', name: 'M', isDefault: true }),
    variation({ id: 'l', type: 'SIZE', name: 'L', priceDeltaCents: 500, sortOrder: 1 }),
  ];
  const modifiers = [
    modifier({ id: 'vanilla', name: 'Ваниль', group: 'Сиропы', priceDeltaCents: 300, maxCount: 3 }),
    modifier({ id: 'caramel', name: 'Карамель', group: 'Сиропы', priceDeltaCents: 300, maxCount: 3, sortOrder: 1 }),
    modifier({ id: 'lid', name: 'Крышка', sortOrder: 2 }),
    modifier({ id: 'cup', name: 'Свой стакан', group: 'Стакан', minCount: 1, sortOrder: 3 }),
  ];

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ProductOptionsComponent],
      providers: [provideTranslateService({ fallbackLang: 'ru' })],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    fixture = TestBed.createComponent(ProductOptionsComponent);
    fixture.componentRef.setInput('variations', variations);
    fixture.componentRef.setInput('modifiers', modifiers);
    fixture.componentRef.setInput('currency', 'RUP');
    fixture.componentRef.setInput('selection', { SIZE: 'm', MILK: 'oat' });
    fixture.componentRef.setInput('counts', { vanilla: 0, caramel: 0, lid: 0, cup: 1 });
    await fixture.whenStable();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const heads = () => Array.from(el().querySelectorAll<HTMLButtonElement>('button.head'));
  const head = (name: string) => heads().find((h) => text(h).startsWith(name));
  /** A group's row as read: its parts, spaced apart as the layout spaces them. */
  const row = (h: Element | undefined) =>
    Array.from(h?.querySelectorAll('span') ?? [])
      .map(text)
      .join(' ');

  it('asks for the size first, as chips with the price difference', () => {
    const groups = Array.from(el().querySelectorAll('[role="radiogroup"]')).map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['Размер', 'Молоко']);
    const chips = Array.from(el().querySelectorAll('[role="radio"]')).map(text);
    expect(chips[0]).toBe('M');
    expect(chips[1]).toMatch(/^L \+5\s?руб\.$/);
  });

  it('marks the picked chip and moves the pick on a tap', async () => {
    const chip = (name: string) =>
      Array.from(el().querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((c) => text(c).startsWith(name));
    expect(chip('M')?.getAttribute('aria-checked')).toBe('true');

    chip('L')?.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.selection()).toEqual({ SIZE: 'l', MILK: 'oat' });
    expect(chip('L')?.getAttribute('aria-checked')).toBe('true');
    expect(chip('M')?.getAttribute('aria-checked')).toBe('false');
  });

  it('shows each add-on group collapsed with what is taken, the general one as «Добавки»', () => {
    expect(heads().map(row)).toEqual([
      'Сиропы · не выбрано',
      'Добавки · не выбрано',
      'Стакан обязательно · Свой стакан',
    ]);
    expect(head('Сиропы')?.getAttribute('aria-expanded')).toBe('false');
    expect(el().querySelectorAll('ul.list')).toHaveLength(1);
  });

  it('opens a group with a required add-on at once, its tick locked on', () => {
    expect(head('Стакан')?.getAttribute('aria-expanded')).toBe('true');
    const tick = el().querySelector<HTMLInputElement>('ul.list input[type="checkbox"]');
    expect(tick?.checked).toBe(true);
    expect(tick?.disabled).toBe(true);
  });

  it('opens a group in place: a stepper for several, counts kept within the limit', async () => {
    head('Сиропы')?.click();
    await fixture.whenStable();
    expect(head('Сиропы')?.getAttribute('aria-expanded')).toBe('true');

    const more = el().querySelector<HTMLButtonElement>('button[aria-label="Больше: Ваниль"]');
    for (let i = 0; i < 4; i++) {
      more?.click();
      await fixture.whenStable();
    }
    expect(fixture.componentInstance.counts()['vanilla']).toBe(3);
    expect(more?.disabled).toBe(true);
    expect(row(head('Сиропы'))).toBe('Сиропы · Ваниль ×3');
  });

  it('ticks an add-on that can be taken once', async () => {
    head('Добавки')?.click();
    await fixture.whenStable();
    const tick = Array.from(el().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(
      (box) => !box.disabled,
    );
    tick?.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.counts()['lid']).toBe(1);
    expect(row(head('Добавки'))).toBe('Добавки · Крышка');
  });
});
