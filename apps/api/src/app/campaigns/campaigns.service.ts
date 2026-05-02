import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Campaign, CampaignAudience, CampaignChannel } from '@prisma/client';

import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const SEND_BATCH_SIZE = 50;

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  list(brandId: string): Promise<Campaign[]> {
    return this.prisma.campaign.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  create(input: {
    brandId: string;
    title: string;
    body: string;
    channel: CampaignChannel;
    audience: CampaignAudience;
  }): Promise<Campaign> {
    return this.prisma.campaign.create({
      data: {
        brandId: input.brandId,
        title: input.title,
        body: input.body,
        channel: input.channel,
        audience: input.audience,
        status: 'DRAFT',
      },
    });
  }

  async deleteDraft(brandId: string, id: string): Promise<void> {
    const c = await this.prisma.campaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Campaign not found');
    if (c.brandId !== brandId) throw new NotFoundException('Campaign not found');
    if (c.status !== 'DRAFT') throw new BadRequestException('Only DRAFT campaigns can be deleted');
    await this.prisma.campaign.delete({ where: { id } });
  }

  /**
   * Resolve the campaign's audience to a list of user ids and fan the
   * message out via the requested channel. Synchronous for v1 — runs
   * inside the controller request, with a batched loop so a few thousand
   * recipients don't open thousands of HTTP sockets at once. Counters
   * are stamped on the row at the end.
   */
  async send(brandId: string, id: string): Promise<Campaign> {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.brandId !== brandId) throw new NotFoundException('Campaign not found');
    if (campaign.status !== 'DRAFT')
      throw new BadRequestException(`Cannot send a campaign in status ${campaign.status}`);

    const userIds = await this.resolveAudience(brandId, campaign.audience);

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: 'SENDING', targetCount: userIds.length, sentCount: 0, failedCount: 0 },
    });

    let sent = 0;
    let failed = 0;
    for (let i = 0; i < userIds.length; i += SEND_BATCH_SIZE) {
      const batch = userIds.slice(i, i + SEND_BATCH_SIZE);
      const results = await Promise.allSettled(batch.map((uid) => this.deliverOne(uid, campaign)));
      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value === 'sent') sent++;
          else if (r.value === 'failed') failed++;
        } else {
          failed++;
        }
      }
    }

    return this.prisma.campaign.update({
      where: { id: updated.id },
      data: {
        status: failed > 0 && sent === 0 ? 'FAILED' : 'SENT',
        sentCount: sent,
        failedCount: failed,
        sentAt: new Date(),
      },
    });
  }

  private async deliverOne(
    userId: string,
    campaign: Pick<Campaign, 'channel' | 'title' | 'body'>,
  ): Promise<'sent' | 'opted_out' | 'failed'> {
    if (campaign.channel === 'EMAIL') {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, notifyPromotions: true, name: true },
      });
      if (!user || !user.email || !user.notifyPromotions) return 'opted_out';
      try {
        await this.mail.send(user.email, campaign.title, campaign.body);
        return 'sent';
      } catch {
        return 'failed';
      }
    }
    return this.notifications.sendCampaignTo(
      userId,
      campaign.channel as 'PUSH' | 'TELEGRAM',
      campaign.title,
      campaign.body,
    );
  }

  /**
   * Resolves an audience filter to a deduped user-id list. We restrict
   * to customers who have at least one Order at one of the brand's
   * stores — i.e. people who actually have a relationship with this
   * brand. ALL is the default and matches every such customer; the
   * activity-based variants narrow further.
   */
  private async resolveAudience(brandId: string, audience: CampaignAudience): Promise<string[]> {
    const baseFilter = {
      role: 'CUSTOMER' as const,
      blockedAt: null,
      orders: { some: { store: { brandId } } },
    };

    if (audience === 'HAS_ORDERED' || audience === 'ALL') {
      const users = await this.prisma.user.findMany({
        where:
          audience === 'HAS_ORDERED'
            ? {
                ...baseFilter,
                orders: {
                  some: {
                    store: { brandId },
                    status: {
                      in: ['PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'],
                    },
                  },
                },
              }
            : baseFilter,
        select: { id: true },
      });
      return users.map((u) => u.id);
    }

    // INACTIVE_30D — last paid order older than 30 days.
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const users = await this.prisma.user.findMany({
      where: {
        ...baseFilter,
        orders: {
          // At least one PAID order at this brand…
          some: {
            store: { brandId },
            status: {
              in: ['PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'],
            },
          },
          // …and *no* PAID order at this brand within the last 30 days.
          none: {
            store: { brandId },
            status: {
              in: ['PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'],
            },
            createdAt: { gt: cutoff },
          },
        },
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }
}
