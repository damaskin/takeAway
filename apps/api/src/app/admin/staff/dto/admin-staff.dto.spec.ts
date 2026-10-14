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

  it('wants exactly one of them', async () => {
    expect((await check({})).problems).toEqual(['email', 'login']);
    expect((await check({ email: 'anna@noname.md', login: 'anna' })).problems).toEqual(['login']);
  });

  it('keeps a login to 3–32 latin letters, digits, dots, underscores and hyphens — never an @', async () => {
    for (const login of ['an', 'a'.repeat(33), 'anna@noname', 'анна', 'anna k', 'anna+1']) {
      expect((await check({ login })).problems).toEqual(['login']);
    }
    expect((await check({ login: 'abc' })).problems).toEqual([]);
    expect((await check({ login: 'a'.repeat(32) })).problems).toEqual([]);
  });
});
