import { BadRequestException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PasswordForgotResponse, PasswordResetChannel } from '@takeaway/shared-types';

import { adminAppUrl } from '../../common/config/admin-app-url';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { TelegramBotApi } from '../../telegram-bot/telegram-bot-api.service';
import { passwordResetTelegramMessage } from './password-reset-message';
import { PASSWORD_LOGIN_ROLES, PasswordService } from './password.service';
import { TokensService } from './tokens.service';

/** How long a reset link works — the same link by email and in Telegram. */
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

/**
 * One reset message per account per this many seconds, whoever asks and
 * from wherever: the per-client limit alone would let a few addresses keep
 * a person's inbox and Telegram busy with links they did not ask for.
 */
export const PASSWORD_RESET_COOLDOWN_SECONDS = 60;

const INVALID_LINK = 'Reset link is invalid or has expired';

/** Where one account's link goes; null where it has no such channel or the server has none. */
interface Delivery {
  userId: string;
  url: string;
  account: string;
  email: string | null;
  chatId: bigint | null;
}

/**
 * «Забыли пароль?» for staff, owners and platform admins: a one-time link
 * to set a new password, so nobody has to ask the takeAway team for one.
 *
 * The link goes to every channel the account has: its email (when SMTP is
 * configured) and the Telegram chat it linked for work notifications (when
 * the bot is). Both carry the same token, so using one of them uses both.
 * An account with neither — a login without an email that never linked
 * Telegram — gets nothing; its owner resets the password under «Сотрудники».
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly mail: MailService,
    private readonly telegramBot: TelegramBotApi,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /**
   * `identifier` is an email or a staff login, as at sign-in. The answer is
   * the same for every identifier — known or not, with channels or without
   * — so it tells nothing about accounts: it lists only what this server
   * can send through.
   *
   * When it can send through nothing at all (no SMTP and no bot token, or
   * in production no ADMIN_APP_URL to build the link on) it answers 503
   * `PASSWORD_RESET_UNAVAILABLE` up front, the same for every identifier,
   * instead of a page saying "check your inbox" for a link that never left.
   *
   * The messages go out after the answer: how long SMTP or Telegram take
   * must not tell whether the account exists either.
   */
  async request(identifier: string): Promise<PasswordForgotResponse> {
    const base = adminAppUrl(this.config);
    const channels = this.channels(base);
    if (!base || channels.length === 0) {
      const missing = base ? 'SMTP_HOST and TELEGRAM_BOT_TOKEN' : 'ADMIN_APP_URL';
      this.logger.error(`Password reset requested, but no reset link can be delivered: ${missing} not set`);
      throw new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Service Unavailable',
        code: 'PASSWORD_RESET_UNAVAILABLE',
        message: 'Password reset is not available on this server',
      });
    }
    const answer: PasswordForgotResponse = {
      channels,
      linkTtlMinutes: PASSWORD_RESET_TTL_SECONDS / 60,
    };

    const user = await this.findAccount(identifier);
    if (!user) return answer;

    const email = channels.includes('email') ? user.email : null;
    const chatId = channels.includes('telegram') ? user.telegramNotifyChatId : null;
    if (!email && chatId === null) {
      this.logger.log(`Password reset for user ${user.id}: no email or Telegram to send the link to`);
      return answer;
    }
    if (!(await this.claimCooldown(user.id))) {
      this.logger.log(`Password reset for user ${user.id}: a link went out less than a minute ago, not sending again`);
      return answer;
    }

    const { raw, hash } = this.passwords.issueResetToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000),
      },
    });

    const delivery: Delivery = {
      userId: user.id,
      url: `${base}/reset-password?token=${raw}`,
      account: user.email ?? user.login ?? '',
      email,
      chatId,
    };
    void this.deliver(delivery).catch((err: unknown) =>
      this.logger.error(`Password reset for user ${user.id} not delivered: ${(err as Error).message}`),
    );
    return answer;
  }

  /**
   * Sets a new password from the link and signs the account out
   * everywhere: a reset is what someone does when they think the old
   * password, or a device, is in the wrong hands.
   *
   * The link works once — claimed in the same transaction that changes the
   * password, so the same link opened twice at once changes it once — and
   * every other unused link of the account stops working with it.
   */
  async reset(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.passwords.hashResetToken(token) },
    });
    const now = new Date();
    if (!record || record.consumedAt || record.expiresAt <= now) {
      throw new BadRequestException(INVALID_LINK);
    }

    const newHash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (claimed.count !== 1) throw new BadRequestException(INVALID_LINK);
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash: newHash, passwordMustChange: false },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, consumedAt: null },
        data: { consumedAt: now },
      });
    });
    await this.tokens.revokeAll(record.userId);
  }

  /** What this server can send a link through. Nothing without a base URL to build the link on. */
  private channels(base: string | null): PasswordResetChannel[] {
    if (!base) return [];
    const channels: PasswordResetChannel[] = [];
    if (this.mail.isConfigured()) channels.push('email');
    if (this.telegramBot.isConfigured()) channels.push('telegram');
    return channels;
  }

  /**
   * The staff account signing in with `identifier`: an email has an '@', a
   * login never does. Customers sign in without a password, and a blocked
   * account cannot sign in whatever its password — neither gets a link.
   */
  private async findAccount(identifier: string) {
    const key = identifier.trim().toLowerCase();
    if (!key) return null;
    const user = await this.prisma.user.findUnique({
      where: key.includes('@') ? { email: key } : { login: key },
      select: { id: true, email: true, login: true, role: true, blockedAt: true, telegramNotifyChatId: true },
    });
    if (!user || !PASSWORD_LOGIN_ROLES.has(user.role) || user.blockedAt) return null;
    return user;
  }

  /**
   * True when no link went to this account in the last
   * {@link PASSWORD_RESET_COOLDOWN_SECONDS}. Without Redis it lets the
   * request through: the per-client limit still holds, and a person locked
   * out of their account is worse off than one who gets two links.
   */
  private async claimCooldown(userId: string): Promise<boolean> {
    try {
      const set = await this.redis.raw.set(
        `password-reset:cooldown:${userId}`,
        '1',
        'EX',
        PASSWORD_RESET_COOLDOWN_SECONDS,
        'NX',
      );
      return set === 'OK';
    } catch (err) {
      this.logger.warn(`Password reset cooldown unavailable (${(err as Error).message}); sending anyway`);
      return true;
    }
  }

  /** Both channels at once. Neither throws: each reports whether it was accepted. Never logs the link. */
  private async deliver(d: Delivery): Promise<void> {
    const ttlMinutes = PASSWORD_RESET_TTL_SECONDS / 60;
    const message = passwordResetTelegramMessage({ url: d.url, account: d.account, ttlMinutes });
    const [mailed, messaged] = await Promise.all([
      d.email ? this.mail.sendPasswordReset(d.email, d.url, ttlMinutes) : null,
      d.chatId !== null ? this.telegramBot.sendMessage(d.chatId, message.text, message.keyboard) : null,
    ]);
    const outcome = (sent: boolean | null) => (sent === null ? 'none' : sent ? 'sent' : 'failed');
    this.logger.log(
      `Password reset link for user ${d.userId}: email ${outcome(mailed)}, Telegram ${outcome(messaged)}`,
    );
  }
}
