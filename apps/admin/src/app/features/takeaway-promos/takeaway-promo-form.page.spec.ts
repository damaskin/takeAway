import { HttpErrorResponse } from '@angular/common/http';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { TakeawayPromo } from '@takeaway/shared-types';
import { of, throwError } from 'rxjs';

import { TakeawayPromosApi } from '../../core/takeaway-promos/takeaway-promos.service';
import { TakeawayPromoFormPage } from './takeaway-promo-form.page';

const USED: TakeawayPromo = {
  id: 'tp1',
  name: 'Приветственный бонус',
  code: 'HELLO10',
  percent: 10,
  startsAt: '2026-11-01T00:00:00.000Z',
  endsAt: '2026-12-01T00:00:00.000Z',
  currency: 'MDL',
  budgetCents: 1_000_000,
  spentCents: 250_050,
  leftCents: 749_950,
  status: 'ACTIVE',
  effectiveStatus: 'ACTIVE',
  isWelcome: true,
  redemptionsCount: 37,
  editable: false,
  createdAt: '2026-11-01T00:00:00.000Z',
};

describe('TakeawayPromoFormPage', () => {
  let fixture: ComponentFixture<TakeawayPromoFormPage>;
  let api: { get: jest.Mock; create: jest.Mock; update: jest.Mock };
  let navigate: jest.SpyInstance;

  async function render(promoId?: string, promo: TakeawayPromo = USED) {
    api = {
      get: jest.fn().mockReturnValue(of(promo)),
      create: jest.fn().mockReturnValue(of(promo)),
      update: jest.fn().mockReturnValue(of(promo)),
    };
    TestBed.configureTestingModule({
      imports: [TakeawayPromoFormPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: TakeawayPromosApi, useValue: api },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(TakeawayPromoFormPage);
    if (promoId) fixture.componentRef.setInput('promoId', promoId);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => TestBed.resetTestingModule());

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => (el().textContent ?? '').replace(/\s+/g, ' ');
  const field = <T extends HTMLElement = HTMLInputElement>(testId: string) =>
    el().querySelector(`[data-testid="${testId}"]`) as T;
  const type = (testId: string, value: string) => {
    const input = field(testId);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
  };
  const saveButton = () =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Создать акцию') as HTMLButtonElement;

  it('creates a promo: the code in capitals, the budget in cents, RUP by default', async () => {
    await render();

    type('takeaway-promo-name', '  Приветственный бонус ');
    type('takeaway-promo-code', 'hello10');
    type('takeaway-promo-percent', '10');
    type('takeaway-promo-budget', '5000.29');
    const welcome = field('takeaway-promo-welcome');
    welcome.click();
    fixture.detectChanges();

    expect(saveButton().disabled).toBe(false);
    saveButton().click();

    expect(api.create).toHaveBeenCalledTimes(1);
    const body = api.create.mock.calls[0][0];
    expect(body).toMatchObject({
      name: 'Приветственный бонус',
      code: 'HELLO10',
      percent: 10,
      currency: 'RUP',
      budgetCents: 500_029,
      isWelcome: true,
    });
    expect(new Date(body.endsAt).getTime()).toBeGreaterThan(new Date(body.startsAt).getTime());
    expect(navigate).toHaveBeenCalledWith(['/takeaway-promos']);
  });

  it('refuses a code outside [A-Za-z0-9_-] and a percent outside 1..99', async () => {
    await render();
    type('takeaway-promo-name', 'Акция');
    type('takeaway-promo-budget', '100');

    type('takeaway-promo-code', 'ПРИВЕТ');
    expect(saveButton().disabled).toBe(true);
    expect(text()).toContain('Промокод — от 2 до 32 латинских букв');
    type('takeaway-promo-code', 'A');
    expect(saveButton().disabled).toBe(true);
    type('takeaway-promo-code', 'AUTUMN_25-X');
    expect(saveButton().disabled).toBe(false);

    type('takeaway-promo-percent', '100');
    expect(saveButton().disabled).toBe(true);
    expect(text()).toContain('Скидка — целое число от 1 до 99 %.');
    type('takeaway-promo-percent', '0');
    expect(saveButton().disabled).toBe(true);
    type('takeaway-promo-percent', '12.5');
    expect(saveButton().disabled).toBe(true);
    type('takeaway-promo-percent', '99');
    expect(saveButton().disabled).toBe(false);
  });

  it('says in Russian that the code is taken', async () => {
    await render();
    api.create.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { statusCode: 409, code: 'TAKEAWAY_PROMO_CODE_TAKEN', message: 'Code taken' },
          }),
      ),
    );
    type('takeaway-promo-name', 'Акция');
    type('takeaway-promo-code', 'NONAME');
    type('takeaway-promo-budget', '100');
    saveButton().click();
    fixture.detectChanges();

    expect(el().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Этот код уже занят — другой акцией takeAway или промокодом бренда. Придумайте другой.',
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('freezes a used promo but its name, end and budget, and keeps the budget above what was spent', async () => {
    await render('tp1');

    expect(api.get).toHaveBeenCalledWith('tp1');
    expect(el().querySelector('[data-testid="takeaway-promo-frozen"]')?.textContent).toContain(
      'По акции уже есть заказы (37)',
    );
    expect(field('takeaway-promo-code').disabled).toBe(true);
    expect(field('takeaway-promo-percent').disabled).toBe(true);
    expect(field<HTMLSelectElement>('takeaway-promo-currency').disabled).toBe(true);
    expect(field('takeaway-promo-welcome').disabled).toBe(true);
    expect(field('takeaway-promo-name').disabled).toBe(false);
    expect(field('takeaway-promo-budget').value).toBe('10000');
    expect(text()).toContain('Уже израсходовано 2');

    const save = () => [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Сохранить');
    type('takeaway-promo-budget', '2500.49');
    expect(save()?.disabled).toBe(true);
    type('takeaway-promo-budget', '2500.50');
    expect(save()?.disabled).toBe(false);

    type('takeaway-promo-name', 'Бонус новичкам');
    save()?.click();

    // Only what may still change: the frozen fields would be refused with TAKEAWAY_PROMO_USED.
    expect(api.update).toHaveBeenCalledWith('tp1', {
      name: 'Бонус новичкам',
      endsAt: '2026-12-01T00:00:00.000Z',
      budgetCents: 250_050,
    });
  });

  it('sends every field while nobody has used the promo', async () => {
    await render('tp1', { ...USED, editable: true, spentCents: 0, leftCents: 1_000_000, redemptionsCount: 0 });

    expect(el().querySelector('[data-testid="takeaway-promo-frozen"]')).toBeNull();
    expect(field('takeaway-promo-percent').disabled).toBe(false);
    type('takeaway-promo-percent', '15');
    [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Сохранить')?.click();

    expect(api.update).toHaveBeenCalledWith(
      'tp1',
      expect.objectContaining({
        code: 'HELLO10',
        percent: 15,
        currency: 'MDL',
        budgetCents: 1_000_000,
        isWelcome: true,
      }),
    );
  });
});
