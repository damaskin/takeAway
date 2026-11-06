import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { type Observable, of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { ResetPasswordPage } from './reset-password.page';

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const TOKEN = 'Abc_def-123456789012345678901234567890123';

describe('ResetPasswordPage', () => {
  let resetPassword: jest.Mock;

  function make(query: Record<string, string>, answer: Observable<void> = of(undefined)) {
    resetPassword = jest.fn().mockReturnValue(answer);
    TestBed.configureTestingModule({
      imports: [ResetPasswordPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: AuthService, useValue: { resetPassword } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ResetPasswordPage);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const submit = (password: string) => {
      fixture.componentInstance.form.setValue({ newPassword: password });
      fixture.componentInstance.submit();
      fixture.detectChanges();
    };
    return { element, submit };
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('sets the new password with the token from the link — the same from email and from Telegram', () => {
    const { element, submit } = make({ token: TOKEN });
    expect(text(element.querySelector('h1'))).toBe('Новый пароль');

    submit('a-brand-new-password');

    expect(resetPassword).toHaveBeenCalledWith({ token: TOKEN, newPassword: 'a-brand-new-password' });
    expect(text(element)).toContain('Пароль обновлён');
  });

  it('explains a used or expired link, says the email and Telegram link is one, and offers a new one', () => {
    const used = new HttpErrorResponse({
      status: 400,
      error: { statusCode: 400, message: 'Reset link is invalid or has expired' },
    });
    const { element, submit } = make(
      { token: TOKEN },
      throwError(() => used),
    );

    submit('a-brand-new-password');

    const alert = text(element.querySelector('[role="alert"]'));
    expect(alert).toContain('её уже использовали или срок истёк');
    expect(alert).toContain('В письме и в Telegram ссылка одна и та же');
    expect(element.querySelector('a[href="/forgot-password"]')).not.toBeNull();
  });

  it('asks for a new link when the token is missing', () => {
    const { element } = make({});
    expect(text(element)).toContain('В ссылке нет токена');
    expect(element.querySelector('form')).toBeNull();
  });
});
