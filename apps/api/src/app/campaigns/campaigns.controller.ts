import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Campaign, CampaignAudience, CampaignChannel } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BrandScopeService } from '../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { RequiresPlanFeature } from '../plans/plan-feature.guard';
import { INACTIVE_DAYS } from '../customers/customer-segment';
import { PrismaService } from '../prisma/prisma.service';
import {
  type AudienceSpec,
  type CampaignStats,
  CampaignsService,
  emptyCampaignStats,
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
} from './dto/campaigns.dto';

@ApiTags('campaigns')
@ApiBearerAuth()
@Controller('admin/campaigns')
@RequiresPlanFeature('campaigns')
export class CampaignsController {
  constructor(
    private readonly service: CampaignsService,
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
  @ApiOkResponse({ type: CampaignTestResultDto })
  test(@CurrentUser() user: AuthenticatedUser, @Body() dto: TestCampaignDto): Promise<CampaignTestResultDto> {
    return this.service.sendTest(user.id, { title: dto.title, body: dto.body, channel: dto.channel });
  }

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
      title: dto.title,
      body: dto.body,
      channel: dto.channel as CampaignChannel,
      ...spec,
    });
    return toCampaignDto(row);
  }

  /**
   * Starts the send — or retries a failed / stuck one — and answers at once
   * with the row in SENDING. Poll the list for the counters.
   */
  @Post(':id/send')
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: CampaignDto })
  async send(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<CampaignDto> {
    const brandId = await this.resolveBrandIdForCampaign(user, id);
    const row = await this.service.send(brandId, id);
    const stats = await this.service.stats([row.id]);
    return toCampaignDto(row, stats.get(row.id));
  }

  @Delete(':id')
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    const brandId = await this.resolveBrandIdForCampaign(user, id);
    await this.service.deleteDraft(brandId, id);
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

function toCampaignDto(c: Campaign, stats: CampaignStats = emptyCampaignStats()): CampaignDto {
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
    startedAt: c.startedAt ? c.startedAt.toISOString() : null,
    sentAt: c.sentAt ? c.sentAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  };
}
