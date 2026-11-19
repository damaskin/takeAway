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

describe('AnalyticsController.inactive', () => {
  function controller(features: PlanFeature[]) {
    const people = {
      scope: { brandIds: ['b1'], storeIds: null },
      parent: { brandIds: ['b1'], storeIds: null },
      storeId: null,
      timeZone: 'Europe/Chisinau',
      features: new Set(features),
      currency: 'RUP',
      currencies: ['MDL', 'RUP'],
    };
    const scopes = { peopleContext: jest.fn().mockResolvedValue(people) } as unknown as AnalyticsScopeResolver;
    const analytics = { inactiveNow: jest.fn().mockResolvedValue({}) };
    const ctrl = new AnalyticsController(
      analytics as unknown as AnalyticsService,
      scopes,
      {} as unknown as OverviewService,
    );
    return { ctrl, scopes, analytics, people };
  }

  it('counts people the way «Клиенты» does, 14 days and three names by default', async () => {
    const { ctrl, scopes, analytics, people } = controller(['churnList']);
    await ctrl.inactive(OWNER, { brandId: 'b1' });
    expect(scopes.peopleContext).toHaveBeenCalledWith(OWNER, { brandId: 'b1' });
    expect(analytics.inactiveNow).toHaveBeenCalledWith(people.scope, 14, {
      timeZone: 'Europe/Chisinau',
      currency: 'RUP',
      currencies: ['MDL', 'RUP'],
      withList: true,
      take: 3,
    });
  });

  it('takes the threshold and names nobody without the list feature', async () => {
    const { ctrl, analytics } = controller([]);
    await ctrl.inactive(OWNER, { inactiveDays: 45, take: 10 });
    expect(analytics.inactiveNow.mock.calls[0]?.[1]).toBe(45);
    expect(analytics.inactiveNow.mock.calls[0]?.[2]).toMatchObject({ withList: false, take: 10 });
  });
});
