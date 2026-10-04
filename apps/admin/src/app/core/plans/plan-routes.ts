import { inject } from '@angular/core';
import type { CanMatchFn, Route } from '@angular/router';
import type { PlanFeature } from '@takeaway/shared-types';

import { PlanAccess } from './plan-access.service';

/** Matches the route only when the brand in view has `feature`. */
export function planFeatureMatch(feature: PlanFeature): CanMatchFn {
  return () => inject(PlanAccess).hasWhenReady(feature);
}

/**
 * The route for a plan that includes `feature`, and the same path showing
 * the upgrade page for one that does not. The address stays as typed, so a
 * bookmark or a link from a teammate still says what it was for.
 */
export function planGated(feature: PlanFeature, route: Route): Route[] {
  return [
    { ...route, canMatch: [...(route.canMatch ?? []), planFeatureMatch(feature)] },
    {
      path: route.path,
      canActivate: route.canActivate,
      data: { ...route.data, planFeature: feature },
      loadComponent: () => import('../../features/plans/plan-upsell.page').then((m) => m.PlanUpsellPage),
    },
  ];
}
