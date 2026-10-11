import { Role } from '@prisma/client';
import type { PlanFeature } from '@takeaway/shared-types';

import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { resolveDateRange } from './analytics-range';
import type { AnalyticsScopeResolver } from './analytics-scope';
import { AnalyticsController } from './analytics.controller';
import type { AnalyticsService } from './analytics.service';
import type { OverviewService } from './overview.service';

const OWNER: AuthenticatedUser = { id: 'u1', role: Role.BRAND_ADMIN, email: null, phone: null, name: null };

describe('AnalyticsController.overview', () => {
  function controller(features: PlanFeature[]) {
    const range = resolveDateRange({ days: 30 }, 'Europe/Chisinau', 30);
    const context = {
      scope: { brandIds: ['b1'], storeIds: ['s1'] },
      parent: { brandIds: ['b1'], storeIds: null },
      storeId: 's1',
      range,
      features: new Set(features),
      currency: 'RUP',
      currencies: ['RUP'],
    };
    const scopes = { context: jest.fn().mockResolvedValue(context) } as unknown as AnalyticsScopeResolver;
    const overviews = { business: jest.fn().mockResolvedValue({}) };
    const ctrl = new AnalyticsController({} as AnalyticsService, scopes, overviews as unknown as OverviewService);
    return { ctrl, scopes, overviews, context };
  }

  it('reads the caller scope and gives a BASIC brand no comparison and no load', async () => {
    const { ctrl, scopes, overviews, context } = controller(['dashboard', 'storeAnalytics']);
    await ctrl.overview(OWNER, { brandId: 'b1', storeId: 's1', days: 30 });
    expect(scopes.context).toHaveBeenCalledWith(OWNER, { brandId: 'b1', storeId: 's1', days: 30 }, 30);
    // The whole context goes on: the picked store, the brand it is part of, the currency.
    expect(overviews.business).toHaveBeenCalledWith(context, { storeComparison: false, deep: false });
  });

  it('turns on the PRO parts with the plan features', async () => {
    const { ctrl, overviews } = controller(['storeComparison', 'deepAnalytics']);
    await ctrl.overview(OWNER, {});
    expect(overviews.business.mock.calls[0]?.[1]).toEqual({ storeComparison: true, deep: true });
  });
});
