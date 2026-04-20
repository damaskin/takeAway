import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, type User } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type { AuthSessionDto, AuthUserDto } from './dto/auth-response.dto';
import { MailService } from './services/mail.service';
import { PasswordService } from './services/password.service';
import { TelegramService, type TelegramLoginWidgetPayload, type TelegramUser } from './services/telegram.service';
import { TokensService } from './services/tokens.service';

const PASSWORD_RESET_TTL_SECONDS = 60 * 60; // 1 hour

// Roles that can authenticate with email+password. CUSTOMER is always
// Telegram-driven — they never set a password, and we refuse the login flow
// for them outright even if a hash existed.
const PASSWORD_LOGIN_ROLES: ReadonlySet<Role> = new Set([
  Role.SUPER_ADMIN,
  Role.BRAND_ADMIN,
  Role.STORE_MANAGER,
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
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Staff / admin sign-in with email + password. Customer accounts are
   * rejected even if a password hash is somehow present — they must use
   * Telegram on web / TMA.
   */
  async loginWithPassword(email: string, password: string): Promise<AuthSessionDto> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Same error for "no user" and "bad password" to avoid email-enumeration.
    const generic = new UnauthorizedException('Invalid email or password');
    if (!user || !user.passwordHash) throw generic;
    if (!PASSWORD_LOGIN_ROLES.has(user.role)) throw generic;
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
   * Self-service password change for an authenticated staff user. Verifies
   * the current password before setting the new one; clears the
   * `passwordMustChange` flag on success.
   */
  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Account has no password set');
    if (!PASSWORD_LOGIN_ROLES.has(user.role)) throw new UnauthorizedException('Account cannot change password here');

    const ok = await this.passwords.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const hash = await this.passwords.hash(newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash, passwordMustChange: false },
    });
  }

  /**
   * Issues a reset token for the given email. Always returns the same shape
   * even if the email is unknown — clients show a generic "if the address
   * exists we emailed a link" so attackers can't enumerate accounts.
   */
  async requestPasswordReset(email: string): Promise<void> {
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

    const base = this.config.get<string>('ADMIN_APP_URL') ?? 'http://localhost:4202';
    const resetUrl = `${base.replace(/\/$/, '')}/reset-password?token=${raw}`;
    await this.mail.sendPasswordReset(user.email ?? email, resetUrl);
  }

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
  }

  /**
   * Link the current (email+password) user to a Telegram chat ID via a
   * Login Widget callback. Used by admin/KDS staff to receive push
   * notifications. Unlike the sign-in path, we do NOT create a new user
   * or issue tokens — we just write `telegramUserId` onto the existing
   * row.
   */
  async linkTelegram(userId: string, payload: TelegramLoginWidgetPayload): Promise<AuthUserDto> {
    const tgUser = this.telegram.verifyLoginWidget(payload);
    const telegramUserId = BigInt(tgUser.id);

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

    const device = await this.prisma.device.create({
      data: { userId: user.id, type: deviceType, locale: user.locale },
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
      name: user.name,
      locale: user.locale,
      currency: user.currency,
      role: user.role,
      telegramUserId: user.telegramUserId?.toString() ?? null,
    };
  }
}
