import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { PasswordForgotResponse } from '@takeaway/shared-types';
import { type Observable, of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { ForgotPasswordPage, sentWording } from './forgot-password.page';

/** Text with every run of whitespace (NBSP included) as one space. */
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('ForgotPasswordPage', () => {
  let forgotPassword: jest.Mock;

  function make(answer: Observable<PasswordForgotResponse | null>) {
    forgotPassword = jest.fn().mockReturnValue(answer);
    TestBed.configureTestingModule({
      imports: [ForgotPasswordPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: AuthService, useValue: { forgotPassword } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(ForgotPasswordPage);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const submit = (identifier: string) => {
      fixture.componentInstance.form.setValue({ identifier });
      fixture.componentInstance.submit();
      fixture.detectChanges();
    };
    return { page: fixture.componentInstance, element, submit };
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('asks for «Почта или логин» and says the link goes by email and to Telegram', () => {
    const { element } = make(of(null));
    expect(text(element)).toContain('Почта или логин');
    expect(text(element)).toContain('на почту и в Telegram, если он привязан к аккаунту');
    const field = element.querySelector('input[formcontrolname="identifier"]') as HTMLInputElement;
    expect(field.type).toBe('text');
    expect(field.autocomplete).toBe('username');
  });

  it('always says what to do with neither email nor Telegram — without saying whose account', () => {
    const { element } = make(of(null));
    expect(text(element.querySelector('[data-testid="forgot-no-channel-hint"]'))).toContain(
      'Нет ни почты, ни привязанного Telegram?',
    );
    expect(text(element.querySelector('[data-testid="forgot-no-channel-hint"]'))).toContain('поддержка takeAway');
  });

  it('sends an email lowercased, and a login too', () => {
    const { submit } = make(of({ channels: ['email', 'telegram'], linkTtlMinutes: 60 }));
    submit(' Owner@NoName.md ');
    expect(forgotPassword).toHaveBeenLastCalledWith({ identifier: 'owner@noname.md' });

    TestBed.resetTestingModule();
    const again = make(of({ channels: ['email', 'telegram'], linkTtlMinutes: 60 }));
    again.submit('Ion.Barista');
    expect(forgotPassword).toHaveBeenLastCalledWith({ identifier: 'ion.barista' });
  });

  it('does not send what is neither an email nor a login', () => {
    const { page, submit } = make(of(null));
    submit('not a login!');
    expect(page.form.invalid).toBe(true);
    expect(forgotPassword).not.toHaveBeenCalled();
  });

  it('tells where to look with both channels: Maxim’s wording, and the hint stays', () => {
    const { element, submit } = make(of({ channels: ['email', 'telegram'], linkTtlMinutes: 60 }));
    submit('owner@noname.md');
    expect(text(element.querySelector('[data-testid="forgot-sent"]'))).toBe(
      'Если аккаунт найден, мы отправили ссылку на почту и в Telegram, если он привязан. Ссылка действует 60 мин — проверьте и папку «Спам».',
    );
    expect(element.querySelector('[data-testid="forgot-no-channel-hint"]')).not.toBeNull();
  });

  it('without SMTP on the server, points to Telegram only and promises no letter', () => {
    const { element, submit } = make(of({ channels: ['telegram'], linkTtlMinutes: 60 }));
    submit('ion.barista');
    const sent = text(element.querySelector('[data-testid="forgot-sent"]'));
    expect(sent).toContain('в чат с ботом takeAway');
    expect(sent).toContain('Письма с этого сервера пока не отправляются');
    expect(sent).not.toContain('Спам');
  });

  it('with email only, does not mention Telegram', () => {
    const { element, submit } = make(of({ channels: ['email'], linkTtlMinutes: 30 }));
    submit('owner@noname.md');
    const sent = text(element.querySelector('[data-testid="forgot-sent"]'));
    expect(sent).not.toContain('Telegram');
    expect(sent).toContain('30 мин');
  });

  it('says plainly when the server can send the link nowhere', () => {
    const unavailable = new HttpErrorResponse({
      status: 503,
      error: { statusCode: 503, code: 'PASSWORD_RESET_UNAVAILABLE', message: 'Password reset is not available' },
    });
    const { element, submit } = make(throwError(() => unavailable));
    submit('owner@noname.md');
    expect(text(element.querySelector('[role="alert"]'))).toContain('не настроены ни почта, ни Telegram-бот');
    expect(element.querySelector('[data-testid="forgot-sent"]')).toBeNull();
  });

  it('asks to wait on 429', () => {
    const { element, submit } = make(throwError(() => new HttpErrorResponse({ status: 429 })));
    submit('owner@noname.md');
    expect(text(element.querySelector('[role="alert"]'))).toContain('Подождите минуту');
  });
});

describe('sentWording', () => {
  it('names only what the server can send through; an older API gets the general wording', () => {
    expect(sentWording({ channels: ['email', 'telegram'], linkTtlMinutes: 60 })).toBe('both');
    expect(sentWording({ channels: ['email'], linkTtlMinutes: 60 })).toBe('email');
    expect(sentWording({ channels: ['telegram'], linkTtlMinutes: 60 })).toBe('telegram');
    expect(sentWording(null)).toBe('both');
  });
});
