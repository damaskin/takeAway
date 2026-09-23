import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { BusinessRegisterDto } from './business-register.dto';

/** What the global ValidationPipe does to a request body. */
async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(BusinessRegisterDto, body);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, invalid: errors.map((e) => e.property) };
}

const valid = {
  brandName: 'Кофейня Ромашка',
  ownerName: 'Ion',
  email: 'owner@romashka.md',
  password: 'correct-horse',
  currency: 'MDL',
  locale: 'RU',
};

describe('BusinessRegisterDto', () => {
  it.each([
    ['+373 69 123-456', '+37369123456'],
    ['+373 (69) 12-34-56', '+37369123456'],
    ['0037369123456', '+37369123456'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('accepts %s as %s', async (typed, stored) => {
    const { dto, invalid } = await check({ ...valid, phone: typed });

    expect(invalid).toEqual([]);
    expect(dto.phone).toBe(stored);
  });

  it.each(['069123456', '+0 69 123 456', '+373', 'call me'])(
    'refuses %s: no country code, or not a number',
    async (typed) => {
      const { invalid } = await check({ ...valid, phone: typed });

      expect(invalid).toEqual(['phone']);
    },
  );

  it('treats an empty phone as no phone', async () => {
    const { dto, invalid } = await check({ ...valid, phone: '  ' });

    expect(invalid).toEqual([]);
    expect(dto.phone).toBeUndefined();
  });

  it('requires a currency and a language instead of defaulting to USD and English', async () => {
    const { currency: _currency, locale: _locale, ...rest } = valid;

    const { invalid } = await check(rest);

    expect(invalid.sort()).toEqual(['currency', 'locale']);
  });

  it('accepts the Transnistrian rouble and refuses a made-up currency', async () => {
    await expect(check({ ...valid, currency: 'RUP' })).resolves.toEqual(expect.objectContaining({ invalid: [] }));
    await expect(check({ ...valid, currency: 'XYZ' })).resolves.toEqual(
      expect.objectContaining({ invalid: ['currency'] }),
    );
  });
});
