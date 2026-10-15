import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateBrandDto, UpdateBrandDto } from './admin-brand.dto';

/** What the global ValidationPipe does to a request body. */
async function check<T extends object>(type: new () => T, body: Record<string, unknown>) {
  const dto = plainToInstance(type, body, { enableImplicitConversion: true });
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, invalid: errors.map((e) => e.property) };
}

describe('UpdateBrandDto — the contact phone can be changed, not removed', () => {
  it('takes a new number in any common format and stores E.164', async () => {
    const { dto, invalid } = await check(UpdateBrandDto, { contactPhone: '069 123 456' });

    expect(invalid).toEqual([]);
    expect(dto.contactPhone).toBe('+37369123456');
  });

  it.each([null, '', '   '])('refuses %j instead of clearing the number', async (contactPhone) => {
    const { invalid } = await check(UpdateBrandDto, { contactPhone });

    expect(invalid).toEqual(['contactPhone']);
  });

  it('refuses what is not a phone number', async () => {
    const { invalid } = await check(UpdateBrandDto, { contactPhone: 'call me' });

    expect(invalid).toEqual(['contactPhone']);
  });

  it('leaves the number alone when the change is about something else', async () => {
    const { dto, invalid } = await check(UpdateBrandDto, { name: 'Ромашка' });

    expect(invalid).toEqual([]);
    expect(dto.contactPhone).toBeUndefined();
  });
});

describe('CreateBrandDto', () => {
  it('normalises the contact phone like sign-up does', async () => {
    const { dto, invalid } = await check(CreateBrandDto, {
      slug: 'romashka',
      name: 'Ромашка',
      contactPhone: '+373 (69) 12-34-56',
    });

    expect(invalid).toEqual([]);
    expect(dto.contactPhone).toBe('+37369123456');
  });
});
