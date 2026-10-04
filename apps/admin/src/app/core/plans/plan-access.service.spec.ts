import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Route } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthStore } from '../auth/auth.store';
import { ActiveBrandService } from '../brand-context/active-brand.service';
import type { BrandDto } from '../catalog/admin-catalog.service';
import { PlanAccess } from './plan-access.service';
import { planGated } from './plan-routes';

function setup(role: string, brand: Partial<BrandDto> | null, loaded = true) {
  const loadedSig = signal(loaded);
  const refresh = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthStore, useValue: { user: signal({ role }) } },
      {
        provide: ActiveBrandService,
        useValue: {
          active: signal(brand),
          loaded: loadedSig,
          loading: signal(false),
          refresh,
        },
      },
    ],
  });
  return { access: TestBed.inject(PlanAccess), loaded: loadedSig, refresh };
}

describe('PlanAccess', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('opens everything on PRO', () => {
    const { access } = setup('BRAND_ADMIN', { id: 'b1', plan: 'PRO', commissionBps: 1500 });
    expect(access.has('promo')).toBe(true);
    expect(access.has('winBack')).toBe(true);
    expect(access.commissionPercent()).toBe(15);
    expect(access.missing()).toEqual([]);
  });

  it('keeps PRO sections locked on BASIC', () => {
    const { access } = setup('BRAND_ADMIN', { id: 'b1', plan: 'BASIC' });
    expect(access.has('dashboard')).toBe(true);
    expect(access.has('churn')).toBe(true);
    expect(access.has('promo')).toBe(false);
    expect(access.has('customers')).toBe(false);
    expect(access.commissionPercent()).toBe(10);
    expect(access.missing()).toContain('campaigns');
  });

  it('never locks anything for a platform admin', () => {
    const { access } = setup('SUPER_ADMIN', { id: 'b1', plan: 'BASIC' });
    expect(access.has('customers')).toBe(true);
  });

  it('waits for the brand list before deciding, and asks for it', async () => {
    const { access, loaded, refresh } = setup('BRAND_ADMIN', { id: 'b1', plan: 'PRO' }, false);
    const decision = firstValueFrom(access.hasWhenReady('promo'));
    expect(refresh).toHaveBeenCalled();
    loaded.set(true);
    TestBed.tick();
    await expect(decision).resolves.toBe(true);
  });
});

describe('planGated', () => {
  it('pairs the section with the upgrade page on the same path', () => {
    const route: Route = { path: 'promo', data: { navKey: 'promo' }, loadComponent: () => Promise.resolve(class {}) };
    const [section, upsell] = planGated('promo', route);
    expect(section?.path).toBe('promo');
    expect(section?.canMatch).toHaveLength(1);
    expect(upsell?.path).toBe('promo');
    expect(upsell?.data).toEqual({ navKey: 'promo', planFeature: 'promo' });
  });
});
