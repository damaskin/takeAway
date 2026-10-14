import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Locale, OAuthProvider, Prisma, Role, type User } from '@prisma/client';

import { adminAppUrl } from '../common/config/admin-app-url';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type { AuthSessionDto, AuthUserDto } from './dto/auth-response.dto';
import { KDS_PIN_LEGACY_SENTINEL_PREFIX, KdsPinService } from './services/kds-pin.service';
import { KitchenDeviceService, unknownDevice } from './services/kitchen-device.service';
import {
  OAuthIdentityService,
  type OAuthIdentity,
  type OAuthProviderKey,
  type TelegramIdentity,
} from './services/oauth-identity.service';
import { PasswordService } from './services/password.service';
import { TelegramService, type TelegramLoginWidgetPayload, type TelegramUser } from './services/telegram.service';
import { TokensService } from './services/tokens.service';

const PASSWORD_RESET_TTL_SECONDS = 60 * 60; // 1 hour

// Roles that can authenticate with email+password. Customers never set a
// password — they sign in with Telegram, Google or Apple — so we refuse the
// login flow for them outright even if a hash somehow existed.
const PASSWORD_LOGIN_ROLES: ReadonlySet<Role> = new Set([
  Role.SUPER_ADMIN,
  Role.BRAND_ADMIN,
  Role.STORE_MANAGER,
  Role.MENU_EDITOR,
  Role.STAFF,
  Role.RIDER,
]);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly tokens: TokensService,
    private readonly telegram: TelegramService,
    private readonly oauth: OAuthIdentityService,
    private readonly passwords: PasswordService,
    private readonly kdsPins: KdsPinService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly kitchenDevices: KitchenDeviceService,
  ) {}

  /**
   * Staff / admin sign-in with an email or a staff login, and a password.
   * An email always has an '@' and a login never does, so the identifier
   * says which column to look in. Customer accounts are rejected even if a
   * password hash is somehow present — they sign in with Telegram, Google
   * or Apple.
   */
  async loginWithPassword(identifier: string, password: string): Promise<AuthSessionDto> {
    const key = identifier.trim().toLowerCase();
    const user = key
      ? await this.prisma.user.findUnique({ where: key.includes('@') ? { email: key } : { login: key } })
      : null;
    // Same error for "no user" and "bad password" to avoid enumerating
    // emails or logins.
    const generic = new UnauthorizedException('Invalid email, login or password');
    if (!user || !user.passwordHash || !PASSWORD_LOGIN_ROLES.has(user.role)) {
      await this.passwords.compareWithoutAccount(password);
      throw generic;
    }
    if (user.blockedAt) throw new UnauthorizedException('Account is blocked');

    const ok = await this.passwords.compare(password, user.passwordHash);
    if (!ok) throw generic;

    const device = await this.prisma.device.create({
      data: { userId: user.id, type: 'WEB', locale: user.locale },
    });
    const tokens = await this.tokens.issue(user.id, device.id);
    const session: AuthSessionDto = { ...tokens, user: this.toAuthUser(user) };
    if (user.passwordMustChange) {
      session.mustChangePassword = true;
    }
    return session;
  }

  /**
   * KDS PIN login, from the kitchen tablet's lockscreen: a short numeric PIN
   * scoped to one store, accepted only from a tablet bound to that store's
   * brand (see KitchenDeviceService). Returns the same shape as the password
   * login so the admin reuses its JWT/refresh wiring, but the session is
   * narrowed to the store: it opens that store's kitchen board and
   * stop-list and nothing else (KdsSessionGuard).
   *
   * Order matters: the tablet is checked before any PIN is counted, so
   * nobody outside the brand's tablets can run up a store's failures, and
   * failures are counted per store *and* tablet (KdsPinService).
   */
  async loginWithKdsPin(storeId: string, pin: string, deviceToken?: string): Promise<AuthSessionDto> {
    const generic = new UnauthorizedException('Invalid PIN');
    // No secret, no PIN sign-in: 503 KDS_PIN_NOT_CONFIGURED before anything
    // touches the database.
    this.kdsPins.assertConfigured();
    if (!deviceToken) {
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        error: 'Unauthorized',
        code: 'KDS_DEVICE_REQUIRED',
        message: 'This tablet is not bound to a business yet',
      });
    }
    const tablet = await this.kitchenDevices.resolve(deviceToken);
    if (!tablet) throw unknownDevice();
    if (!this.kdsPins.isValidFormat(pin)) throw generic;

    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { brandId: true } });
    // A store of another brand is not on this tablet's picker; refuse it
    // without counting a failure against anyone.
    if (!store || store.brandId !== tablet.brandId) throw generic;
    await this.kdsPins.assertNotLocked(storeId, tablet.id);

    const expected = this.kdsPins.hash(storeId, pin);
    const user = await this.prisma.user.findFirst({
      where: {
        kdsPinStoreId: storeId,
        kdsPinHash: expected,
        // Placeholders written by an older build without a secret matched
        // any PIN. They can't equal an HMAC, but never let one through.
        NOT: { kdsPinHash: { startsWith: KDS_PIN_LEGACY_SENTINEL_PREFIX } },
      },
    });
    if (!user || !this.kdsPins.isUsableHash(user.kdsPinHash)) {
      await this.kdsPins.recordFailure(storeId, tablet.id);
      throw generic;
    }
    if (user.blockedAt) throw new UnauthorizedException('Account is blocked');
    // PIN holders must be operational staff — no SUPER_ADMIN / BRAND_ADMIN PINs
    // (those roles use email+password from the admin app, not the tablet).
    if (user.role !== Role.STORE_MANAGER && user.role !== Role.STAFF) throw generic;
    // A PIN typed at one brand's tablet must open nothing beyond that brand.
    // The session is narrowed to this store anyway (KdsSessionGuard); on top
    // of that an account no longer at this store, or working for several
    // brands, signs in with email and password instead.
    if (!(await this.staysWithinPinBrand(user.id, storeId))) {
      this.logger.warn(`KDS PIN sign-in refused: user ${user.id} reaches beyond the brand of store ${storeId}`);
      throw generic;
    }
    await this.kdsPins.clearFailures(storeId, tablet.id);
    await this.kitchenDevices.touch(tablet.id);

    const device = await this.prisma.device.create({
      data: { userId: user.id, type: 'WEB', locale: user.locale },
    });
    const tokens = await this.tokens.issue(user.id, device.id, { kdsStoreId: storeId });
    return { ...tokens, user: this.toAuthUser(user), kdsStoreId: storeId };
  }

  /** True when the user works at `storeId` and every store they work at is of that store's brand. */
  private async staysWithinPinBrand(userId: string, storeId: string): Promise<boolean> {
    const links = await this.prisma.userStore.findMany({
      where: { userId },
      select: { storeId: true, store: { select: { brandId: true } } },
    });
    const here = links.find((l) => l.storeId === storeId);
    return !!here && links.every((l) => l.store.brandId === here.store.brandId);
  }

  /**
   * Self-service password change for an authenticated staff user. Verifies
   * the current password before setting the new one; clears the
   * `passwordMustChange` flag on success.
   *
   * A new password is how someone locks out whoever learnt the old one, so
   * every other session ends: their refresh tokens are revoked, and their
   * access tokens run out within minutes. `keepRefreshToken` (the session
   * making the change) stays valid, so that person is not signed out too.
   *
   * A wrong current password is a 401 `CURRENT_PASSWORD_INCORRECT`; a new
   * password equal to the current one — the temporary password typed twice
   * on the first sign-in — is a 400 `PASSWORD_UNCHANGED`, so it cannot pass
   * for a change.
   */
  async changeOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    keepRefreshToken?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Account has no password set');
    if (!PASSWORD_LOGIN_ROLES.has(user.role)) throw new UnauthorizedException('Account cannot change password here');

    const ok = await this.passwords.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        error: 'Unauthorized',
        code: 'CURRENT_PASSWORD_INCORRECT',
        message: 'Current password is incorrect',
      });
    }
    if (newPassword === currentPassword) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        code: 'PASSWORD_UNCHANGED',
        message: 'The new password has to differ from the current one',
      });
    }

    const hash = await this.passwords.hash(newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash, passwordMustChange: false },
    });
    await this.tokens.revokeAll(user.id, keepRefreshToken);
  }

  /**
   * Issues a reset token for the given email. Always returns the same shape
   * even if the email is unknown — clients show a generic "if the address
   * exists we emailed a link" so attackers can't enumerate accounts.
   *
   * Except when no email can leave this server at all: without SMTP, or in
   * production without ADMIN_APP_URL for the link, the request used to
   * answer 204 and the page said "check your inbox" for a letter that was
   * never sent. Now it answers 503 `PASSWORD_RESET_UNAVAILABLE` up front —
   * the same for every address, so it tells nothing about accounts.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const base = adminAppUrl(this.config);
    const mailReady = this.mail.isConfigured();
    if (!mailReady || !base) {
      const missing = [mailReady ? null : 'SMTP_HOST', base ? null : 'ADMIN_APP_URL'].filter(Boolean).join(', ');
      this.logger.error(`Password reset requested, but no reset email can be sent: ${missing} not set`);
      throw new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Service Unavailable',
        code: 'PASSWORD_RESET_UNAVAILABLE',
        message: 'Password reset by email is not available on this server',
      });
    }

    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !PASSWORD_LOGIN_ROLES.has(user.role)) {
      this.logger.debug(`Password reset requested for unknown/non-staff email: ${email}`);
      return;
    }

    const { raw, hash } = this.passwords.issueResetToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000),
      },
    });

    const resetUrl = `${base}/reset-password?token=${raw}`;
    await this.mail.sendPasswordReset(user.email ?? email, resetUrl);
  }

  /**
   * Sets a new password from an emailed link and signs the account out
   * everywhere: a reset is what someone does when they think the old
   * password, or a device, is in the wrong hands.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const hash = this.passwords.hashResetToken(token);
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hash } });
    if (!record || record.consumedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Reset link is invalid or has expired');
    }

    const newHash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: newHash, passwordMustChange: false },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
    ]);
    await this.tokens.revokeAll(record.userId);
  }

  /**
   * Link the current (email+password) user to a Telegram chat ID via a
   * Login Widget callback. Used by admin/KDS staff to receive push
   * notifications. Unlike the sign-in path, we do NOT create a new user
   * or issue tokens — we just write `telegramUserId` onto the existing
   * row.
   */
  async linkTelegram(userId: string, payload: TelegramLoginWidgetPayload): Promise<AuthUserDto> {
    return this.linkTelegramUserId(userId, this.telegram.verifyLoginWidget(payload).id);
  }

  /** Same as {@link linkTelegram}, from a Telegram Login (OpenID Connect) ID token. */
  async linkTelegramIdToken(userId: string, idToken: string): Promise<AuthUserDto> {
    const identity = await this.oauth.verifyTelegram(idToken);
    return this.linkTelegramUserId(userId, identity.id);
  }

  private async linkTelegramUserId(userId: string, id: number): Promise<AuthUserDto> {
    const telegramUserId = BigInt(id);

    const existing = await this.prisma.user.findUnique({ where: { telegramUserId } });
    if (existing && existing.id !== userId) {
      throw new BadRequestException('This Telegram account is already linked to another user');
    }

    const user = await this.prisma.user.update({ where: { id: userId }, data: { telegramUserId } });
    return this.toAuthUser(user);
  }

  verifyTelegram(initData: string): Promise<AuthSessionDto> {
    const { user: tgUser } = this.telegram.verifyInitData(initData);
    return this.finalizeTelegramSignIn(tgUser, 'TELEGRAM');
  }

  verifyTelegramWidget(payload: TelegramLoginWidgetPayload): Promise<AuthSessionDto> {
    const tgUser = this.telegram.verifyLoginWidget(payload);
    // The widget is loaded on the web site, so record the device as WEB
    // rather than TELEGRAM — the Mini App path keeps TELEGRAM for its own
    // device rows.
    return this.finalizeTelegramSignIn(tgUser, 'WEB');
  }

  /**
   * Telegram Login (OpenID Connect): the web library's popup and the mobile
   * apps both end with an ID token Telegram signed for our bot. It lands on
   * the same `telegramUserId` as the Mini App and the legacy widget, so a
   * customer keeps one profile whichever way they come in.
   */
  async loginWithTelegramIdToken(idToken: string): Promise<AuthSessionDto> {
    const identity: TelegramIdentity = await this.oauth.verifyTelegram(idToken);
    return this.finalizeTelegramSignIn(
      {
        id: identity.id,
        first_name: identity.firstName ?? undefined,
        last_name: identity.lastName ?? undefined,
        username: identity.username ?? undefined,
      },
      'WEB',
    );
  }

  /**
   * Shared tail of both Telegram sign-in paths (Mini App init-data + Login
   * Widget). Keys the user on `telegramUserId`.
   */
  private async finalizeTelegramSignIn(tgUser: TelegramUser, deviceType: 'TELEGRAM' | 'WEB'): Promise<AuthSessionDto> {
    const displayName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ').trim() || null;
    const locale = tgUser.language_code?.toLowerCase().startsWith('ru') ? 'RU' : 'EN';

    const user = await this.prisma.user.upsert({
      where: { telegramUserId: BigInt(tgUser.id) },
      update: {
        name: displayName ?? undefined,
      },
      create: {
        telegramUserId: BigInt(tgUser.id),
        name: displayName,
        locale,
      },
    });
    // Blocking has to hold on every door: Google and Apple already refused a
    // blocked account, Telegram used to hand it a fresh session.
    if (user.blockedAt) throw new UnauthorizedException('Account is blocked');

    const device = await this.prisma.device.create({
      data: { userId: user.id, type: deviceType, locale: user.locale },
    });

    const tokens = await this.tokens.issue(user.id, device.id);
    return { ...tokens, user: this.toAuthUser(user) };
  }

  /**
   * Customer sign-in with Google or Apple. The client obtains an OpenID
   * Connect ID token from the provider's SDK and posts it here; we verify
   * the signature, issuer and audience before trusting a single claim.
   *
   * `fallbackName` only matters for Apple, which reveals the user's name
   * exactly once — in the first authorization response, never in the token.
   */
  async loginWithOAuth(
    provider: OAuthProviderKey,
    idToken: string,
    fallbackName?: string | null,
  ): Promise<AuthSessionDto> {
    const identity = await this.oauth.verify(provider, idToken);
    return this.finalizeOAuthSignIn(identity, fallbackName ?? null);
  }

  /**
   * Resolve the identity to a user and issue a session. Three paths, in
   * order:
   *
   *   1. We have seen this provider subject before — sign that user in.
   *   2. The provider vouches for an email that a profile here has *also
   *      proven* (`emailVerifiedAt`) — link the social account to it, so a
   *      customer who signed up with Google and later taps "Continue with
   *      Apple" lands in the same profile instead of a duplicate with an
   *      empty order history.
   *   3. Otherwise create a fresh customer.
   *
   * Case 2 deliberately refuses staff and admin accounts. Those sign in
   * with email + password on purpose, and letting a social login walk into
   * one would mean anyone who can create a Google account on the brand's
   * domain inherits its privileges.
   *
   * Case 2 also refuses an address that was only typed into a profile
   * (PATCH /auth/me). It used to accept it, so anyone could put a victim's
   * address on their own profile and wait: the victim's first Google sign-in
   * then landed in the attacker's profile, which the attacker still controls
   * through Telegram. The verified sign-in now gets a profile of its own and
   * takes the address with it — the provider has just proven who owns it,
   * the other profile never did.
   */
  private async finalizeOAuthSignIn(identity: OAuthIdentity, fallbackName: string | null): Promise<AuthSessionDto> {
    const provider = OAuthProvider[identity.provider];
    const name = identity.name ?? fallbackName;
    const email = identity.email?.toLowerCase() ?? null;
    const verifiedEmail = email && identity.emailVerified ? email : null;
    const locale = identity.locale?.toLowerCase().startsWith('ru') ? Locale.RU : Locale.EN;
    const now = new Date();

    const user = await this.prisma.$transaction(async (tx) => {
      const link = await tx.oAuthAccount.findUnique({
        where: {
          provider_providerUserId: { provider, providerUserId: identity.providerUserId },
        },
        include: { user: true },
      });
      if (link) {
        const data: Prisma.UserUpdateInput = {};
        // Backfill a name only while we have none — never overwrite one the
        // customer edited in their profile.
        if (name && !link.user.name) data.name = name;
        // The provider vouches for the address on the profile: from now on
        // it counts as proven.
        if (verifiedEmail && link.user.email === verifiedEmail && !link.user.emailVerifiedAt) {
          data.emailVerifiedAt = now;
        }
        return Object.keys(data).length > 0 ? tx.user.update({ where: { id: link.userId }, data }) : link.user;
      }

      let storedEmail: string | null = null;
      if (verifiedEmail) {
        const byEmail = await tx.user.findUnique({ where: { email: verifiedEmail } });
        if (byEmail) {
          if (byEmail.role !== Role.CUSTOMER) {
            throw new UnauthorizedException('This email belongs to a staff account — sign in with your password');
          }
          if (byEmail.emailVerifiedAt) {
            await tx.oAuthAccount.create({
              data: { userId: byEmail.id, provider, providerUserId: identity.providerUserId },
            });
            return name && !byEmail.name ? tx.user.update({ where: { id: byEmail.id }, data: { name } }) : byEmail;
          }
          // Only typed in over there, never proven: release it.
          await tx.user.update({ where: { id: byEmail.id }, data: { email: null } });
          this.logger.warn(
            `${identity.provider} sign-in proved an email that profile ${byEmail.id} had only typed in; ` +
              'the address moved to a new profile instead of joining that one',
          );
        }
        storedEmail = verifiedEmail;
      } else if (email) {
        // An address the provider does not vouch for is kept for receipts
        // when nobody else has it, and never counts as proven.
        const taken = await tx.user.findUnique({ where: { email }, select: { id: true } });
        if (!taken) storedEmail = email;
      }

      return tx.user.create({
        data: {
          email: storedEmail,
          emailVerifiedAt: verifiedEmail ? now : null,
          name,
          locale,
          oauthAccounts: { create: { provider, providerUserId: identity.providerUserId } },
        },
      });
    });

    if (user.blockedAt) throw new UnauthorizedException('Account is blocked');

    const device = await this.prisma.device.create({
      data: { userId: user.id, type: 'WEB', locale: user.locale },
    });
    const tokens = await this.tokens.issue(user.id, device.id);
    return { ...tokens, user: this.toAuthUser(user) };
  }

  refresh(refreshToken: string): Promise<Awaited<ReturnType<TokensService['rotate']>>> {
    return this.tokens.rotate(refreshToken);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokens.revokeRefresh(refreshToken);
  }

  toAuthUser(user: User): AuthUserDto {
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      login: user.login,
      name: user.name,
      locale: user.locale,
      currency: user.currency,
      role: user.role,
      telegramUserId: user.telegramUserId?.toString() ?? null,
    };
  }
}
