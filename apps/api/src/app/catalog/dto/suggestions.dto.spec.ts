import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MAX_IN_HAND, SuggestionsQueryDto } from './suggestions.dto';

/** The query as the global ValidationPipe reads it. */
async function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(SuggestionsQueryDto, query, { enableImplicitConversion: true });
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, errors: errors.map((e) => e.property) };
}

describe('SuggestionsQueryDto', () => {
  it('reads comma-separated ids and repeated parameters alike', async () => {
    await expect(parse({ productIds: 'a, b,,c' })).resolves.toMatchObject({
      dto: { productIds: ['a', 'b', 'c'] },
      errors: [],
    });
    await expect(parse({ productIds: ['a', 'b,c'] })).resolves.toMatchObject({
      dto: { productIds: ['a', 'b', 'c'] },
      errors: [],
    });
  });

  it('takes no ids at all', async () => {
    await expect(parse({})).resolves.toMatchObject({ errors: [] });
    await expect(parse({ productIds: '' })).resolves.toMatchObject({ dto: { productIds: [] }, errors: [] });
  });

  it('refuses too many ids, an overlong one and a limit out of range', async () => {
    const many = Array.from({ length: MAX_IN_HAND + 1 }, (_, i) => `p${i}`).join(',');
    expect((await parse({ productIds: many })).errors).toEqual(['productIds']);
    expect((await parse({ productIds: 'x'.repeat(65) })).errors).toEqual(['productIds']);
    expect((await parse({ limit: '0' })).errors).toEqual(['limit']);
    expect((await parse({ limit: '13' })).errors).toEqual(['limit']);
    await expect(parse({ limit: '4' })).resolves.toMatchObject({ dto: { limit: 4 }, errors: [] });
  });
});
