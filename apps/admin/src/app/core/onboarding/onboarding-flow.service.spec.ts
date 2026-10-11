import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AuthStore } from '../auth/auth.store';
import { ActiveBrandService } from '../brand-context/active-brand.service';
import { OnboardingFlowService } from './onboarding-flow.service';
import { type BrandOnboarding, OnboardingApi } from './onboarding.service';

const progress: BrandOnboarding = {
  brandId: 'b1',
  moderationStatus: 'PENDING',
  moderationNote: null,
  brandProfile: false,
  store: false,
  menu: false,
  cardPayments: false,
  complete: false,
};

describe('OnboardingFlowService', () => {
  let checklist: jest.Mock;
  let navigate: jest.Mock;
  const role = signal<string>('BRAND_ADMIN');

  function make(): OnboardingFlowService {
    checklist = jest.fn().mockReturnValue(of(progress));
    navigate = jest.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { user: () => ({ role: role() }) } },
        { provide: ActiveBrandService, useValue: { activeId: signal('b1') } },
        { provide: OnboardingApi, useValue: { checklist } },
        { provide: Router, useValue: { navigate } },
      ],
    });
    return TestBed.inject(OnboardingFlowService);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    role.set('BRAND_ADMIN');
  });

  it('leaves a page reached any other way alone', async () => {
    const flow = make();

    await expect(flow.afterSave('brand')).resolves.toBe('inactive');

    expect(checklist).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('takes the owner back to the checklist once the step is done, with a note for it', async () => {
    const flow = make();
    checklist.mockReturnValue(of({ ...progress, brandProfile: true }));
    flow.start('brand');

    await expect(flow.afterSave('brand')).resolves.toBe('returned');

    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
    expect(flow.flash()).toEqual(expect.objectContaining({ step: 'brand' }));
    // The trip is over: another save on the same page stays put.
    expect(flow.active('brand')).toBe(false);
  });

  it('stays on the page and says what is missing when the step is not done yet', async () => {
    const flow = make();
    flow.start('menu');

    await expect(flow.afterSave('menu')).resolves.toBe('incomplete');

    expect(navigate).not.toHaveBeenCalled();
    expect(flow.hint()).toBe('menu');
    expect(flow.active('menu')).toBe(true);
  });

  it('only counts a save on the step the trip is for', async () => {
    const flow = make();
    flow.start('store');

    await expect(flow.afterSave('brand')).resolves.toBe('inactive');
  });

  it('forgets a trip nobody finished within half an hour', async () => {
    const flow = make();
    const start = Date.now();
    flow.start('brand', start);

    expect(flow.active('brand', start + 29 * 60_000)).toBe(true);
    expect(flow.active('brand', start + 31 * 60_000)).toBe(false);
  });

  it('is for the brand owner only', async () => {
    role.set('SUPER_ADMIN');
    const flow = make();
    flow.start('brand');

    await expect(flow.afterSave('brand')).resolves.toBe('inactive');
  });

  it('keeps the page where it is when the checklist cannot be read', async () => {
    const flow = make();
    checklist.mockReturnValue(throwError(() => new Error('offline')));
    flow.start('brand');

    await expect(flow.afterSave('brand')).resolves.toBe('inactive');
    expect(navigate).not.toHaveBeenCalled();
  });
});
