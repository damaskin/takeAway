import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import type { BrandDto } from '../../core/catalog/admin-catalog.service';
import { type BrandOnboarding, OnboardingApi } from '../../core/onboarding/onboarding.service';
import { OnboardingChecklistComponent } from './onboarding-checklist.component';

const fresh: BrandOnboarding = {
  brandId: 'b1',
  moderationStatus: 'PENDING',
  moderationNote: null,
  brandProfile: true,
  store: false,
  menu: false,
  cardPayments: false,
  complete: false,
};

describe('OnboardingChecklistComponent', () => {
  let checklist: jest.Mock;
  const active = signal<BrandDto | null>(null);

  async function render(role: string, data: BrandOnboarding = fresh) {
    checklist = jest.fn().mockReturnValue(of(data));
    active.set({
      id: 'b1',
      slug: 'b1',
      name: 'Ромашка',
      currency: 'MDL',
      locale: 'RU',
      logoUrl: null,
      moderationStatus: data.moderationStatus,
    });
    TestBed.configureTestingModule({
      imports: [OnboardingChecklistComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: AuthStore, useValue: { user: signal({ role }) } },
        { provide: ActiveBrandService, useValue: { active } },
        { provide: OnboardingApi, useValue: { checklist } },
      ],
    });
    const fixture = TestBed.createComponent(OnboardingChecklistComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it("reads the owner's brand and lists what is done and what is left", async () => {
    const list = await render('BRAND_ADMIN');

    expect(checklist).toHaveBeenCalledWith('b1');
    expect(list.visible()).toBe(true);
    expect(list.steps().map((s) => [s.key, s.done])).toEqual([
      ['brand', true],
      ['store', false],
      ['menu', false],
      ['payments', true],
      ['moderation', false],
    ]);
    expect(list.doneCount()).toBe(2);
  });

  it('describes payments as on-site until card payments are switched on', async () => {
    const onSite = await render('BRAND_ADMIN');
    expect(onSite.steps().find((s) => s.key === 'payments')?.text).toBe('admin.onboarding.checklist.payments.onSite');

    TestBed.resetTestingModule();
    const card = await render('BRAND_ADMIN', { ...fresh, cardPayments: true });
    expect(card.steps().find((s) => s.key === 'payments')?.text).toBe('admin.onboarding.checklist.payments.card');
  });

  it('goes away once everything is done and the brand is approved', async () => {
    const list = await render('BRAND_ADMIN', {
      ...fresh,
      moderationStatus: 'APPROVED',
      store: true,
      menu: true,
      complete: true,
    });

    expect(list.visible()).toBe(false);
  });

  it('is not shown to anyone but the owner', async () => {
    const list = await render('SUPER_ADMIN');

    expect(checklist).not.toHaveBeenCalled();
    expect(list.visible()).toBe(false);
  });
});
