import { HttpStatus, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';

import { RedisService } from '../redis/redis.service';
import { type BotKeyboard, TelegramBotApi } from './telegram-bot-api.service';
import { telegramBotSettings } from './telegram-bot-config';
import { TelegramNotifyLinkService } from './telegram-notify-link.service';

/** Messages one chat may get answered within a minute; past that the bot keeps quiet. */
export const BOT_REPLIES_PER_MINUTE = 5;

/** What the bot says. Russian: the platform's staff and customers read Russian. */
export const BOT_TEXT = {
  linked: (name: string): string =>
    `Готово! Уведомления о заказах${name ? ` для «${name}»` : ''} будут приходить сюда.\n` +
    'Отключить — на странице «Telegram» в кабинете.',
  linkStale: 'Ссылка устарела или уже использована. Откройте страницу «Telegram» в кабинете и получите новую.',
  greeting: 'Здравствуйте! Это бот takeAway: закажите кофе или еду заранее и заберите без очереди.',
  openMiniApp: 'Открыть takeAway',
} as const;

/** The parts of a Telegram update the bot reads. */
interface IncomingMessage {
  chatId: bigint;
  text: string;
}

const START = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?\s*$/;

/**
 * The bot's side of the conversation, from `POST /api/telegram/webhook`.
 *
 * Only `/start` in a private chat is answered:
 *  - `/start link_<code>` — the link from the «Telegram» page: this chat
 *    gets the account's work notifications (TelegramNotifyLinkService);
 *  - `/start` alone or with anything else — a short greeting with a button
 *    that opens the Mini App.
 * Everything else — other messages, groups, edits — is ignored. Each chat
 * is answered at most {@link BOT_REPLIES_PER_MINUTE} times a minute.
 *
 * Requests are trusted only with the secret Telegram was given at
 * `setWebhook` (TelegramWebhookRegistrar), sent back in
 * X-Telegram-Bot-Api-Secret-Token. Without a configured secret the endpoint
 * does not exist (404).
 */
@Injectable()
export class TelegramWebhookService {
  private readonly logger = new Logger(TelegramWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly bot: TelegramBotApi,
    private readonly links: TelegramNotifyLinkService,
  ) {}

  /** 404 while no secret is configured, 401 for a request without the right one. */
  assertFromTelegram(header: string | undefined): void {
    const secret = telegramBotSettings(this.config).webhookSecret;
    if (!secret) throw new NotFoundException();
    if (!header || !sameSecret(header, secret)) {
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        error: 'Unauthorized',
        message: 'Invalid webhook secret',
      });
    }
  }

  /** Handles one update. Never throws for a bad update: Telegram would only send it again. */
  async handle(update: unknown): Promise<void> {
    const message = privateText(update);
    if (!message) return;
    const start = START.exec(message.text.trim());
    if (!start) return;
    if (!(await this.withinLimit(message.chatId))) return;

    const payload = start[1] ?? '';
    if (payload.startsWith('link_')) {
      const linked = await this.links.consume(payload.slice('link_'.length), message.chatId);
      await this.bot.sendMessage(message.chatId, linked ? BOT_TEXT.linked(linked.name) : BOT_TEXT.linkStale);
      return;
    }
    await this.bot.sendMessage(message.chatId, BOT_TEXT.greeting, this.miniAppButton());
  }

  private miniAppButton(): BotKeyboard | undefined {
    const url = telegramBotSettings(this.config).miniAppUrl;
    return url ? { inline_keyboard: [[{ text: BOT_TEXT.openMiniApp, web_app: { url } }]] } : undefined;
  }

  private async withinLimit(chatId: bigint): Promise<boolean> {
    const count = await this.redis.incrWithTtl(`tg-bot:replies:${chatId}`, 60);
    if (count === BOT_REPLIES_PER_MINUTE + 1) this.logger.warn(`Bot chat ${chatId} is over its replies for the minute`);
    return count <= BOT_REPLIES_PER_MINUTE;
  }
}

/** The text of a private-chat message, or null for anything else. */
function privateText(update: unknown): IncomingMessage | null {
  if (!update || typeof update !== 'object') return null;
  const message = (update as { message?: unknown }).message;
  if (!message || typeof message !== 'object') return null;
  const { chat, text } = message as { chat?: { id?: unknown; type?: unknown }; text?: unknown };
  if (!chat || chat.type !== 'private' || typeof text !== 'string') return null;
  const id = chat.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) return null;
  return { chatId: BigInt(id), text };
}

/** Constant-time comparison of two secrets of any length. */
function sameSecret(a: string, b: string): boolean {
  const digest = (s: string): Buffer => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}
