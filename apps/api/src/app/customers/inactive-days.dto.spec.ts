import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { InactiveNowQueryDto, RetentionQueryDto } from '../analytics/dto/analytics-query.dto';
import { CreateCampaignDto, UpdateCampaignDto } from '../campaigns/dto/campaigns.dto';
import { CreatePromoDto, UpdatePromoDto } from '../promo/dto/promo.dto';
import { CustomersQueryDto } from './dto/customers.dto';

/**
 * One inactivity threshold everywhere (owner, 2026-11-18): every request
 * that carries it takes any whole number of days from 1 to 365 — the 7 / 14
 * / 30 / 90 presets, a custom number, and the 3 of older links, campaigns
 * and promo codes — and nothing outside that.
 */
const DTOS: Array<[string, new () => object, string]> = [
  ['customers list', CustomersQueryDto, 'inactiveDays'],
  ['dashboard card', InactiveNowQueryDto, 'inactiveDays'],
  ['churn and win-back', RetentionQueryDto, 'window'],
  ['new campaign', CreateCampaignDto, 'inactiveDays'],
  ['campaign edit', UpdateCampaignDto, 'inactiveDays'],
  ['new promo code', CreatePromoDto, 'inactiveDays'],
  ['promo code edit', UpdatePromoDto, 'inactiveDays'],
];

async function rejects(dto: new () => object, field: string, value: unknown): Promise<boolean> {
  // As the global pipe reads a query string or a body.
  const instance = plainToInstance(dto, { [field]: value }, { enableImplicitConversion: true });
  const errors = await validate(instance);
  return errors.some((e) => e.property === field);
}

describe.each(DTOS)('%s — the inactivity threshold', (_name, dto, field) => {
  it.each([3, 7, 14, 30, 45, 90, 365, '30'])('takes %p', async (value) => {
    await expect(rejects(dto, field, value)).resolves.toBe(false);
  });

  it.each([0, -1, 366, 7.5, 'abc'])('refuses %p', async (value) => {
    await expect(rejects(dto, field, value)).resolves.toBe(true);
  });
});
