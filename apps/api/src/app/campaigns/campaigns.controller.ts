import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Campaign, CampaignAudience, CampaignChannel } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BrandScopeService } from '../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { RequiresPlanFeature } from '../plans/plan-feature.guard';
import { INACTIVE_DAYS } from '../customers/customer-segment';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignModerationService } from './campaign-moderation.service';
import {
  type AudienceSpec,
  type CampaignInput,
  type CampaignStats,
  CampaignsService,
  DELETABLE_STATUSES,
  emptyCampaignStats,
  isEditable,
  isSendable,
} from './campaigns.service';
import {
  CAMPAIGN_AUDIENCES,
  CAMPAIGN_CHANNELS,
  CampaignDto,
  CampaignPreviewDto,
  CampaignTestResultDto,
  CreateCampaignDto,
  TestCampaignDto,
  UpdateCampaignDto,
} from './dto/campaigns.dto';

// Per account. Each call reaches real phones, inboxes and Telegram chats (and,
// for a send, every customer of the brand), so a stolen or scripted session
// must not be able to fire them in a loop. Dev gets 10x.
const DEV_MULTIPLIER = process.env['NODE_ENV'] !== 'production' ? 10 : 1;
const TESTS_PER_MINUTE = 10 * DEV_MULTIPLIER;
const SENDS_PER_MINUTE = 5 * DEV_MULTIPLIER;

/**
 * A brand's campaigns. The business composes a draft, edits it and submits
 * it for review; the platform team approves or rejects it on
 * /admin/campaign-moderation, and approval starts the run. A SUPER_ADMIN's
 * own submit is its approval.
 */
@ApiTags('campaigns')
@ApiBearerAuth()
@Controller('admin/campaigns')
@RequiresPlanFeature('campaigns')
export class CampaignsController {
  constructor(
    private readonly service: CampaignsService,
    private readonly moderation: CampaignModerationService,
    private readonly brandScope: BrandScopeService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiOkResponse({ type: CampaignDto, isArray: true })
  async list(@CurrentUser() user: AuthenticatedUser, @Query('brandId') brandId?: string): Promise<CampaignDto[]> {
    const resolved = await this.resolveBrandId(user, brandId);
    const rows = await this.service.list(resolved);
    const stats = await this.service.stats(rows.map((r) => r.id));
    return rows.map((r) => toCampaignDto(r, stats.get(r.id)));
  }

  /** How many people an audience reaches through a channel — the form shows it before saving. */
  @Get('preview')
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiQuery({ name: 'audience', required: false, enum: CAMPAIGN_AUDIENCES })
  @ApiQuery({ name: 'channel', required: false, enum: CAMPAIGN_CHANNELS })
  @ApiQuery({ name: 'inactiveDays', required: false, enum: [...INACTIVE_DAYS] })
  @ApiQuery({ name: 'storeId', required: false, type: String })
  @ApiOkResponse({ type: CampaignPreviewDto })
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Query('brandId') brandId?: string,
    @Query('audience') audience?: string,
    @Query('channel') channel?: string,
    @Query('inactiveDays') inactiveDays?: string,
    @Query('storeId') storeId?: string,
  ): Promise<CampaignPreviewDto> {
    const resolved = await this.resolveBrandId(user, brandId);
    const a = audience ?? 'ALL';
    const c = channel ?? 'PUSH';
    if (!(CAMPAIGN_AUDIENCES as readonly string[]).includes(a)) throw new BadRequestException('Unknown audience');
    if (!(CAMPAIGN_CHANNELS as readonly string[]).includes(c)) throw new BadRequestException('Unknown channel');
    const days = inactiveDays === undefined ? undefined : Number(inactiveDays);
    const spec = await this.audienceSpec(resolved, a as CampaignAudience, days, storeId);
    return this.service.preview(resolved, spec, c as CampaignChannel);
  }

  /** Sends the copy to the signed-in admin only — their app, browser or Telegram. */
  @Post('test')
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @Throttle({ default: { limit: TESTS_PER_MINUTE, ttl: 60_000 } })
  @ApiOkResponse({ type: CampaignTestResultDto })
  test(@CurrentUser() user: AuthenticatedUser, @Body() dto: TestCampaignDto): Promise<CampaignTestResultDto> {
    return this.service.sendTest(user.id, { title: dto.title, body: dto.body, channel: dto.channel });
  }

