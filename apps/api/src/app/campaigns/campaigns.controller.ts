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
import { PrismaService } from '../prisma/prisma.service';
import { CampaignsService } from './campaigns.service';
import { CampaignDto, CreateCampaignDto } from './dto/campaigns.dto';

@ApiTags('campaigns')
@ApiBearerAuth()
@Controller('admin/campaigns')
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
    return rows.map(toCampaignDto);
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
    const row = await this.service.create({
      brandId: resolved,
      title: dto.title,
      body: dto.body,
      channel: dto.channel as CampaignChannel,
      audience: (dto.audience ?? 'ALL') as CampaignAudience,
    });
    return toCampaignDto(row);
  }

  @Post(':id/send')
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: CampaignDto })
  async send(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<CampaignDto> {
    const brandId = await this.resolveBrandIdForCampaign(user, id);
    const row = await this.service.send(brandId, id);
    return toCampaignDto(row);
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

  private async resolveBrandIdForCampaign(user: AuthenticatedUser, id: string): Promise<string> {
    const campaign = await this.prisma.campaign.findUnique({ where: { id }, select: { brandId: true } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    await this.brandScope.assertBrand(user, campaign.brandId);
    return campaign.brandId;
  }
}

function toCampaignDto(c: Campaign): CampaignDto {
  return {
    id: c.id,
    brandId: c.brandId,
    title: c.title,
    body: c.body,
    channel: c.channel as CampaignDto['channel'],
    audience: c.audience as CampaignDto['audience'],
    status: c.status as CampaignDto['status'],
    targetCount: c.targetCount,
    sentCount: c.sentCount,
    failedCount: c.failedCount,
    sentAt: c.sentAt ? c.sentAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  };
}
