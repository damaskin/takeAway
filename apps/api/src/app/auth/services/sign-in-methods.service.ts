import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OAuthProvider, Prisma, Role, type User } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth.service';
import type { LinkSignInMethodResultDto, SignInMethodsDto } from '../dto/sign-in-methods.dto';
import { OAuthIdentityService, type OAuthProviderKey } from './oauth-identity.service';
import { TokensService } from './tokens.service';

/** A verified identity the signed-in customer wants to add to their profile. */
type LinkIdentity =
  | {
      kind: 'oauth';
      provider: OAuthProviderKey;
      providerUserId: string;
      email: string | null;
      emailVerified: boolean;
      name: string | null;
    }
  | { kind: 'telegram'; telegramUserId: bigint; name: string | null };

type Tx = Prisma.TransactionClient;

const LABEL: Record<OAuthProviderKey | 'TELEGRAM', string> = {
  GOOGLE: 'Google',
  APPLE: 'Apple',
  TELEGRAM: 'Telegram',
};

/**
 * One customer, several ways in. A customer who started in the Telegram
 * Mini App has no email, so signing in with Google or Apple on the phone
 * cannot find them by address and would open a second, empty profile. This
 * service lets the signed-in customer attach the other methods explicitly.
 *
 * When the method being attached already leads into another profile:
 *   - that profile has no orders → the method moves over to this one;
 *   - this profile has no orders → this profile's methods move over to that
 *     one, and the client receives a session for it (the customer ends up
 *     where their history is);
 *   - both have orders → refused. Joining two order histories, loyalty
 *     balances and saved cards is a support decision, not a button.
 *
 * Staff and admin accounts are left out on purpose: they sign in with a
 * password, and a social login must never become a way into one.
 */
