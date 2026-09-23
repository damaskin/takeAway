import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_EN, TRANSLATIONS_RU } from '@takeaway/i18n';
import { of, throwError } from 'rxjs';

import { BusinessService } from '../../core/business/business.service';
import { SignupPage } from './signup.page';

describe('SignupPage', () => {
  let register: jest.Mock;
  let navigate: jest.SpyInstance;

  function make(lang: 'ru' | 'en' = 'ru'): SignupPage {
    register = jest.fn().mockReturnValue(of({ brand: { id: 'b1' }, session: {} }));
    TestBed.configureTestingModule({
      imports: [SignupPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: BusinessService, useValue: { register } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.setTranslation('en', TRANSLATIONS_EN as unknown as Translation);
    translate.use(lang);
    navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    return TestBed.createComponent(SignupPage).componentInstance;
  }

  function fill(page: SignupPage, overrides: Partial<Record<string, string>> = {}): void {
    page.form.patchValue({
      brandName: 'Кофейня Ромашка',
      ownerName: 'Ион',
      email: 'Owner@Romashka.md',
      password: 'correct-horse',
      phone: '+373 (69) 12-34-56',
      ...overrides,
    });
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('registers in lei and in the language of the page, then opens the dashboard', () => {
    const page = make('ru');
    fill(page);

    page.submit();

    expect(register).toHaveBeenCalledWith({
      brandName: 'Кофейня Ромашка',
      ownerName: 'Ион',
      email: 'owner@romashka.md',
      password: 'correct-horse',
      phone: '+37369123456',
      currency: 'MDL',
      locale: 'RU',
    });
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('sends the currency the owner picked, and English from an English page', () => {
    const page = make('en');
    fill(page, { phone: '' });
    page.form.controls.currency.setValue('RUP');

    page.submit();

    expect(register).toHaveBeenCalledWith(expect.objectContaining({ currency: 'RUP', locale: 'EN', phone: undefined }));
  });

  it('stops a phone number without a country code before it reaches the server', () => {
    const page = make();
    fill(page, { phone: '069 123 456' });

    page.submit();

    expect(register).not.toHaveBeenCalled();
    expect(page.phoneInvalid()).toBe(true);
  });

  it('explains a customer email in Russian instead of echoing the server', () => {
    const page = make('ru');
    register.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'EMAIL_CUSTOMER_ACCOUNT', message: 'This email belongs to a customer account.' },
          }),
      ),
    );
    fill(page);

    page.submit();

    expect(page.error()).toBe(TRANSLATIONS_RU.admin.signup.errors.EMAIL_CUSTOMER_ACCOUNT);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('names the fields a 400 complained about', () => {
    const page = make('ru');
    register.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              message: ['phone must be in international format', 'currency must be one of the following values'],
            },
          }),
      ),
    );
    fill(page);

    page.submit();

    expect(page.error()).toBe('Проверьте поля: телефон, валюта.');
  });

  it('forgets a stale conflict as soon as the owner edits the form', () => {
    const page = make();
    register.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'EMAIL_TAKEN', message: 'taken' } })),
    );
    fill(page);
    page.submit();
    expect(page.errorCode()).toBe('EMAIL_TAKEN');

    page.form.controls.email.setValue('other@romashka.md');

    expect(page.error()).toBeNull();
    expect(page.errorCode()).toBeNull();
  });
});
