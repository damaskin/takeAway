import { Injectable, computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, filter, map, of, take } from 'rxjs';
import {
  type BrandPlan,
  DEFAULT_COMMISSION_BPS,
  type PlanFeature,
  featuresMissingFrom,
  planHasFeature,
} from '@takeaway/shared-types';

import { AuthStore } from '../auth/auth.store';
import { ActiveBrandService } from '../brand-context/active-brand.service';

/**
 * What the brand in view may use, by its business plan. The API refuses the
 * same features (`PLAN_FEATURE_REQUIRED`); this only keeps the cabinet from
 * offering what would be refused. A platform admin is never held back, as on
 * the API.
 */
@Injectable({ providedIn: 'root' })
export class PlanAccess {
  private readonly auth = inject(AuthStore);
  private readonly brands = inject(ActiveBrandService);
  private readonly loaded$ = toObservable(this.brands.loaded);

  readonly isPlatformAdmin = computed(() => this.auth.user()?.role === 'SUPER_ADMIN');

  /** The active brand's plan; null while no brand is in view. */
  readonly plan = computed<BrandPlan | null>(() => this.brands.active()?.plan ?? null);

  /** The active brand's commission in percent, e.g. 12.5. */
  readonly commissionPercent = computed<number | null>(() => {
    const brand = this.brands.active();
    if (!brand?.plan) return null;
    return (brand.commissionBps ?? DEFAULT_COMMISSION_BPS[brand.plan]) / 100;
  });

  /** What a PRO upgrade would add to the brand in view. */
  readonly missing = computed<PlanFeature[]>(() => {
    const plan = this.plan();
    return plan ? featuresMissingFrom(plan) : [];
  });

  has(feature: PlanFeature): boolean {
    if (this.isPlatformAdmin()) return true;
    return planHasFeature(this.plan(), feature);
  }

  /**
   * `has` once the brand list is in: route guards run before the shell has
   * asked for it, so they wait rather than lock a page for a brand that is
   * simply not loaded yet.
   */
  hasWhenReady(feature: PlanFeature): Observable<boolean> {
    if (this.isPlatformAdmin()) return of(true);
    if (!this.brands.loaded() && !this.brands.loading()) this.brands.refresh();
    return this.loaded$.pipe(
      filter(Boolean),
      take(1),
      map(() => this.has(feature)),
    );
  }
}
