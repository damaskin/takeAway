/**
 * Business plans (commission tariffs). One source for what each plan
 * includes: the admin reads it to lock menu items and show the upsell page,
 * the API reads it to refuse the same features. Change a plan here and both
 * sides follow.
 */

export type BrandPlan = 'BASIC' | 'PRO';

export const BRAND_PLANS: readonly BrandPlan[] = ['BASIC', 'PRO'];

/**
 * Something a plan may or may not include. The first group is every plan's
 * base; the second is what PRO adds on top.
 */
export type PlanFeature =
  // Every plan
  | 'dashboard'
  | 'kitchen'
  | 'menu'
  | 'storeManagement'
  | 'storeAnalytics'
  | 'churn'
  // PRO
  | 'promo'
  | 'campaigns'
  | 'deepAnalytics'
  | 'storeComparison'
  | 'staffAnalytics'
  | 'customers'
  | 'churnList'
  | 'winBack';

const BASIC_FEATURES: readonly PlanFeature[] = [
  'dashboard',
  'kitchen',
  'menu',
  'storeManagement',
  'storeAnalytics',
  'churn',
];

export const PLAN_FEATURES: Readonly<Record<BrandPlan, readonly PlanFeature[]>> = {
  BASIC: BASIC_FEATURES,
  PRO: [
    ...BASIC_FEATURES,
    'promo',
    'campaigns',
    'deepAnalytics',
    'storeComparison',
    'staffAnalytics',
    'customers',
    'churnList',
    'winBack',
  ],
};

/** Every feature, in display order. */
export const ALL_PLAN_FEATURES: readonly PlanFeature[] = PLAN_FEATURES.PRO;

/**
 * The platform's commission per plan, in basis points (1000 = 10 %). A new
 * brand starts on its plan's default; a platform admin may set another
 * value for one brand.
 */
export const DEFAULT_COMMISSION_BPS: Readonly<Record<BrandPlan, number>> = {
  BASIC: 1000,
  PRO: 1500,
};

export function planHasFeature(plan: BrandPlan | null | undefined, feature: PlanFeature): boolean {
  if (!plan) return false;
  return PLAN_FEATURES[plan].includes(feature);
}

/** The cheapest plan that includes the feature. */
export function minimumPlanFor(feature: PlanFeature): BrandPlan {
  return BRAND_PLANS.find((plan) => planHasFeature(plan, feature)) ?? 'PRO';
}

/** The features a PRO upgrade would add to `plan`. */
export function featuresMissingFrom(plan: BrandPlan): PlanFeature[] {
  return ALL_PLAN_FEATURES.filter((feature) => !planHasFeature(plan, feature));
}

/** Stable `code` of the 403 the API answers when a brand's plan lacks a feature. */
export const PLAN_FEATURE_REQUIRED = 'PLAN_FEATURE_REQUIRED';

/** The body of that 403. */
export interface PlanFeatureRequiredError {
  statusCode: 403;
  code: typeof PLAN_FEATURE_REQUIRED;
  feature: PlanFeature;
  requiredPlan: BrandPlan;
  message: string;
}
