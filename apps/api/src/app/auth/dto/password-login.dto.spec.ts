import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PasswordLoginDto } from './password-login.dto';

async function problems(body: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(PasswordLoginDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('PasswordLoginDto', () => {
  it('takes an email or a login as the identifier', async () => {
    expect(await problems({ identifier: 'manager@noname.md', password: 'password-1' })).toEqual([]);
    expect(await problems({ identifier: 'anna.k', password: 'password-1' })).toEqual([]);
  });

  it('still takes the email field older clients send', async () => {
    expect(await problems({ email: 'manager@noname.md', password: 'password-1' })).toEqual([]);
    expect(await problems({ email: 'anna.k', password: 'password-1' })).toEqual(['email']);
  });

  it('wants one of them', async () => {
    expect(await problems({ password: 'password-1' })).toEqual(['identifier']);
    expect(await problems({ identifier: '', password: 'password-1' })).toEqual(['identifier']);
  });
});
