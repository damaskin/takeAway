import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';

import { AuthStore } from '../core/auth/auth.store';
import { BrandsService } from '../core/brands/brands.service';
import { CampaignModerationApi } from '../core/campaigns/campaign-moderation.service';
import { FeatureFlagsStore } from '../core/config/feature-flags.store';
import { FeedbackApi } from '../core/feedback/feedback.service';
import { OrderAlertsService } from '../core/kitchen/order-alerts.service';
import { PlanAccess } from '../core/plans/plan-access.service';
import { PwaService } from '../core/pwa/pwa.service';
import { AdminSidebarComponent } from './admin-sidebar.component';

describe('AdminSidebarComponent — a kitchen PIN session', () => {
  function render(kdsStoreId: string | null) {
    TestBed.configureTestingModule({
      imports: [AdminSidebarComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: AuthStore, useValue: { user: signal({ role: 'STAFF' }), kdsStoreId: signal(kdsStoreId) } },
        { provide: FeatureFlagsStore, useValue: { flags: signal({}) } },
        { provide: BrandsService, useValue: { pendingCount: signal(null), planRequests: signal(null) } },
        { provide: OrderAlertsService, useValue: { pendingCount: signal(0) } },
        { provide: FeedbackApi, useValue: { newCount: signal(null) } },
        { provide: CampaignModerationApi, useValue: { pendingCount: signal(null) } },
        { provide: PwaService, useValue: { canInstall: signal(false) } },
        { provide: PlanAccess, useValue: { has: () => true } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(AdminSidebarComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('says why only the kitchen and the stop-list are there', () => {
    const el = render('store-1');

    expect(el.querySelector('[data-testid="pin-session-note"]')?.textContent?.trim()).toBe(
      'Вход по PIN — только кухня и стоп-лист. Остальные разделы — после входа по паролю.',
    );
    expect([...el.querySelectorAll('a.admin-nav')].map((a) => a.getAttribute('href'))).toEqual([
      '/kitchen',
      '/stop-list',
    ]);
  });

  it('has nothing to explain after a password sign-in', () => {
    const el = render(null);

    expect(el.querySelector('[data-testid="pin-session-note"]')).toBeNull();
    expect(el.querySelectorAll('a.admin-nav').length).toBeGreaterThan(2);
  });
});
