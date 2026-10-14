import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { SignInMethods } from '@takeaway/shared-types';
import { SOCIAL_AUTH_CONFIG, TELEGRAM_AUTH_CONFIG } from '@takeaway/ui-kit';

import { API_CONFIG } from '../../core/api/api.config';
import { ProfileSignInMethodsPage } from './sign-in-methods.page';

describe('ProfileSignInMethodsPage', () => {
  let http: HttpTestingController;

  async function open(methods: SignInMethods): Promise<string> {
    TestBed.configureTestingModule({
      imports: [ProfileSignInMethodsPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
        { provide: TELEGRAM_AUTH_CONFIG, useValue: { botUsername: '', clientId: '' } },
        { provide: SOCIAL_AUTH_CONFIG, useValue: { googleClientId: '', appleClientId: '', appleRedirectUri: '' } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ProfileSignInMethodsPage);
    http.expectOne('/api/auth/me/sign-in-methods').flush(methods);
    await fixture.whenStable();
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';
  }

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('lists the proven email, which counts as a way in, so Google can be disconnected', async () => {
    const text = await open({ telegram: false, google: true, apple: false, email: 'ivan@mail.ru' });

    expect(text).toContain('Почта');
    expect(text).toContain('Код для входа приходит на ivan@mail.ru');
    expect(text).toContain('Отключить');
  });

  it('keeps the last way in when there is no proven email', async () => {
    const text = await open({ telegram: false, google: true, apple: false, email: null });

    expect(text).not.toContain('Почта');
    expect(text).not.toContain('Отключить');
  });
});
