import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Campaign, Locale, type Prisma, Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { codedConflict } from '../common/http/coded-conflict';
import { OpsChatService } from '../notifications/ops-chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { campaignSubmittedChatText } from './campaign-moderation-messages';
import {
  type CampaignPreview,
  CampaignError,
  CampaignsService,
  EDITABLE_STATUSES,
  isEditable,
  noRecipients,
} from './campaigns.service';

/** Which part of the moderation history the queue page lists. */
export type ModerationView = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

/** Decided campaigns the history tabs show at most. */
const HISTORY_LIMIT = 50;

const QUEUE_INCLUDE = {
  brand: { select: { id: true, name: true, slug: true, logoUrl: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  reviewedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.CampaignInclude;

export type ModerationRow = Prisma.CampaignGetPayload<{ include: typeof QUEUE_INCLUDE }>;

/** A queued campaign with who it reaches right now — the moderator decides on that. */
export interface ModerationItem {
  campaign: ModerationRow;
  /** Only for campaigns waiting for review; decided ones have their run counters. */
  reach: CampaignPreview | null;
}

/**
 * Review of business campaigns by the platform team. A business submits a
 * draft («Отправить на модерацию»); a SUPER_ADMIN approves it — which
 * starts the run, now or at the scheduled time — or rejects it with a
 * reason the business sees, fixes and resubmits. A campaign a SUPER_ADMIN
 * submits is approved on the spot: they are the moderator.
 *
 * Every transition is a conditional update on the expected status, so two
 * moderators (or a moderator and the business) cannot both win.
 */
@Injectable()
export class CampaignModerationService {
  private readonly logger = new Logger(CampaignModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly opsChat: OpsChatService,
    private readonly config: ConfigService,
  ) {}

  /**
   * DRAFT / REJECTED → PENDING_REVIEW, and the platform team is told. From
   * a SUPER_ADMIN → APPROVED straight away, and the run starts when due.
   * Refused for an audience nobody is in yet, and for a send time that has
   * already passed.
   */
  async submit(brandId: string, id: string, actor: AuthenticatedUser, now = new Date()): Promise<Campaign> {
    const campaign = await this.campaigns.findOwned(brandId, id);
    if (!isEditable(campaign)) {
      throw codedConflict(CampaignError.NOT_SUBMITTABLE, 'Only a draft or a rejected campaign can be submitted');
    }
    if (campaign.scheduledAt && campaign.scheduledAt <= now) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: CampaignError.SCHEDULED_IN_PAST,
        message: 'The send time has already passed',
        field: 'scheduledAt',
      });
    }
    const audienceSize = await this.campaigns.audienceSize(brandId, campaign.audience);
    if (audienceSize === 0) throw noRecipients();

    const selfApproved = actor.role === Role.SUPER_ADMIN;
    const { count } = await this.prisma.campaign.updateMany({
      where: { id, status: { in: [...EDITABLE_STATUSES] } },
      data: selfApproved
        ? {
            status: 'APPROVED',
            submittedAt: now,
            approvedAt: now,
            reviewedAt: now,
            reviewedById: actor.id,
            reviewNote: null,
          }
        : { status: 'PENDING_REVIEW', submittedAt: now, reviewNote: null },
    });
    if (count === 0) {
      throw codedConflict(CampaignError.NOT_SUBMITTABLE, 'Only a draft or a rejected campaign can be submitted');
    }

    if (selfApproved) await this.start(id, now);
    else void this.announce(id, audienceSize);
    return this.prisma.campaign.findUniqueOrThrow({ where: { id } });
  }

  /** PENDING_REVIEW → APPROVED; an unscheduled campaign starts going out at once. */
  async approve(id: string, reviewer: AuthenticatedUser, now = new Date()): Promise<ModerationRow> {
    const { count } = await this.prisma.campaign.updateMany({
      where: { id, status: 'PENDING_REVIEW' },
      data: { status: 'APPROVED', approvedAt: now, reviewedAt: now, reviewedById: reviewer.id, reviewNote: null },
    });
    if (count === 0) await this.notPending(id);
    await this.start(id, now);
    return this.prisma.campaign.findUniqueOrThrow({ where: { id }, include: QUEUE_INCLUDE });
  }

  /** PENDING_REVIEW → REJECTED, with the reason the business is shown. */
  async reject(id: string, reviewer: AuthenticatedUser, reason: string, now = new Date()): Promise<ModerationRow> {
    const { count } = await this.prisma.campaign.updateMany({
      where: { id, status: 'PENDING_REVIEW' },
      data: { status: 'REJECTED', reviewNote: reason, reviewedAt: now, reviewedById: reviewer.id },
    });
    if (count === 0) await this.notPending(id);
    return this.prisma.campaign.findUniqueOrThrow({ where: { id }, include: QUEUE_INCLUDE });
  }

  /**
   * The queue, oldest submission first, with who each campaign would reach;
   * or the latest decisions. Approved means every campaign that was ever
   * approved, wherever its run is now.
   */
  async list(view: ModerationView): Promise<ModerationItem[]> {
    if (view === 'PENDING_REVIEW') {
      const rows = await this.prisma.campaign.findMany({
        where: { status: 'PENDING_REVIEW' },
        orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
        include: QUEUE_INCLUDE,
      });
      return Promise.all(
        rows.map(async (campaign) => ({
          campaign,
          reach: await this.campaigns.preview(campaign.brandId, campaign.audience, campaign.channel),
        })),
      );
    }
    const rows = await this.prisma.campaign.findMany({
      where: view === 'APPROVED' ? { approvedAt: { not: null } } : { status: 'REJECTED' },
      orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }],
      take: HISTORY_LIMIT,
      include: QUEUE_INCLUDE,
    });
    return rows.map((campaign) => ({ campaign, reach: null }));
  }

  /** Campaigns waiting for a decision — the badge in the platform admin's sidebar. */
  async pendingCount(): Promise<{ count: number }> {
    const count = await this.prisma.campaign.count({ where: { status: 'PENDING_REVIEW' } });
    return { count };
  }

  /**
   * The decision stands even if the start fails: the scheduler picks up an
   * approved campaign whose time has come within a minute.
   */
  private async start(id: string, now: Date): Promise<void> {
    try {
      await this.campaigns.startIfDue(id, now);
    } catch (err) {
      this.logger.error(`Approved campaign ${id} did not start: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async notPending(id: string): Promise<never> {
    const exists = await this.prisma.campaign.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Campaign not found');
    throw codedConflict(CampaignError.NOT_PENDING, 'The campaign is not waiting for review');
  }

  /** Tells the ops chat a campaign is waiting. Best-effort: the submission stands either way. */
  private async announce(id: string, audienceSize: number): Promise<void> {
    try {
      if (!this.opsChat.enabled) return;
      const c = await this.prisma.campaign.findUnique({
        where: { id },
        select: {
          title: true,
          body: true,
          channel: true,
          audience: true,
          scheduledAt: true,
          brand: { select: { name: true } },
        },
      });
      if (!c) return;
      await this.opsChat.send(
        campaignSubmittedChatText(this.platformLocale, {
          brandName: c.brand.name,
          title: c.title,
          body: c.body,
          channel: c.channel,
          audience: c.audience,
          audienceSize,
          scheduledAt: c.scheduledAt,
          adminUrl: this.adminUrl,
        }),
      );
    } catch (err) {
      this.logger.error(`Could not announce campaign ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** PLATFORM_LOCALE: `ru` (the default) or `en` — the switch the other platform alerts use. */
  private get platformLocale(): Locale {
    const value = this.config.get<string>('PLATFORM_LOCALE')?.trim().toLowerCase();
    return value === 'en' ? Locale.EN : Locale.RU;
  }

  private get adminUrl(): string {
    return (this.config.get<string>('ADMIN_APP_URL') ?? 'http://localhost:4202').replace(/\/+$/, '');
  }
}
