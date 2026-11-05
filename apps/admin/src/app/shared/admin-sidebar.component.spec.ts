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
  function render(kitchenSession: boolean, pendingByStore: ReadonlyMap<string, number> = new Map()) {
    TestBed.configureTestingModule({
      imports: [AdminSidebarComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        {
          provide: AuthStore,
          useValue: { user: signal({ role: 'STAFF' }), kitchenSession: signal(kitchenSession) },
        },
        { provide: FeatureFlagsStore, useValue: { flags: signal({}) } },
        { provide: BrandsService, useValue: { pendingCount: signal(null), planRequests: signal(null) } },
        {
          provide: OrderAlertsService,
          useValue: {
            pendingCount: signal([...pendingByStore.values()].reduce((a, b) => a + b, 0)),
            pendingByStore: signal(pendingByStore),
            stores: signal([{ id: 'balka' }, { id: 'centre' }]),
          },
        },
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

  it('says why only the kitchen, the stop-list and Telegram are there, and offers no support form', () => {
    const el = render(true);

    expect(el.querySelector('[data-testid="pin-session-note"]')?.textContent?.trim()).toBe(
      'Вход по PIN — кухня, стоп-лист и Telegram. Остальные разделы — после входа по паролю.',
    );
    expect([...el.querySelectorAll('a.admin-nav')].map((a) => a.getAttribute('href'))).toEqual([
      '/kitchen',
      '/stop-list',
      '/telegram-link',
    ]);
    expect(el.querySelector('.admin-support')).toBeNull();
  });

  it('has nothing to explain after a password sign-in, and offers the support form', () => {
    const el = render(false);

    expect(el.querySelector('[data-testid="pin-session-note"]')).toBeNull();
    expect(el.querySelectorAll('a.admin-nav').length).toBeGreaterThan(3);
    expect(el.querySelector('.admin-support')).not.toBeNull();
  });

  it('leads «Кухня» to the store with orders waiting when the remembered one has none (item 12)', () => {
    localStorage.setItem('takeaway.admin.kitchenStoreId', 'centre');
    try {
      const el = render(true, new Map([['balka', 1]]));
      const kitchen = el.querySelector('a.admin-nav[href^="/kitchen"]');
      expect(kitchen?.getAttribute('href')).toBe('/kitchen?store=balka');
      expect(kitchen?.querySelector('.admin-nav-badge-live')?.textContent?.trim()).toBe('1');
    } finally {
      localStorage.removeItem('takeaway.admin.kitchenStoreId');
    }
  });
});
