import {
  ALL_PLAN_FEATURES,
  DEFAULT_COMMISSION_BPS,
  PLAN_FEATURES,
  featuresMissingFrom,
  minimumPlanFor,
  planHasFeature,
} from './plan';

describe('plans', () => {
  it('gives PRO everything BASIC has', () => {
    for (const feature of PLAN_FEATURES.BASIC) expect(planHasFeature('PRO', feature)).toBe(true);
  });

  it('keeps promo, campaigns and the deep analytics for PRO', () => {
    for (const feature of ['promo', 'campaigns', 'deepAnalytics', 'customers', 'winBack', 'churnList'] as const) {
      expect(planHasFeature('BASIC', feature)).toBe(false);
      expect(minimumPlanFor(feature)).toBe('PRO');
    }
    expect(minimumPlanFor('churn')).toBe('BASIC');
  });

  it('lists what an upgrade adds', () => {
    expect(featuresMissingFrom('PRO')).toEqual([]);
    expect(featuresMissingFrom('BASIC')).toEqual(ALL_PLAN_FEATURES.filter((f) => !PLAN_FEATURES.BASIC.includes(f)));
  });

  it('has no features without a plan', () => {
    expect(planHasFeature(null, 'dashboard')).toBe(false);
  });

  it('charges 10 % on BASIC and 15 % on PRO by default', () => {
    expect(DEFAULT_COMMISSION_BPS).toEqual({ BASIC: 1000, PRO: 1500 });
  });
});
