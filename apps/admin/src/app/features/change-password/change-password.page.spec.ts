import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { ChangePasswordPage } from './change-password.page';

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('ChangePasswordPage', () => {
  let changePassword: jest.Mock;

  /** The session in the browser before the page opens: forced after a temporary password, a PIN session, or a plain one. */
  function seed(extra: Record<string, unknown> = {}): void {
    localStorage.setItem(
      'takeaway.admin.session',
      JSON.stringify({
        accessToken: 'a',
        refreshToken: 'r',
        accessTokenExpiresInSeconds: 900,
        refreshTokenExpiresInSeconds: 86_400,
        user: { id: 'u1', role: 'BRAND_ADMIN', email: 'owner@noname.md', phone: null, name: 'Иван', locale: 'RU' },
        ...extra,
      }),
    );
  }

  function render() {
    changePassword = jest.fn().mockReturnValue(of(undefined));
    TestBed.configureTestingModule({
      imports: [ChangePasswordPage],
      providers: [provideRouter([]), provideTranslateService(), { provide: AuthService, useValue: { changePassword } }],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ChangePasswordPage);
    fixture.detectChanges();
    return fixture;
  }

  function type(fixture: ReturnType<typeof render>, values: Record<string, string>) {
    fixture.componentInstance.form.patchValue(values);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  it('says how long the new password has to be before anything is typed', () => {
    const fixture = render();
    expect(text((fixture.nativeElement as HTMLElement).querySelector('[data-testid="password-rule"]'))).toBe(
      'Не короче 8 символов (до 128) и не такой, как текущий.',
    );
  });

  it('turns the rule into the reason while the new password is too short', () => {
    const fixture = render();
    type(fixture, { currentPassword: 'temp-pass-1', newPassword: 'short' });
    expect(text((fixture.nativeElement as HTMLElement).querySelector('[data-testid="password-rule"]'))).toBe(
      'Слишком короткий: нужно не меньше 8 символов.',
    );
    expect(fixture.componentInstance.canSubmit()).toBe(false);
  });

  it('does not let the temporary password be kept', () => {
    const fixture = render();
    type(fixture, { currentPassword: 'temp-pass-1', newPassword: 'temp-pass-1', confirmPassword: 'temp-pass-1' });
    expect(fixture.componentInstance.newProblem()).toBe('admin.changePassword.errors.unchanged');
    fixture.componentInstance.submit();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('asks for the new password twice', () => {
    const fixture = render();
    type(fixture, { currentPassword: 'temp-pass-1', newPassword: 'my-own-pass', confirmPassword: 'my-own-pas' });
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('[data-testid="password-mismatch"]'))).toBe('Пароли не совпадают.');
    expect(fixture.componentInstance.canSubmit()).toBe(false);

    type(fixture, { confirmPassword: 'my-own-pass' });
    fixture.componentInstance.submit();
    expect(changePassword).toHaveBeenCalledWith({ currentPassword: 'temp-pass-1', newPassword: 'my-own-pass' });
  });

  it('words the API refusal in Russian instead of showing its English', () => {
    const fixture = render();
    changePassword.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            error: { code: 'CURRENT_PASSWORD_INCORRECT', message: 'Current password is incorrect' },
          }),
      ),
    );
    type(fixture, { currentPassword: 'typo-pass-1', newPassword: 'my-own-pass', confirmPassword: 'my-own-pass' });

    fixture.componentInstance.submit();

    expect(fixture.componentInstance.error()).toBe('Текущий пароль неверный. Введите пароль, с которым вы вошли.');
  });

  it('forced after a temporary password: no way back, and on to the cabinet once changed', () => {
    seed({ mustChangePassword: true });
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('h1'))).toBe('Смените пароль');
    expect(el.querySelector('[data-testid="change-password-back"]')).toBeNull();

    type(fixture, { currentPassword: 'temp-pass-1', newPassword: 'my-own-pass', confirmPassword: 'my-own-pass' });
    fixture.componentInstance.submit();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/']);
  });

  it('opened at will from «Сменить пароль»: a way back, and says it is done', () => {
    seed();
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('h1'))).toBe('Сменить пароль');
    expect(el.querySelector('[data-testid="change-password-back"]')).not.toBeNull();

    type(fixture, { currentPassword: 'old-pass-1', newPassword: 'my-own-pass', confirmPassword: 'my-own-pass' });
    fixture.componentInstance.submit();
    fixture.detectChanges();
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    expect(text(el.querySelector('[data-testid="change-password-done"]'))).toContain('Пароль изменён');
  });

  it('has no password to change in a kitchen PIN session', () => {
    seed({ kdsBrandId: 'brand-1', kdsStoreId: 'store-1' });
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="change-password-pin-session"]')).not.toBeNull();
    expect(el.querySelector('form')).toBeNull();
  });
});
