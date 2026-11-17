import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { LoyaltyAccount } from '@takeaway/shared-types';

import { API_CONFIG } from '../../core/api/api.config';
import { ProfileLoyaltyPage } from './loyalty.page';

/** Every figure in API units: a hundredth of a point, and 1 балл = 1 руб. */
const ACCOUNT: LoyaltyAccount = {
  userId: 'u-1',
  pointsBalance: 1240,
  lifetimePoints: 1240,
  tier: 'SILVER',
  nextTier: 'GOLD',
  pointsToNextTier: 260,
  tierProgressPercent: 82,
  recent: [
    {
      id: 'e-1',
      type: 'EARN',
      amount: 40,
      reason: 'Order TA-1 · +0.40 points',
      orderId: 'o-1',
      createdAt: '2026-11-17T10:00:00.000Z',
    },
    {
      id: 'e-2',
      type: 'SPEND',
      amount: -500,
      reason: 'Order TA-2 · −5 points',
      orderId: 'o-2',
      createdAt: '2026-11-17T11:00:00.000Z',
    },
  ],
};

describe('ProfileLoyaltyPage', () => {
  let fixture: ComponentFixture<ProfileLoyaltyPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ProfileLoyaltyPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProfileLoyaltyPage);
    fixture.detectChanges();
    http.expectOne('/api/loyalty/me').flush(ACCOUNT);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  const text = () => (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';

  it('shows the balance and the way to the next level in points with their kopecks', () => {
    expect(text()).toContain('12,40 балла');
    expect(text()).toContain('До уровня «Золотой»');
    expect(text()).toContain('2,60 балла');
  });

  it('shows each operation in points, with a real minus on a spend', () => {
    const amounts = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="loyalty-entry-amount"]'),
    ).map((e) => e.textContent?.trim());
    expect(amounts).toEqual(['+0,40', '\u22125']);
  });
});
