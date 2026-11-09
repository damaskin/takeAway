import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PasswordResetController } from '../password-reset.controller';
import type { PasswordResetService } from '../services/password-reset.service';
import { PasswordForgotDto } from './password-forgot.dto';

async function problems(body: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(PasswordForgotDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('PasswordForgotDto', () => {
  it('takes what the staff sign in with: an email or a login', async () => {
    expect(await problems({ identifier: 'owner@noname.md' })).toEqual([]);
    expect(await problems({ identifier: 'ion.barista' })).toEqual([]);
  });

  it('still takes the email field cached admin bundles send', async () => {
    expect(await problems({ email: 'owner@noname.md' })).toEqual([]);
    expect(await problems({ email: 'ion.barista' })).toEqual(['email']);
  });

  it('wants one of them', async () => {
    expect(await problems({})).toEqual(['identifier']);
    expect(await problems({ identifier: '' })).toEqual(['identifier']);
    expect(await problems({ identifier: 'x'.repeat(255) })).toEqual(['identifier']);
  });
});

describe('PasswordResetController.forgot', () => {
  it('asks for the identifier, else the legacy email', async () => {
    const request = jest.fn(async () => ({ channels: ['telegram' as const], linkTtlMinutes: 60 }));
    const controller = new PasswordResetController({ request } as unknown as PasswordResetService);

    await controller.forgot({ identifier: 'ion.barista', email: 'owner@noname.md' });
    await controller.forgot({ email: 'owner@noname.md' });

    expect(request.mock.calls).toEqual([['ion.barista'], ['owner@noname.md']]);
  });
});