  /** One campaign — the edit form loads it. */
  @Get(':id')
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: CampaignDto })
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<CampaignDto> {
    const brandId = await this.resolveBrandIdForCampaign(user, id);
    const row = await this.service.findOwned(brandId, id);
    const stats = await this.service.stats([row.id]);
    return toCampaignDto(row, stats.get(row.id));
  }

  /** A new draft. Nothing is sent until it is submitted and approved. */
  @Post()
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiOkResponse({ type: CampaignDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCampaignDto,
    @Query('brandId') brandId?: string,
  ): Promise<CampaignDto> {
    const resolved = await this.resolveBrandId(user, brandId);
    const spec = await this.audienceSpec(
      resolved,
      (dto.audience ?? 'ALL') as CampaignAudience,
      dto.inactiveDays,
      dto.storeId,
    );
    const row = await this.service.create({
      brandId: resolved,
      createdById: user.id,
      title: dto.title,
      body: dto.body,
      channel: dto.channel as CampaignChannel,
      ...spec,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
    });
    return toCampaignDto(row);
  }

  /** Edits a draft or a rejected campaign; 409 `CAMPAIGN_NOT_EDITABLE` for any other. */
  @Patch(':id')
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: CampaignDto })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ): Promise<CampaignDto> {
    const brandId = await this.resolveBrandIdForCampaign(user, id);
    const patch: Partial<CampaignInput> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.body !== undefined) patch.body = dto.body;
    if (dto.channel !== undefined) patch.channel = dto.channel as CampaignChannel;
    if (dto.audience !== undefined) {
      Object.assign(
        patch,
        await this.audienceSpec(brandId, dto.audience as CampaignAudience, dto.inactiveDays, dto.storeId),
      );
    }
    if (dto.scheduledAt !== undefined) patch.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    const row = await this.service.update(brandId, id, patch);
    return toCampaignDto(row);
  }

  /**
   * «Отправить на модерацию»: a draft or a rejected campaign goes into the
   * platform's review queue. A SUPER_ADMIN's submit approves it at once.
   */
  @Post(':id/submit')
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  // Pings the ops chat, and a platform admin's submit sends — the send cap applies.
  @Throttle({ default: { limit: SENDS_PER_MINUTE, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CampaignDto })
  async submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<CampaignDto> {
    const brandId = await this.resolveBrandIdForCampaign(user, id);
    const row = await this.moderation.submit(brandId, id, user);
    const stats = await this.service.stats([row.id]);
    return toCampaignDto(row, stats.get(row.id));
  }

  /** «Отозвать в черновик»: a campaign under review goes back to DRAFT; 409 `CAMPAIGN_NOT_PENDING` otherwise. */
  @Post(':id/withdraw')
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CampaignDto })
  async withdraw(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<CampaignDto> {
    const brandId = await this.resolveBrandIdForCampaign(user, id);
    const row = await this.moderation.withdraw(brandId, id);
    return toCampaignDto(row);
  }

  /**
   * Retries an approved campaign — a failed or stuck run, or the people a
   * finished run missed — and answers at once with the row in SENDING.
   * Poll the list for the counters. Never sends an unapproved campaign.
   */
  @Post(':id/send')
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @Throttle({ default: { limit: SENDS_PER_MINUTE, ttl: 60_000 } })
  @ApiOkResponse({ type: CampaignDto })
  async send(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<CampaignDto> {
    const brandId = await this.resolveBrandIdForCampaign(user, id);
    const row = await this.service.send(brandId, id);
    const stats = await this.service.stats([row.id]);
    return toCampaignDto(row, stats.get(row.id));
  }

  /** Throws away a campaign that has not started going out. */
  @Delete(':id')
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    const brandId = await this.resolveBrandIdForCampaign(user, id);
    await this.service.delete(brandId, id);
  }

  private async resolveBrandId(user: AuthenticatedUser, brandId?: string): Promise<string> {
    const scope = await this.brandScope.resolveBrandIds(user);
    if (scope === null) {
      if (!brandId) throw new BadRequestException('SUPER_ADMIN must pass ?brandId=');
      return brandId;
    }
    if (brandId) {
      if (!scope.includes(brandId)) throw new NotFoundException('Brand not found');
      return brandId;
    }
    const first = scope[0];
    if (!first) throw new NotFoundException('No brand owned by this user');
    return first;
  }

  /**
   * The INACTIVE segment's days and store, checked: one of the windows, and
   * a store of this brand. Other audiences carry neither.
   */
  private async audienceSpec(
    brandId: string,
    audience: CampaignAudience,
    inactiveDays?: number,
    storeId?: string,
  ): Promise<AudienceSpec> {
    if (audience !== 'INACTIVE') return { audience };
    if (inactiveDays !== undefined && !(INACTIVE_DAYS as readonly number[]).includes(inactiveDays)) {
      throw new BadRequestException(`inactiveDays must be one of ${INACTIVE_DAYS.join(', ')}`);
    }
    if (storeId) {
      const store = await this.prisma.store.findFirst({ where: { id: storeId, brandId }, select: { id: true } });
      if (!store) throw new NotFoundException('Store not found');
    }
    return { audience, inactiveDays: inactiveDays ?? null, segmentStoreId: storeId || null };
  }

  private async resolveBrandIdForCampaign(user: AuthenticatedUser, id: string): Promise<string> {
    const campaign = await this.prisma.campaign.findUnique({ where: { id }, select: { brandId: true } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    await this.brandScope.assertBrand(user, campaign.brandId);
    return campaign.brandId;
  }
}

export function toCampaignDto(c: Campaign, stats: CampaignStats = emptyCampaignStats()): CampaignDto {
  return {
    id: c.id,
    brandId: c.brandId,
    title: c.title,
    body: c.body,
    channel: c.channel as CampaignDto['channel'],
    audience: c.audience as CampaignDto['audience'],
    inactiveDays: c.inactiveDays,
    storeId: c.segmentStoreId,
    status: c.status as CampaignDto['status'],
    targetCount: c.targetCount,
    sentCount: c.sentCount,
    failedCount: c.failedCount,
    noChannelCount: c.noChannelCount,
    optedOutCount: c.optedOutCount,
    lastError: c.lastError,
    via: stats.via,
    errors: stats.errors,
    sendable: isSendable(c),
    editable: isEditable(c),
    deletable: DELETABLE_STATUSES.includes(c.status),
    scheduledAt: iso(c.scheduledAt),
    submittedAt: iso(c.submittedAt),
    reviewedAt: iso(c.reviewedAt),
    reviewNote: c.reviewNote,
    approvedAt: iso(c.approvedAt),
    startedAt: iso(c.startedAt),
    sentAt: iso(c.sentAt),
    createdAt: c.createdAt.toISOString(),
  };
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}