@Injectable()
export class SignInMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: OAuthIdentityService,
    private readonly tokens: TokensService,
    private readonly auth: AuthService,
  ) {}

  async list(userId: string): Promise<SignInMethodsDto> {
    return this.methodsOf(this.prisma, userId);
  }

  async linkOAuth(
    userId: string,
    provider: OAuthProviderKey,
    idToken: string,
    fallbackName?: string | null,
  ): Promise<LinkSignInMethodResultDto> {
    const identity = await this.oauth.verify(provider, idToken);
    return this.link(userId, {
      kind: 'oauth',
      provider,
      providerUserId: identity.providerUserId,
      email: identity.email?.toLowerCase() ?? null,
      emailVerified: identity.emailVerified,
      name: identity.name ?? fallbackName ?? null,
    });
  }

  async linkTelegram(userId: string, idToken: string): Promise<LinkSignInMethodResultDto> {
    const identity = await this.oauth.verifyTelegram(idToken);
    const name = [identity.firstName, identity.lastName].filter(Boolean).join(' ').trim() || null;
    return this.link(userId, { kind: 'telegram', telegramUserId: BigInt(identity.id), name });
  }

  /**
   * Remove Google or Apple from the profile. Telegram is not removable: the
   * Mini App signs in by Telegram id without asking, so unlinking it would
   * quietly open a fresh, empty profile the next time the customer opens it.
   */
  async unlink(userId: string, provider: OAuthProviderKey): Promise<SignInMethodsDto> {
    return this.prisma.$transaction(async (tx) => {
      const methods = await this.methodsOf(tx, userId);
      const key = provider === 'GOOGLE' ? 'google' : 'apple';
      if (!methods[key]) return methods;
      const remaining = [methods.telegram, methods.google, methods.apple].filter(Boolean).length - 1;
      if (remaining < 1) {
        throw new BadRequestException(`${LABEL[provider]} is your only way to sign in — add another one first`);
      }
      await tx.oAuthAccount.deleteMany({ where: { userId, provider: OAuthProvider[provider] } });
      return this.methodsOf(tx, userId);
    });
  }

  private async link(userId: string, identity: LinkIdentity): Promise<LinkSignInMethodResultDto> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: userId } });
      if (!current) throw new NotFoundException('User not found');
      if (current.role !== Role.CUSTOMER) {
        throw new ForbiddenException(
          'Staff accounts sign in with a password and cannot link Google, Apple or Telegram here',
        );
      }

      const owner = await this.ownerOf(tx, identity);
      if (!owner) {
        await this.assertFreeSlot(tx, current, identity);
        await this.attach(tx, current, identity);
        return { userId: current.id, switched: null as User | null };
      }
      if (owner.id === current.id) return { userId: current.id, switched: null };

      const label = LABEL[identity.kind === 'oauth' ? identity.provider : 'TELEGRAM'];
      if (owner.role !== Role.CUSTOMER) {
        throw new ConflictException(`This ${label} account belongs to a staff account`);
      }

      const [ownerOrders, currentOrders] = await Promise.all([
        tx.order.count({ where: { userId: owner.id } }),
        tx.order.count({ where: { userId: current.id } }),
      ]);

      if (ownerOrders === 0) {
        // The other profile is empty: take the method away from it.
        await this.detach(tx, owner, identity);
        await this.assertFreeSlot(tx, current, identity);
        await this.attach(tx, current, identity);
        return { userId: current.id, switched: null };
      }

      if (currentOrders === 0) {
        if (owner.blockedAt) throw new ConflictException(`The profile behind this ${label} account is blocked`);
        // This profile is empty and the other has the history: move in there.
        await this.moveMethods(tx, current, owner);
        return { userId: owner.id, switched: owner };
      }

      throw new ConflictException(
        `This ${label} account already has its own profile with orders. Both profiles have order history, so they cannot be joined automatically — please contact support.`,
      );
    });

    const methods = await this.methodsOf(this.prisma, outcome.userId);
    if (!outcome.switched) return { methods };

    const target = await this.prisma.user.findUniqueOrThrow({ where: { id: outcome.userId } });
    const device = await this.prisma.device.create({
      data: { userId: target.id, type: 'WEB', locale: target.locale },
    });
    const tokens = await this.tokens.issue(target.id, device.id);
    return { methods, session: { ...tokens, user: this.auth.toAuthUser(target) } };
  }

  private async ownerOf(tx: Tx, identity: LinkIdentity): Promise<User | null> {
    if (identity.kind === 'telegram') {
      return tx.user.findUnique({ where: { telegramUserId: identity.telegramUserId } });
    }
    const link = await tx.oAuthAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: OAuthProvider[identity.provider],
          providerUserId: identity.providerUserId,
        },
      },
      include: { user: true },
    });
    return link?.user ?? null;
  }

  /** One account per provider keeps "which Google am I signed in with" answerable. */
  private async assertFreeSlot(tx: Tx, user: User, identity: LinkIdentity): Promise<void> {
    if (identity.kind === 'telegram') {
      if (user.telegramUserId !== null && user.telegramUserId !== identity.telegramUserId) {
        throw new ConflictException('A different Telegram account is already linked to this profile');
      }
      return;
    }
    const existing = await tx.oAuthAccount.findFirst({
      where: { userId: user.id, provider: OAuthProvider[identity.provider] },
    });
    if (existing && existing.providerUserId !== identity.providerUserId) {
      throw new ConflictException(
        `A different ${LABEL[identity.provider]} account is already linked — unlink it first`,
      );
    }
  }

  private async attach(tx: Tx, user: User, identity: LinkIdentity): Promise<void> {
    const data: Prisma.UserUpdateInput = {};
    if (identity.kind === 'telegram') {
      data.telegramUserId = identity.telegramUserId;
    } else {
      await tx.oAuthAccount.upsert({
        where: {
          provider_providerUserId: {
            provider: OAuthProvider[identity.provider],
            providerUserId: identity.providerUserId,
          },
        },
        update: {},
        create: {
          userId: user.id,
          provider: OAuthProvider[identity.provider],
          providerUserId: identity.providerUserId,
        },
      });
      // Fill a missing email from the provider, but only a verified one
      // that no other profile uses — the unique index would refuse it anyway.
      if (!user.email && identity.email && identity.emailVerified) {
        const taken = await tx.user.findUnique({ where: { email: identity.email } });
        if (!taken) data.email = identity.email;
      }
    }
    if (!user.name && identity.name) data.name = identity.name;
    if (Object.keys(data).length > 0) await tx.user.update({ where: { id: user.id }, data });
  }

  private async detach(tx: Tx, owner: User, identity: LinkIdentity): Promise<void> {
    if (identity.kind === 'telegram') {
      await tx.user.update({ where: { id: owner.id }, data: { telegramUserId: null } });
      return;
    }
    await tx.oAuthAccount.deleteMany({
      where: {
        userId: owner.id,
        provider: OAuthProvider[identity.provider],
        providerUserId: identity.providerUserId,
      },
    });
  }

  /** Every way into `from` becomes a way into `to`; `from` is left with none. */
  private async moveMethods(tx: Tx, from: User, to: User): Promise<void> {
    const [fromAccounts, toAccounts] = await Promise.all([
      tx.oAuthAccount.findMany({ where: { userId: from.id } }),
      tx.oAuthAccount.findMany({ where: { userId: to.id } }),
    ]);
    for (const account of fromAccounts) {
      const clash = toAccounts.find(
        (a) => a.provider === account.provider && a.providerUserId !== account.providerUserId,
      );
      if (clash) {
        throw new ConflictException(
          `The other profile already has a different ${LABEL[account.provider as OAuthProviderKey]} account linked`,
        );
      }
    }
    if (from.telegramUserId !== null && to.telegramUserId !== null && from.telegramUserId !== to.telegramUserId) {
      throw new ConflictException('The other profile already has a different Telegram account linked');
    }

    await tx.oAuthAccount.updateMany({ where: { userId: from.id }, data: { userId: to.id } });

    const { telegramUserId, email, name } = from;
    const moveTelegram = telegramUserId !== null && to.telegramUserId === null;
    const moveEmail = email !== null && to.email === null;
    if (moveTelegram || moveEmail) {
      // Clear the unique columns on `from` first, or `to` cannot take them.
      await tx.user.update({
        where: { id: from.id },
        data: {
          ...(moveTelegram ? { telegramUserId: null } : {}),
          ...(moveEmail ? { email: null } : {}),
        },
      });
      await tx.user.update({
        where: { id: to.id },
        data: {
          ...(moveTelegram ? { telegramUserId } : {}),
          ...(moveEmail ? { email } : {}),
          ...(!to.name && name ? { name } : {}),
        },
      });
    }
  }

  private async methodsOf(client: Tx | PrismaService, userId: string): Promise<SignInMethodsDto> {
    const user = await client.user.findUnique({
      where: { id: userId },
      select: { telegramUserId: true, oauthAccounts: { select: { provider: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    const providers = new Set(user.oauthAccounts.map((a) => a.provider));
    return {
      telegram: user.telegramUserId !== null,
      google: providers.has(OAuthProvider.GOOGLE),
      apple: providers.has(OAuthProvider.APPLE),
    };
  }
}
