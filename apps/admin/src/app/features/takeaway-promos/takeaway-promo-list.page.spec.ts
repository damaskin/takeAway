import { HttpErrorResponse } from '@angular/common/http';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { TakeawayPromo } from '@takeaway/shared-types';
import { of, throwError } from 'rxjs';

import { TakeawayPromosApi } from '../../core/takeaway-promos/takeaway-promos.service';
import { TakeawayPromoListPage } from './takeaway-promo-list.page';

function promo(overrides: Partial<TakeawayPromo> = {}): TakeawayPromo {
  return {
    id: 'tp1',
    name: 'Приветственный бонус',
    code: 'HELLO10',
    percent: 10,
    startsAt: '2026-11-01T00:00:00.000Z',
    endsAt: '2026-12-01T00:00:00.000Z',
    currency: 'RUP',
    budgetCents: 1_000_000,
    spentCents: 250_000,
    leftCents: 750_000,
    status: 'ACTIVE',
    effectiveStatus: 'ACTIVE',
    isWelcome: true,
    redemptionsCount: 37,
    editable: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('TakeawayPromoListPage', () => {
  let fixture: ComponentFixture<TakeawayPromoListPage>;
  let api: { list: jest.Mock; setStatus: jest.Mock };

  async function render(list: TakeawayPromo[]) {
    api = { list: jest.fn().mockReturnValue(of(list)), setStatus: jest.fn() };
    TestBed.configureTestingModule({
      imports: [TakeawayPromoListPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: TakeawayPromosApi, useValue: api },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    fixture = TestBed.createComponent(TakeawayPromoListPage);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => TestBed.resetTestingModule());

  const el = () => fixture.nativeElement as HTMLElement;
  const rows = () => [...el().querySelectorAll('[data-testid="takeaway-promo-row"]')];
  const text = (node: Element | undefined) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const button = (row: Element | undefined, label: string) =>
    [...(row?.querySelectorAll('button') ?? [])].find((b) => text(b) === label) as HTMLButtonElement | undefined;

  it('lists a promo with its code, percent, budget, status, welcome badge and orders', async () => {
    await render([promo(), promo({ id: 'tp2', code: 'AUTUMN', name: 'Осень', isWelcome: false })]);

    expect(api.list).toHaveBeenCalled();
    expect(rows()).toHaveLength(2);
    const first = text(rows()[0]);
    expect(first).toContain('Приветственный бонус');
    expect(first).toContain('Приветственная');
    expect(first).toContain('HELLO10');
    expect(first).toContain('−10%');
    expect(first).toContain('10 000 руб.');
    expect(first).toContain('израсходовано 2 500 руб. · осталось 7 500 руб.');
    expect(first).toContain('Активна');
    expect(first).toContain('37');
    expect(text(rows()[1])).not.toContain('Приветственная');
    // A quarter of the budget is spent.
    const bar = rows()[0]?.querySelector<HTMLElement>('.tp-meter span');
    expect(bar?.style.width).toBe('25%');
  });

  it('labels the chip by what the promo does now, not only by its switch', async () => {
    await render([
      promo({ id: 'a', effectiveStatus: 'SCHEDULED' }),
      promo({ id: 'b', effectiveStatus: 'ENDED' }),
      promo({ id: 'c', status: 'DISABLED', effectiveStatus: 'DISABLED' }),
      promo({ id: 'd', status: 'EXHAUSTED', effectiveStatus: 'EXHAUSTED', leftCents: 0, spentCents: 1_000_000 }),
    ]);
    expect(rows().map((r) => text(r.querySelector('.tp-status') ?? undefined))).toEqual([
      'Запланирована',
      'Завершена',
      'Выключена',
      'Бюджет исчерпан',
    ]);
  });

  it('switches a running promo off and shows the new state', async () => {
    await render([promo()]);
    api.setStatus.mockReturnValue(of(promo({ status: 'DISABLED', effectiveStatus: 'DISABLED' })));

    button(rows()[0], 'Выключить')?.click();
    fixture.detectChanges();

    expect(api.setStatus).toHaveBeenCalledWith('tp1', 'DISABLED');
    expect(text(rows()[0])).toContain('Выключена');
    expect(button(rows()[0], 'Включить')).toBeDefined();
  });

  it('does not offer to switch on an exhausted promo until its budget is raised', async () => {
    await render([promo({ status: 'EXHAUSTED', effectiveStatus: 'EXHAUSTED', leftCents: 0, spentCents: 1_000_000 })]);

    expect(button(rows()[0], 'Включить')?.disabled).toBe(true);
    expect(text(rows()[0])).toContain('Бюджет исчерпан — сначала увеличьте его в акции.');
  });

  it('says in Russian why the switch was refused', async () => {
    await render([promo({ status: 'DISABLED', effectiveStatus: 'DISABLED' })]);
    api.setStatus.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              statusCode: 409,
              code: 'TAKEAWAY_PROMO_WELCOME_TAKEN',
              message: 'Another welcome promo is active',
            },
          }),
      ),
    );

    button(rows()[0], 'Включить')?.click();
    fixture.detectChanges();

    expect(text(el().querySelector('[role="alert"]') ?? undefined)).toBe(
      'Активной может быть только одна приветственная акция — сначала выключите другую или снимите у неё отметку.',
    );
  });

  it('invites to create the first promo when there are none', async () => {
    await render([]);
    expect(text(el())).toContain('Акций пока нет');
    expect(el().querySelector('[data-testid="takeaway-promo-new"]')?.getAttribute('href')).toBe('/takeaway-promos/new');
  });
});
