import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { InviteStaffDto } from './admin-staff.dto';

const base = { role: 'STAFF', tempPassword: 'temporary-1', storeIds: ['store-1'] };

async function check(body: Record<string, unknown>): Promise<{ dto: InviteStaffDto; problems: string[] }> {
  const dto = plainToInstance(InviteStaffDto, { ...base, ...body });
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, problems: [...new Set(errors.map((e) => e.property))].sort() };
}

describe('InviteStaffDto — email or login', () => {
  it('takes an email', async () => {
    expect((await check({ email: 'anna@noname.md' })).problems).toEqual([]);
  });

  it('takes a login and stores it lowercase', async () => {
    const { dto, problems } = await check({ login: ' Anna.K_2-b ' });
    expect(problems).toEqual([]);
    expect(dto.login).toBe('anna.k_2-b');
  });

  it('takes at most one of them', async () => {
    expect((await check({ email: 'anna@noname.md', login: 'anna' })).problems).toEqual(['login']);
  });

  it('takes neither for kitchen staff, with a name and a 6-digit PIN instead of a password', async () => {
    const pinOnly = { role: 'STAFF', storeIds: ['store-1'] };
    const strict = async (body: Record<string, unknown>) => {
      const dto = plainToInstance(InviteStaffDto, body);
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      return [...new Set(errors.map((e) => e.property))].sort();
    };
    expect(await strict({ ...pinOnly, name: 'Ира', pin: '480317' })).toEqual([]);
    expect(await strict(pinOnly)).toEqual(['name', 'pin']);
    expect(await strict({ ...pinOnly, name: '  ', pin: '4803' })).toEqual(['name', 'pin']);
  });

  it('wants a temporary password with an email or a login, and takes a PIN with them too', async () => {
    const { problems } = await check({ email: 'anna@noname.md', tempPassword: undefined });
    expect(problems).toEqual(['tempPassword']);
    expect((await check({ login: 'anna.k', pin: '480317' })).problems).toEqual([]);
    expect((await check({ login: 'anna.k', pin: 'abcdef' })).problems).toEqual(['pin']);
  });

  it('keeps a login to 3–32 latin letters, digits, dots, underscores and hyphens — never an @', async () => {
    for (const login of ['an', 'a'.repeat(33), 'anna@noname', 'анна', 'anna k', 'anna+1']) {
      expect((await check({ login })).problems).toEqual(['login']);
    }
    expect((await check({ login: 'abc' })).problems).toEqual([]);
    expect((await check({ login: 'a'.repeat(32) })).problems).toEqual([]);
  });
});
