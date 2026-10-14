import { BadRequestException, type ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { STAFF_LOGIN_PATTERN } from '@takeaway/shared-types';

import { codedConflict } from '../../common/http/coded-conflict';
import type { PrismaService } from '../../prisma/prisma.service';

/** What a staff account is created with on the invite form. */
export interface NewLoginAccount {
  login: string;
  passwordHash: string;
  name: string | null;
  role: Prisma.UserCreateInput['role'];
}

/** Same answer whoever holds the login: no role, no name, no brand. */
export function loginInUse(): ConflictException {
  return codedConflict('LOGIN_IN_USE', 'This login is already taken. Pick another one.', 'login');
}

/**
 * Creates the account of someone invited by a login, and only ever a new
 * one. Unlike an email, a login proves nothing about who is behind it, so
 * an invite by login never attaches, re-roles or re-links an existing
 * account: a login anybody already has — as a login, or (from data older
 * than the format rule) as an email — is 409 LOGIN_IN_USE, as is losing a
 * race for it to a parallel invite.
 *
 * The password is the owner's temporary one, to be changed at the first
 * sign-in. There is no email, so nothing is sent.
 *
 * The DTO already lowercases and checks the login; the format is checked
 * again here because sign-in tells a login from an email by the '@' alone.
 */
export async function createLoginAccount(prisma: PrismaService, input: NewLoginAccount): Promise<{ id: string }> {
  if (!STAFF_LOGIN_PATTERN.test(input.login)) throw new BadRequestException('Invalid login');
  const taken = await prisma.user.findFirst({
    where: { OR: [{ login: input.login }, { email: input.login }] },
    select: { id: true },
  });
  if (taken) throw loginInUse();
  try {
    return await prisma.user.create({
      data: {
        login: input.login,
        passwordHash: input.passwordHash,
        passwordMustChange: true,
        name: input.name,
        role: input.role,
      },
      select: { id: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw loginInUse();
    throw err;
  }
}
