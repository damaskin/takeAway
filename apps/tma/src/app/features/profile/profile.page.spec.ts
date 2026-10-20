import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { AuthUser, LoyaltyAccount } from '@takeaway/shared-types';

import { API_CONFIG } from '../../core/api/api.config';
import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';
import { TmaProfilePage } from './profile.page';

const USER: AuthUser = {
  id: 'u-1',
  phone: null,
  email: null,
  name: 'Максим Петров',
  locale: 'RU',
  currency: 'USD',
  role: 'CUSTOMER',
  telegramUserId: '42',
};

const ACCOUNT: LoyaltyAccount = {
  userId: 'u-1',
  pointsBalance: 120,
  lifetimePoints: 120,
  tier: 'SILVER',
  nextTier: 'GOLD',
  pointsToNextTier: 380,
  tierProgressPercent: 24,
  recent: [],
};

describe('TmaProfilePage', () => {
  let fixture: ComponentFixture<TmaProfilePage>;
  let http: HttpTestingController;
  const user = signal<AuthUser | null>(USER);
  const updateUser = jest.fn((next: AuthUser) => user.set(next));

  beforeEach(async () => {
    user.set(USER);
    updateUser.mockClear();
    TestBed.configureTestingModule({
      imports: [TmaProfilePage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
        {
          provide: TmaAuthStore,
          useValue: { user, isAuthenticated: signal(true), setUser: updateUser },
        },
        { provide: FeatureFlagsStore, useValue: { load: jest.fn(), webPaymentsEnabled: signal(true) } },
        {
          provide: TelegramBridgeService,
          useValue: { haptic: jest.fn(), telegramUser: { name: 'Максим Петров', username: 'maxim' } },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TmaProfilePage);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const byTestId = (id: string) => el().querySelector(`[data-testid="${id}"]`);

  it('shows the real loyalty account', async () => {
    http.expectOne('/api/loyalty/me').flush(ACCOUNT);
    await fixture.whenStable();
    expect(byTestId('loyalty-points')?.textContent?.trim()).toBe('120 баллов');
    expect(byTestId('loyalty-tier')?.textContent).toContain('Серебряный');
    expect(byTestId('loyalty-card')?.textContent).toContain('380 баллов до уровня «Золотой»');
  });

  // It used to show «Gold, 2,450 баллов» to everybody.
  it('shows no loyalty card at all when the account cannot be read', async () => {
    http.expectOne('/api/loyalty/me').flush({}, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    expect(byTestId('loyalty-card')).toBeNull();
    expect(el().textContent).not.toContain('2,450');
  });

  it('says the customer is signed in with Telegram instead of offering a sign-out', async () => {
    http.expectOne('/api/loyalty/me').flush(ACCOUNT);
    await fixture.whenStable();
    expect(byTestId('signed-in')?.textContent).toContain('Вы вошли через Telegram');
    expect(byTestId('telegram-name')?.textContent?.trim()).toBe('Максим Петров · @maxim');
    expect(el().textContent).not.toContain('Выйти');
  });

  it('leads every row somewhere and switches the language in place', async () => {
    http.expectOne('/api/loyalty/me').flush(ACCOUNT);
    await fixture.whenStable();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const rows = Array.from(el().querySelectorAll<HTMLButtonElement>('button[data-route]'));
    expect(rows.map((r) => r.dataset['route'])).toEqual([
      '/profile/personal',
      '/profile/gift-cards',
      '/profile/notifications',
      '/feedback',
    ]);
    for (const row of rows) row.click();
    expect(navigate.mock.calls.map((c) => c[0])).toEqual([
      ['/profile/personal'],
      ['/profile/gift-cards'],
      ['/profile/notifications'],
      ['/feedback'],
    ]);

    // RU · EN right in the row; the bot then writes in that language too.
    const en = Array.from(byTestId('language-row')?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.trim() === 'en',
    );
    en?.click();
    await fixture.whenStable();
    const patch = http.expectOne('/api/auth/me');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ locale: 'EN' });
    patch.flush({ ...USER, locale: 'EN' });
    expect(updateUser).toHaveBeenCalledWith({ ...USER, locale: 'EN' });
    localStorage.clear();
  });
});
