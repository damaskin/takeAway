import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import type { BrandDto } from '../../core/catalog/admin-catalog.service';
import { OnboardingFlowService } from '../../core/onboarding/onboarding-flow.service';
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

  it('highlights the first step the owner still has to do', async () => {
    const list = await render('BRAND_ADMIN');

    expect(list.nextStep()).toBe('store');
    expect(list.ownerPartDone()).toBe(false);
  });

  it('says only the review is left once brand, store and menu are done', async () => {
    const list = await render('BRAND_ADMIN', { ...fresh, store: true, menu: true });

    expect(list.nextStep()).toBeNull();
    expect(list.ownerPartDone()).toBe(true);
  });

  it('opening a step starts the trip that brings the owner back', async () => {
    const list = await render('BRAND_ADMIN');
    const flow = TestBed.inject(OnboardingFlowService);

    list.open('store');

    expect(flow.active('store')).toBe(true);
    expect(flow.active('menu')).toBe(false);
  });

  it('shows the step just finished, once', async () => {
    const list = await render('BRAND_ADMIN');
    const flow = TestBed.inject(OnboardingFlowService);
    // What afterSave leaves behind when a step came back done.
    (flow as unknown as { _flash: { set(v: unknown): void } })._flash.set({ step: 'brand', at: Date.now() });
    TestBed.tick();

    expect(list.flashStep()).toBe('brand');
    expect(flow.flash()).toBeNull();
  });

  it('shows «всё готово» when the last step came back done, then leads to the panel', async () => {
    const list = await render('BRAND_ADMIN', {
      ...fresh,
      moderationStatus: 'APPROVED',
      store: true,
      menu: true,
      complete: true,
    });
    list.flashStep.set('menu');

    expect(list.allDone()).toBe(true);
    expect(list.visible()).toBe(true);

    list.openPanel();

    expect(list.visible()).toBe(false);
  });
});
