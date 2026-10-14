import { Role } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import type { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import type { AccountDeletionService } from './services/account-deletion.service';
import type { SignInMethodsService } from './services/sign-in-methods.service';
import type { TelegramService } from './services/telegram.service';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

interface Current {
  email: string | null;
  emailVerifiedAt?: Date | null;
  telegramUserId?: bigint | null;
  _count?: { oauthAccounts: number };
}

describe('PATCH /auth/me and the proven email', () => {
  function controller(currentEmail: string | null, extra: Omit<Current, 'email'> = {}) {
    const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ana', ...data }));
    const current: Current = { email: currentEmail, emailVerifiedAt: null, telegramUserId: null, ...extra };
    const prisma = {
      user: { findUnique: jest.fn(async () => current), update },
    };
    const auth = { toAuthUser: jest.fn((u: unknown) => u) };
    const ctrl = new AuthController(
      auth as unknown as AuthService,
      {} as UsersService,
      prisma as unknown as PrismaService,
      {} as TelegramService,
      {} as SignInMethodsService,
      {} as AccountDeletionService,
    );
    return { ctrl, update };
  }

  const ana: AuthenticatedUser = { id: 'ana', phone: null, email: null, name: 'Ana', role: Role.CUSTOMER };

  it('a newly typed address is a claim, not a proof', async () => {
    const { ctrl, update } = controller('ana@gmail.com');
    await ctrl.updateMe(ana, { email: 'Victim@Gmail.com' });
    expect(update.mock.calls[0]?.[0].data).toEqual({ email: 'victim@gmail.com', emailVerifiedAt: null });
  });

  it('saving the profile with the same address keeps it proven', async () => {
    const { ctrl, update } = controller('ana@gmail.com');
    await ctrl.updateMe(ana, { email: 'ana@gmail.com', name: 'Ana P.' });
    expect(update.mock.calls[0]?.[0].data).toEqual({ email: 'ana@gmail.com', name: 'Ana P.' });
  });

  it('leaves the proof alone when the email is not being changed', async () => {
    const { ctrl, update } = controller('ana@gmail.com');
    await ctrl.updateMe(ana, { name: 'Ana P.' });
    expect(update.mock.calls[0]?.[0].data).toEqual({ name: 'Ana P.' });
  });

  it('will not replace the proven address a customer signs in with by code when nothing else leads in', async () => {
    const { ctrl, update } = controller('ana@mail.ru', { emailVerifiedAt: new Date(), _count: { oauthAccounts: 0 } });

    await expect(ctrl.updateMe(ana, { email: 'ana.new@mail.ru' })).rejects.toMatchObject({
      response: { code: 'EMAIL_IS_SIGN_IN_METHOD' },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('lets staff change their address — they sign in with a password', async () => {
    const { ctrl, update } = controller('chef@cafe.md', { emailVerifiedAt: new Date(), _count: { oauthAccounts: 0 } });
    await ctrl.updateMe({ ...ana, role: Role.STAFF }, { email: 'chef2@cafe.md' });
    expect(update).toHaveBeenCalled();
  });

  it('lets the proven address change once Telegram or Google also leads in', async () => {
    const proven = { emailVerifiedAt: new Date(), _count: { oauthAccounts: 1 } };
    const { ctrl, update } = controller('ana@mail.ru', proven);
    await ctrl.updateMe(ana, { email: 'ana.new@mail.ru' });
    expect(update.mock.calls[0]?.[0].data).toEqual({ email: 'ana.new@mail.ru', emailVerifiedAt: null });

    const viaTelegram = controller('ana@mail.ru', { emailVerifiedAt: new Date(), telegramUserId: 777n });
    await viaTelegram.ctrl.updateMe(ana, { email: 'ana.new@mail.ru' });
    expect(viaTelegram.update).toHaveBeenCalled();
  });
});
