import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { Modifier, Variation } from '@takeaway/shared-types';

import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';
import { TmaProductOptionsComponent } from './product-options.component';

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

describe('TmaProductOptionsComponent', () => {
  let fixture: ComponentFixture<TmaProductOptionsComponent>;
  const haptic = jest.fn();

  beforeEach(async () => {
    haptic.mockClear();
    TestBed.configureTestingModule({
      imports: [TmaProductOptionsComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: TelegramBridgeService, useValue: { haptic } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    fixture = TestBed.createComponent(TmaProductOptionsComponent);
    fixture.componentRef.setInput('variations', [
      variation({ id: 's', type: 'SIZE', name: 'S', isDefault: true }),
      variation({ id: 'l', type: 'SIZE', name: 'L', priceDeltaCents: 500, sortOrder: 1 }),
    ]);
    fixture.componentRef.setInput('modifiers', [
      modifier({ id: 'vanilla', name: 'Ваниль', group: 'Сиропы', priceDeltaCents: 300, maxCount: 2 }),
      modifier({ id: 'onion', name: 'Без лука', group: 'Убрать', minCount: 1, sortOrder: 1 }),
    ]);
    fixture.componentRef.setInput('currency', 'RUP');
    fixture.componentRef.setInput('selection', { SIZE: 's' });
    fixture.componentRef.setInput('counts', { vanilla: 0, onion: 1 });
    await fixture.whenStable();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const head = (name: string) =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('button.head')).find((h) => text(h).startsWith(name));

  it('picks a size from chips with the price difference, with a light haptic', async () => {
    const large = Array.from(el().querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((c) =>
      text(c).startsWith('L'),
    );
    expect(text(large)).toMatch(/^L \+5\s?руб\.$/);
    large?.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.selection()).toEqual({ SIZE: 'l' });
    expect(haptic).toHaveBeenCalledWith('light');
  });

  it('keeps optional groups closed and opens the required one, marked', () => {
    expect(head('Сиропы')?.getAttribute('aria-expanded')).toBe('false');
    expect(head('Убрать')?.getAttribute('aria-expanded')).toBe('true');
    expect(text(head('Убрать'))).toContain('обязательно');
  });

  it('counts an add-on up to its limit with the stepper', async () => {
    head('Сиропы')?.click();
    await fixture.whenStable();
    const more = el().querySelector<HTMLButtonElement>('button[aria-label="Больше: Ваниль"]');
    more?.click();
    await fixture.whenStable();
    more?.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.counts()['vanilla']).toBe(2);
    expect(more?.disabled).toBe(true);
    expect(text(head('Сиропы'))).toContain('Ваниль ×2');
  });
});
