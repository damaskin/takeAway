import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CampaignModerationService, type ModerationItem } from './campaign-moderation.service';
import { toCampaignDto } from './campaigns.controller';
import { CampaignModerationDto, CampaignModerationQueryDto, RejectCampaignDto } from './dto/campaigns.dto';

/**
 * The platform team's review of business campaigns — SUPER_ADMIN only, every
 * brand at once. Not behind the campaigns plan gate: the moderator works for
 * the platform, not for one brand.
 */
@ApiTags('admin: campaign moderation')
@ApiBearerAuth()
@Controller('admin/campaign-moderation')
@Roles(Role.SUPER_ADMIN)
export class CampaignModerationController {
  constructor(private readonly moderation: CampaignModerationService) {}

  /** The queue (oldest first, with who each campaign reaches now), or the latest decisions. */
  @Get()
  @ApiOkResponse({ type: CampaignModerationDto, isArray: true })
  async list(@Query() query: CampaignModerationQueryDto): Promise<CampaignModerationDto[]> {
    const items = await this.moderation.list(query.view ?? 'PENDING_REVIEW');
    return items.map(toModerationDto);
  }

  /** Campaigns waiting for a decision — the badge on «Модерация рассылок». */
  @Get('pending-count')
  @ApiOkResponse({ schema: { properties: { count: { type: 'number' } } } })
  pendingCount(): Promise<{ count: number }> {
    return this.moderation.pendingCount();
  }

  /** Approves; an unscheduled campaign starts going out at once. */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CampaignModerationDto })
  async approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<CampaignModerationDto> {
    return toModerationDto({ campaign: await this.moderation.approve(id, user), reach: null });
  }

  /** Rejects with the reason the business sees; they can fix it and resubmit. */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CampaignModerationDto })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectCampaignDto,
  ): Promise<CampaignModerationDto> {
    return toModerationDto({ campaign: await this.moderation.reject(id, user, dto.reason), reach: null });
  }
}

function toModerationDto({ campaign, reach }: ModerationItem): CampaignModerationDto {
  return {
    ...toCampaignDto(campaign),
    brand: campaign.brand,
    createdBy: campaign.createdBy,
    reviewedBy: campaign.reviewedBy,
    reach,
  };
}
