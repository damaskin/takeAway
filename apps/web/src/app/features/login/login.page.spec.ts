import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { TRANSLATIONS_EN } from '@takeaway/i18n/en';
import type { AuthSession } from '@takeaway/shared-types';
import { SOCIAL_AUTH_CONFIG, TELEGRAM_AUTH_CONFIG } from '@takeaway/ui-kit';

import { API_CONFIG } from '../../core/api/api.config';
import { AuthStore } from '../../core/auth/auth.store';
import { LoginPage } from './login.page';

const session: AuthSession = {
  accessToken: 'access',
  refreshToken: 'refresh',
  accessTokenExpiresInSeconds: 900,
  refreshTokenExpiresInSeconds: 604800,
  user: {
    id: 'u1',
    phone: null,
    email: 'ivan@mail.ru',
    name: null,
    locale: 'RU',
    currency: 'USD',
    role: 'CUSTOMER',
    telegramUserId: null,
  },
};

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let http: HttpTestingController;

  /** Opens the page; `email` is what `GET /auth/methods` answers for email sign-in. */
  async function open(lang: 'ru' | 'en', email = false): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
        // No provider configured: the page renders without loading any
        // third-party sign-in script.
        { provide: TELEGRAM_AUTH_CONFIG, useValue: { botUsername: '', clientId: '' } },
        { provide: SOCIAL_AUTH_CONFIG, useValue: { googleClientId: '', appleClientId: '', appleRedirectUri: '' } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.setTranslation('en', TRANSLATIONS_EN as unknown as Translation);
    translate.use(lang);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LoginPage);
    http.expectOne('/api/auth/methods').flush({ email, google: false, apple: false, telegram: false });
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function agreement(el: HTMLElement): HTMLElement | undefined {
    return Array.from(el.querySelectorAll('p')).find((p) => p.querySelector('a[href="/terms"]'));
  }

  function button(el: HTMLElement, text: string): HTMLButtonElement {
    const found = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
    if (!found) throw new Error(`no button "${text}"`);
    return found;
  }

  function type(el: HTMLElement, name: string, value: string): void {
    const field = el.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!field) throw new Error(`no field ${name}`);
    field.value = value;
    field.dispatchEvent(new Event('input'));
  }

  async function submit(el: HTMLElement): Promise<void> {
    el.querySelector('app-email-code-login form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  /** «Войти по почте» → address → «Получить код», answered with 204. */
  async function requestCode(el: HTMLElement, address = 'ivan@mail.ru'): Promise<void> {
    button(el, 'Войти по почте').click();
    await fixture.whenStable();
    type(el, 'email', address);
    await submit(el);
    http.expectOne('/api/auth/email/start').flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
  }

  const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';

  afterEach(() => {
    http.verify();
    jest.useRealTimers();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('links the agreement to the terms and the privacy policy', async () => {
    const p = agreement(await open('en'));

    expect(p?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'By continuing you agree to our Terms of Service and Privacy Policy.',
    );
    expect(p?.querySelector('a[href="/terms"]')?.textContent).toBe('Terms of Service');
    expect(p?.querySelector('a[href="/privacy"]')?.textContent).toBe('Privacy Policy');
  });

  it('reads as one sentence in Russian too', async () => {
    const p = agreement(await open('ru'));

    expect(p?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Продолжая, вы принимаете Условия использования и Политику конфиденциальности.',
    );
  });

  describe('sign-in by email', () => {
    it('stays hidden while the server cannot mail codes', async () => {
      const el = await open('ru', false);

      expect(text(el)).not.toContain('Войти по почте');
      expect(text(el)).toContain('не настроен ни один способ входа');
    });

    it('mails a code, then signs in with the six digits from the letter', async () => {
      const el = await open('ru', true);
      const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      expect(text(el)).not.toContain('не настроен ни один способ входа');

      button(el, 'Войти по почте').click();
      await fixture.whenStable();
      type(el, 'email', ' Ivan@Mail.ru ');
      await submit(el);

      const start = http.expectOne('/api/auth/email/start');
      expect(start.request.method).toBe('POST');
      expect(start.request.body).toEqual({ email: 'ivan@mail.ru', locale: 'ru' });
      start.flush(null, { status: 204, statusText: 'No Content' });
      await fixture.whenStable();

      expect(text(el)).toContain('Отправили код на ivan@mail.ru. Он действует 10 минут.');
      expect(text(el)).toContain('Отправить ещё раз через 60 с');
      const code = el.querySelector<HTMLInputElement>('input[name="code"]');
      expect(code?.getAttribute('autocomplete')).toBe('one-time-code');
      expect(code?.getAttribute('inputmode')).toBe('numeric');

      // Six digits — here pasted with a space — go straight to the server.
      type(el, 'code', '042 917');
      await fixture.whenStable();
      const verify = http.expectOne('/api/auth/email/verify');
      expect(verify.request.body).toEqual({ email: 'ivan@mail.ru', code: '042917' });
      verify.flush(session);
      await fixture.whenStable();

      expect(TestBed.inject(AuthStore).user()?.email).toBe('ivan@mail.ru');
      expect(navigate).toHaveBeenCalledWith(['/']);
    });

    it('refuses an address without a domain before asking the server', async () => {
      const el = await open('ru', true);
      button(el, 'Войти по почте').click();
      await fixture.whenStable();

      type(el, 'email', 'ivan@mail');
      await submit(el);

      http.expectNone('/api/auth/email/start');
      expect(text(el)).toContain('Проверьте адрес');
    });

    it('words a wrong code with the attempts left and clears the field', async () => {
      const el = await open('ru', true);
      await requestCode(el);

      type(el, 'code', '111111');
      await fixture.whenStable();
      http
        .expectOne('/api/auth/email/verify')
        .flush(
          { statusCode: 400, code: 'EMAIL_CODE_INVALID', message: 'The code is wrong', attemptsLeft: 3 },
          { status: 400, statusText: 'Bad Request' },
        );
      await fixture.whenStable();

      expect(text(el)).toContain('Неверный код. Осталось попыток: 3.');
      expect(el.querySelector<HTMLInputElement>('input[name="code"]')?.value).toBe('');
    });

    it.each([
      ['EMAIL_CODE_EXPIRED', 400, 'Код истёк или уже использован. Запросите новый.'],
      ['EMAIL_CODE_TOO_MANY_ATTEMPTS', 400, 'Слишком много неверных попыток'],
      ['EMAIL_LOGIN_STAFF_ACCOUNT', 401, 'Этот адрес принадлежит сотруднику. Войдите с паролем в кабинете бизнеса.'],
    ])('words %s', async (code, status, words) => {
      const el = await open('ru', true);
      await requestCode(el);

      type(el, 'code', '222222');
      await fixture.whenStable();
      http
        .expectOne('/api/auth/email/verify')
        .flush({ statusCode: status, code, message: 'x' }, { status, statusText: 'x' });
      await fixture.whenStable();

      expect(text(el)).toContain(words);
    });

    it('words a refused letter on the address step', async () => {
      const el = await open('ru', true);
      button(el, 'Войти по почте').click();
      await fixture.whenStable();
      type(el, 'email', 'ivan@mail.ru');
      await submit(el);

      http
        .expectOne('/api/auth/email/start')
        .flush({ statusCode: 503, code: 'EMAIL_CODE_NOT_SENT' }, { status: 503, statusText: 'Service Unavailable' });
      await fixture.whenStable();

      expect(text(el)).toContain('Не удалось отправить письмо. Попробуйте через несколько минут.');
      expect(el.querySelector('input[name="email"]')).not.toBeNull();
    });

    it('goes on to the code when one went to the address a moment ago', async () => {
      const el = await open('ru', true);
      button(el, 'Войти по почте').click();
      await fixture.whenStable();
      type(el, 'email', 'ivan@mail.ru');
      await submit(el);

      http
        .expectOne('/api/auth/email/start')
        .flush(
          { statusCode: 429, code: 'EMAIL_CODE_COOLDOWN', retryAfterSeconds: 42 },
          { status: 429, statusText: 'Too Many Requests' },
        );
      await fixture.whenStable();

      expect(text(el)).toContain('Код уже отправлен на ivan@mail.ru — проверьте почту.');
      expect(text(el)).toContain('Отправить ещё раз через 42 с');
      expect(el.querySelector('input[name="code"]')).not.toBeNull();
    });

    it('offers another code after a minute, and lets the address be changed', async () => {
      jest.useFakeTimers({ advanceTimers: true });
      const el = await open('ru', true);
      await requestCode(el);
      expect(text(el)).not.toContain('Отправить код ещё раз');

      jest.advanceTimersByTime(60_000);
      await fixture.whenStable();
      button(el, 'Отправить код ещё раз').click();
      await fixture.whenStable();
      const again = http.expectOne('/api/auth/email/start');
      expect(again.request.body).toEqual({ email: 'ivan@mail.ru', locale: 'ru' });
      again.flush(null, { status: 204, statusText: 'No Content' });
      await fixture.whenStable();
      expect(text(el)).toContain('Отправить ещё раз через 60 с');

      button(el, 'Изменить почту').click();
      await fixture.whenStable();
      expect(el.querySelector<HTMLInputElement>('input[name="email"]')?.value).toBe('ivan@mail.ru');
      expect(el.querySelector('input[name="code"]')).toBeNull();
    });
  });
});
