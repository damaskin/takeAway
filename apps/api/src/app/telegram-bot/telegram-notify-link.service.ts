import { HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import type { TelegramNotifyLinkCode, TelegramNotifyStatus } from '@takeaway/shared-types';
import { createHash, randomBytes } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { botLinkAvailable, telegramBotSettings } from './telegram-bot-config';

/** How long the bot link (QR code) on the «Telegram» page works. */
export const NOTIFY_LINK_TTL_SECONDS = 10 * 60;

/** Accounts that get work notifications. Customers hear about their orders through their own Telegram. */
export const NOTIFY_ROLES: readonly Role[] = [
  Role.SUPER_ADMIN,
  Role.BRAND_ADMIN,
  Role.STORE_MANAGER,
  Role.STAFF,
  Role.RIDER,
];

/** What `/start link_<code>` carries: 22 url-safe characters (16 random bytes). */
export const LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** Whom a consumed code linked. */
export interface LinkedAccount {
  userId: string;
  name: string;
}

/**
 * Telegram for work notifications, linked through the bot.
 *
 * The «Telegram» page in the cabinet — on a kitchen tablet (PIN session)
 * too — asks for a one-time link and shows it as a QR code. The employee
 * opens it on their own phone: Telegram starts the bot with `/start
 * link_<code>`, the webhook (TelegramWebhookService) trades the code for
 * the account here, and the chat it came from becomes the account's
 * `telegramNotifyChatId`. Nothing about anybody's Telegram sign-in changes,
 * so the employee's own customer profile in the Mini App stays theirs.
 *
 * A code lives {@link NOTIFY_LINK_TTL_SECONDS}, works once, and a new one
 * replaces the account's previous one. Redis keeps only its SHA-256.
 */
@Injectable()
export class TelegramNotifyLinkService {
  private readonly logger = new Logger(TelegramNotifyLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async status(userId: string): Promise<TelegramNotifyStatus> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { telegramNotifyChatId: true } });
    return {
      linked: user?.telegramNotifyChatId != null,
      botLinkAvailable: botLinkAvailable(telegramBotSettings(this.config)),
    };
  }

  /**
   * A fresh one-time link to the bot. 503 `TELEGRAM_NOTIFY_LINK_UNAVAILABLE`
   * while the bot cannot hear it — no username, or no webhook configured on
   * this server — rather than a QR code that leads nowhere.
   */
  async issue(userId: string): Promise<TelegramNotifyLinkCode> {
    const settings = telegramBotSettings(this.config);
    if (!botLinkAvailable(settings)) {
      throw new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Service Unavailable',
        code: 'TELEGRAM_NOTIFY_LINK_UNAVAILABLE',
        message: 'Linking Telegram through the bot is not configured on this server',
      });
    }
    const code = randomBytes(16).toString('base64url');
    const digest = hashCode(code);
    const previous = await this.redis.get(this.pendingKey(userId));
    if (previous) await this.redis.del(this.codeKey(previous));
    await this.redis.set(this.codeKey(digest), userId, NOTIFY_LINK_TTL_SECONDS);
    await this.redis.set(this.pendingKey(userId), digest, NOTIFY_LINK_TTL_SECONDS);
    return {
      url: `https://t.me/${settings.username}?start=link_${code}`,
      expiresAt: new Date(Date.now() + NOTIFY_LINK_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** «Отвязать»: the bot stops writing to the chat; a link still pending stops working too. */
  async unlink(userId: string): Promise<TelegramNotifyStatus> {
    await this.prisma.user.update({ where: { id: userId }, data: { telegramNotifyChatId: null } });
    await this.dropPending(userId);
    this.logger.log(`Telegram notifications unlinked for user ${userId}`);
    return this.status(userId);
  }

  /**
   * The webhook's half: trades a code for its account and makes `chatId`
   * the account's notification chat. Null when the code is unknown, used
   * or expired, or the account can no longer get notifications (blocked,
   * no longer staff) — the bot then says the link is stale.
   */
  async consume(code: string, chatId: bigint): Promise<LinkedAccount | null> {
    if (!LINK_CODE_PATTERN.test(code)) return null;
    // GETDEL: the same link opened twice links once.
    const userId = await this.redis.raw.getdel(this.codeKey(hashCode(code)));
    if (!userId) return null;
    await this.redis.del(this.pendingKey(userId));
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, blockedAt: true, name: true, login: true, email: true },
    });
    if (!user || user.blockedAt || !NOTIFY_ROLES.includes(user.role)) return null;
    await this.prisma.user.update({ where: { id: user.id }, data: { telegramNotifyChatId: chatId } });
    this.logger.log(`Telegram notifications linked for user ${user.id}`);
    return { userId: user.id, name: user.name?.trim() || user.login || user.email || '' };
  }

  private async dropPending(userId: string): Promise<void> {
    const pending = await this.redis.get(this.pendingKey(userId));
    if (pending) await this.redis.del(this.codeKey(pending), this.pendingKey(userId));
  }

  private codeKey(digest: string): string {
    return `tg-notify:code:${digest}`;
  }

  private pendingKey(userId: string): string {
    return `tg-notify:pending:${userId}`;
  }
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
