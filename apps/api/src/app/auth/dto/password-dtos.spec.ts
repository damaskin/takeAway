import { STAFF_PASSWORD_MAX_LENGTH, STAFF_PASSWORD_MIN_LENGTH } from '@takeaway/shared-types';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PasswordChangeSelfDto } from './password-change-self.dto';
import { PasswordResetDto } from './password-reset.dto';

/** What the global ValidationPipe does to a request body. */
async function invalid(type: new () => object, body: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(type, body), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property);
}

describe('new passwords follow the staff password rule the admin shows', () => {
  const shortest = 'x'.repeat(STAFF_PASSWORD_MIN_LENGTH);
  const longest = 'x'.repeat(STAFF_PASSWORD_MAX_LENGTH);

  it.each([
    ['change', PasswordChangeSelfDto, { currentPassword: 'temp-pass-1' }],
    ['reset', PasswordResetDto, { token: 'a'.repeat(32) }],
  ] as const)('%s: from the shortest to the longest allowed', async (_name, type, rest) => {
    expect(await invalid(type, { ...rest, newPassword: shortest })).toEqual([]);
    expect(await invalid(type, { ...rest, newPassword: longest })).toEqual([]);
    expect(await invalid(type, { ...rest, newPassword: shortest.slice(1) })).toEqual(['newPassword']);
    expect(await invalid(type, { ...rest, newPassword: `${longest}x` })).toEqual(['newPassword']);
  });
});
