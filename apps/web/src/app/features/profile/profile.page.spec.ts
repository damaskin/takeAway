import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { AuthUser, CustomerBonus } from '@takeaway/shared-types';

import { API_CONFIG } from '../../core/api/api.config';
import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { InboxService } from '../../core/inbox/inbox.service';
import { ProfilePage } from './profile.page';

const USER: AuthUser = {
  id: 'u-1',
  phone: null,
  email: 'max@example.com',
  name: 'Максим Петров',
  locale: 'RU',
  currency: 'RUP',
  role: 'CUSTOMER',
  telegramUserId: null,
};

/** Noon UTC: 17 November on any customer's calendar between UTC−11 and UTC+11. */
const WELCOME: CustomerBonus = {
  id: 'bonus-1',
  kind: 'WELCOME',
  promoId: 'promo-1',
  code: 'WELCOME10',
  name: 'Приветственный бонус',
  percent: 10,
  currency: 'RUP',
  expiresAt: '2026-11-17T12:00:00.000Z',
};

describe('ProfilePage — «Мои бонусы»', () => {
  let fixture: ComponentFixture<ProfilePage>;
  let http: HttpTestingController;

  async function render(bonuses: CustomerBonus[] | 'error') {
    TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
        { provide: AuthStore, useValue: { user: signal(USER), isAuthenticated: signal(true) } },
        { provide: AuthService, useValue: { logout: jest.fn() } },
        { provide: FeatureFlagsStore, useValue: { load: jest.fn(), webPaymentsEnabled: signal(true) } },
        { provide: InboxService, useValue: { unreadCount: signal(0), refreshUnread: jest.fn() } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProfilePage);
    fixture.detectChanges();
    http.expectOne('/api/loyalty/me').flush({ pointsBalance: 0, tier: 'SILVER', nextTier: 'GOLD' });
    const request = http.expectOne('/api/me/bonuses');
    if (bonuses === 'error') request.flush({}, { status: 500, statusText: 'Server Error' });
    else request.flush(bonuses);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const textOf = (id: string) =>
    el().querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

  it('shows the welcome bonus with its last day, and leads to ordering', async () => {
    await render([WELCOME]);

    expect(textOf('bonus-banner')).toContain('Мои бонусы');
    expect(textOf('bonus-title')).toBe('Приветственный бонус −10%');
    expect(textOf('bonus-terms')).toBe('На заказ в любом заведении · до 17 ноября');
    expect(el().querySelector('[data-testid="bonus"]')?.getAttribute('href')).toBe('/menu');
  });

  it('shows no banner without a bonus', async () => {
    await render([]);
    expect(el().querySelector('[data-testid="bonus-banner"]')).toBeNull();
  });

  it('shows no banner when the bonuses cannot be read', async () => {
    await render('error');
    expect(el().querySelector('[data-testid="bonus-banner"]')).toBeNull();
  });
});
