import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_EN, TRANSLATIONS_RU } from '@takeaway/i18n';
import { SOCIAL_AUTH_CONFIG, TELEGRAM_AUTH_CONFIG } from '@takeaway/ui-kit';

import { AuthService } from '../../core/auth/auth.service';
import { LoginPage } from './login.page';

describe('LoginPage', () => {
  async function open(lang: 'ru' | 'en'): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: AuthService, useValue: {} },
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
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function agreement(el: HTMLElement): HTMLElement | undefined {
    return Array.from(el.querySelectorAll('p')).find((p) => p.querySelector('a[href="/terms"]'));
  }

  beforeEach(() => TestBed.resetTestingModule());

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
});
