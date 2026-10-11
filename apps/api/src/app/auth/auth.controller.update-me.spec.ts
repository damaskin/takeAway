import { Role } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import type { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import type { AccountDeletionService } from './services/account-deletion.service';
import type { SignInMethodsService } from './services/sign-in-methods.service';
import type { TelegramService } from './services/telegram.service';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

describe('PATCH /auth/me and the proven email', () => {
  function controller(currentEmail: string | null) {
    const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ana', ...data }));
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ email: currentEmail })), update },
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
});
