import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { CustomerBonus } from '@takeaway/shared-types';
import { WELCOME_BONUS_DAYS, welcomeBonusMessage } from '@takeaway/utils';

import { NotificationsService } from '../notifications/notifications.service';
import { PLATFORM_SENDER_NAME, titleWithSender } from '../notifications/push-copy';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolation } from './takeaway-promo-view';

/** The identity a new customer account was created with. */
export type SignUpIdentity =
  | { kind: 'telegram'; telegramUserId: string | number | bigint }
  | { kind: 'email'; address: string }
  | { kind: 'oauth'; provider: string; subject: string };

const DAY_MS = 24 * 60 * 60_000;
/** The push waits this long after sign-up, so the app has registered its device by then. */
const NOTIFY_AFTER_MS = 60_000;
/** A bonus nobody told about within a day (the API was down) is left in the profile banner only. */
const NOTIFY_WITHIN_MS = DAY_MS;
const NOTIFY_BATCH = 100;

/**
 * Once per person, ever: the hash of the identity the account was created
 * with — kept when the account is deleted (the user row stays a tombstone),
 * so signing up again with the same Telegram, address or social account
 * gives nothing. Hashed, so the table holds no contact of its own.
 */
export function welcomeIdentityHash(identity: SignUpIdentity): string {
  const key =
    identity.kind === 'telegram'
      ? `tg:${identity.telegramUserId.toString()}`
      : identity.kind === 'email'
        ? `email:${identity.address.trim().toLowerCase()}`
        : `oauth:${identity.provider.toLowerCase()}:${identity.subject}`;
  return createHash('sha256').update(key).digest('hex');
}

/**
 * The welcome bonus (docs/takeaway-promos.md §2.9): a new customer gets the
 * live welcome promo for 7 days, hears about it a minute later (inbox +
 * push), and sees it in the profile until it is used or runs out.
 */
@Injectable()
export class WelcomeBonusService {
  private readonly logger = new Logger(WelcomeBonusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Called right after a NEW customer account was created. Gives the bonus
   * when an ACTIVE welcome promo is inside its dates with budget left;
   * otherwise nothing, and no message. Never throws: a sign-in must not
   * fail or wait over a bonus.
   */
  async onCustomerCreated(userId: string, identity: SignUpIdentity, now = new Date()): Promise<boolean> {
    try {
      const promos = await this.prisma.takeawayPromo.findMany({
        where: { isWelcome: true, status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gte: now } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, budgetCents: true, spentCents: true },
      });
      const promo = promos.find((p) => p.spentCents < p.budgetCents);
      if (!promo) return false;
      await this.prisma.welcomeBonus.create({
        data: {
          promoId: promo.id,
          userId,
          identityHash: welcomeIdentityHash(identity),
          expiresAt: new Date(now.getTime() + WELCOME_BONUS_DAYS * DAY_MS),
        },
      });
      this.logger.log(`[welcome-bonus] user=${userId} promo=${promo.id}`);
      return true;
    } catch (err) {
      // P2002: this person had a bonus already (an earlier account), or this
      // account did (a sign-in raced itself). Either way: nothing more.
      if (!isUniqueViolation(err)) {
        this.logger.error(`[welcome-bonus] could not give user=${userId} a bonus: ${(err as Error).message}`);
      }
      return false;
    }
  }

  /**
   * `GET /me/bonuses`: the welcome bonus while it can still be used — not
   * used, not expired, and its promo running with budget left.
   */
  async listForUser(userId: string, now = new Date()): Promise<CustomerBonus[]> {
    const bonus = await this.prisma.welcomeBonus.findUnique({
      where: { userId },
      include: { promo: true },
    });
    if (!bonus || bonus.orderId || bonus.expiresAt <= now) return [];
    const { promo } = bonus;
    const live =
      promo.status === 'ACTIVE' && promo.startsAt <= now && promo.endsAt >= now && promo.spentCents < promo.budgetCents;
    if (!live) return [];
    return [
      {
        id: bonus.id,
        kind: 'WELCOME',
        promoId: promo.id,
        code: promo.code,
        name: promo.name,
        percent: promo.percent,
        currency: promo.currency,
        expiresAt: bonus.expiresAt.toISOString(),
      },
    ];
  }

  /**
   * The inbox item and the push, a minute after sign-up — the app registers
   * its device after the sign-in, and a push sent at once would find none.
   * A Mini App or web customer gets it from the bot, as any push. It is a
   * platform announcement (kind `announcement`), so older apps show it.
   * Each bonus is claimed before it is told about, so two API instances
   * never send it twice.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'welcome-bonus-notify' })
  async notifyPending(now = new Date()): Promise<number> {
    const due = await this.prisma.welcomeBonus.findMany({
      where: {
        notifiedAt: null,
        orderId: null,
        createdAt: { lte: new Date(now.getTime() - NOTIFY_AFTER_MS), gte: new Date(now.getTime() - NOTIFY_WITHIN_MS) },
        expiresAt: { gt: now },
        user: { blockedAt: null },
      },
      orderBy: { createdAt: 'asc' },
      take: NOTIFY_BATCH,
      select: { id: true, userId: true, promo: { select: { percent: true } }, user: { select: { locale: true } } },
    });

    let sent = 0;
    for (const bonus of due) {
      const claimed = await this.prisma.welcomeBonus.updateMany({
        where: { id: bonus.id, notifiedAt: null },
        data: { notifiedAt: now },
      });
      if (claimed.count === 0) continue;
      try {
        const { title, body } = welcomeBonusMessage(bonus.promo.percent, bonus.user.locale);
        const item = await this.prisma.customerNotification.create({
          data: { userId: bonus.userId, kind: 'PLATFORM_ANNOUNCEMENT', title, body },
          select: { id: true },
        });
        await this.notifications.sendCampaignTo(
          bonus.userId,
          'PUSH',
          titleWithSender(PLATFORM_SENDER_NAME, title),
          body,
          { push: { kind: 'announcement', notificationId: item.id } },
        );
        sent += 1;
      } catch (err) {
        this.logger.error(`[welcome-bonus] could not tell user=${bonus.userId}: ${(err as Error).message}`);
      }
    }
    return sent;
  }
}
