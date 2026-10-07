import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Locale, Role } from '@prisma/client';

import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OpsChatService } from '../notifications/ops-chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { type FeedbackDigest, feedbackChatText, feedbackDigest, feedbackMail, feedbackPush } from './feedback-messages';

/**
 * Tells the platform team that a customer has written in.
 *
 * Telegram is what reaches them: the ops chat when the deployment has one,
 * otherwise — or when the chat refused the message — each platform admin's
 * own chat with the bot (admins who linked a Telegram account). Email goes
 * to every platform admin as well, but only where SMTP is set up; without
 * it the mail service would just log the customer's message.
 *
 * Best-effort through and through: the feedback is already saved when this
 * runs, so it resolves whatever happens and the call site fires and forgets.
 */
@Injectable()
export class FeedbackNotifier {
  private readonly logger = new Logger(FeedbackNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly opsChat: OpsChatService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async feedbackReceived(feedbackId: string): Promise<void> {
    try {
      const feedback = await this.prisma.feedback.findUnique({
        where: { id: feedbackId },
        select: {
          kind: true,
          source: true,
          appVersion: true,
          message: true,
          contact: true,
          user: { select: { name: true, email: true, phone: true } },
        },
      });
      if (!feedback) return;

      const digest = feedbackDigest(this.platformLocale, {
        kind: feedback.kind,
        source: feedback.source,
        appVersion: feedback.appVersion,
        message: feedback.message,
        contact: feedback.contact,
        authorName: feedback.user?.name ?? null,
        authorEmail: feedback.user?.email ?? null,
        authorPhone: feedback.user?.phone ?? null,
        adminUrl: this.adminUrl,
      });
      const admins = await this.prisma.user.findMany({
        where: { role: Role.SUPER_ADMIN, blockedAt: null },
        select: { id: true, email: true, locale: true, telegramUserId: true },
      });

      await settle(this.logger, [
        this.telegram(digest, admins),
        ...(this.mail.isConfigured() ? this.mailAdmins(digest, admins) : []),
      ]);
    } catch (err) {
      this.logger.error(`Could not announce feedback ${feedbackId}: ${messageOf(err)}`);
    }
  }

  private async telegram(digest: FeedbackDigest, admins: Admin[]): Promise<void> {
    if (this.opsChat.enabled && (await this.opsChat.send(feedbackChatText(digest)))) return;

    const { title, body } = feedbackPush(digest);
    const reachable = admins.filter((a) => a.telegramUserId !== null);
    if (reachable.length === 0) {
      this.logger.warn('New feedback, but no ops chat and no platform admin with Telegram to tell');
      return;
    }
    await settle(
      this.logger,
      reachable.map((admin) =>
        this.notifications.deliver(
          { userId: admin.id, locale: admin.locale, telegramUserId: admin.telegramUserId, pushTokens: [] },
          { kind: 'generic', title, body },
          'telegram',
        ),
      ),
    );
  }

  private mailAdmins(digest: FeedbackDigest, admins: Admin[]): Promise<void>[] {
    const m = feedbackMail(digest);
    return admins.flatMap((admin) => (admin.email ? [this.mail.send(admin.email, m.subject, m.text, m.html)] : []));
  }

  /** PLATFORM_LOCALE: `ru` (the default) or `en` — the same switch the moderation mails use. */
  private get platformLocale(): Locale {
    const value = this.config.get<string>('PLATFORM_LOCALE')?.trim().toLowerCase();
    return value === 'en' ? Locale.EN : Locale.RU;
  }

  private get adminUrl(): string {
    return (this.config.get<string>('ADMIN_APP_URL') ?? 'http://localhost:4202').replace(/\/+$/, '');
  }
}

interface Admin {
  id: string;
  email: string | null;
  locale: Locale;
  telegramUserId: bigint | null;
}

/** Runs every delivery to the end, whatever happens to its neighbours, and logs the ones that failed. */
async function settle(logger: Logger, deliveries: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(deliveries);
  for (const r of results) {
    if (r.status === 'rejected') logger.error(`Feedback notification failed: ${messageOf(r.reason)}`);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
