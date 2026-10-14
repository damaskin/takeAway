import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_EN, TRANSLATIONS_RU } from '@takeaway/i18n';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { LoginPage, safeNext } from './login.page';

describe('safeNext', () => {
  it('follows a path inside the cabinet — the unbound tablet sends /kitchen', () => {
    expect(safeNext('/kitchen')).toBe('/kitchen');
    expect(safeNext('/stores/abc?tab=hours')).toBe('/stores/abc?tab=hours');
  });

  it('never leaves the cabinet', () => {
    for (const next of [
      null,
      '',
      'kitchen',
      'https://evil.test',
      '//evil.test',
      '/\\evil.test',
      'javascript:alert(1)',
    ]) {
      expect(safeNext(next)).toBe('/');
    }
  });
});

describe('LoginPage — email or login', () => {
  let login: jest.Mock;

  function make(): { page: LoginPage; element: HTMLElement; detect: () => void } {
    login = jest.fn().mockReturnValue(of({}));
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: AuthService, useValue: { login } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.setTranslation('en', TRANSLATIONS_EN as unknown as Translation);
    translate.use('ru');
    jest.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    return {
      page: fixture.componentInstance,
      element: fixture.nativeElement as HTMLElement,
      detect: () => fixture.detectChanges(),
    };
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('asks for «Почта или логин» in a plain text field', () => {
    const { element } = make();
    expect(element.textContent).toContain('Почта или логин');
    const field = element.querySelector('input[formcontrolname="identifier"]') as HTMLInputElement;
    expect(field.type).toBe('text');
    expect(field.autocomplete).toBe('username');
  });

  it('signs in with an email, lowercased', () => {
    const { page } = make();
    page.form.setValue({ identifier: ' Owner@NoName.md ', password: 'password-1' });
    page.submit();
    expect(login).toHaveBeenCalledWith({ identifier: 'owner@noname.md', password: 'password-1' });
  });

  it('signs in with a login, lowercased', () => {
    const { page } = make();
    page.form.setValue({ identifier: 'Anna.K', password: 'password-1' });
    page.submit();
    expect(login).toHaveBeenCalledWith({ identifier: 'anna.k', password: 'password-1' });
  });

  it('does not send something that is neither', () => {
    const { page } = make();
    for (const identifier of ['anna k', 'anna@', 'an']) {
      page.form.setValue({ identifier, password: 'password-1' });
      expect(page.form.invalid).toBe(true);
      page.submit();
    }
    expect(login).not.toHaveBeenCalled();
  });

  it('words a refused sign-in in the admin’s language', () => {
    const { page, element, detect } = make();
    login.mockReturnValue(
      throwError(() => ({
        status: 401,
        error: { statusCode: 401, message: 'Invalid email, login or password', error: 'Unauthorized' },
      })),
    );
    page.form.setValue({ identifier: 'anna.k', password: 'wrong-pass' });
    page.submit();
    detect();
    expect(element.textContent).toContain('Неверная почта, логин или пароль.');
  });
});
