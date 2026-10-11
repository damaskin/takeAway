import { Body, Controller, HttpCode, HttpStatus, NotFoundException, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiQuery, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BrandScopeService } from '../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateSupportDto, FeedbackReceiptDto } from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

const SUPPORT_PER_MINUTE = 5 * (process.env['NODE_ENV'] !== 'production' ? 10 : 1);

/**
 * «Написать в поддержку» from the business admin: anyone on a brand's staff
 * writes to the platform team. The message lands in the feedback inbox with
 * the brand attached and pings the team like customer feedback does.
 */
@ApiTags('business support')
@ApiBearerAuth()
@Controller('admin/support')
@Roles(Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.MENU_EDITOR, Role.STAFF)
export class BusinessSupportController {
  constructor(
    private readonly feedback: FeedbackService,
    private readonly brandScope: BrandScopeService,
  ) {}

  /** The brand picked in the admin header as `?brandId=`; without it, the first brand of the caller. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: SUPPORT_PER_MINUTE, ttl: 60_000 } })
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiCreatedResponse({ type: FeedbackReceiptDto })
  @ApiTooManyRequestsResponse({ description: '`FEEDBACK_TOO_MANY` — the hourly cap per account.' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSupportDto,
    @Query('brandId') brandId?: string,
  ): Promise<FeedbackReceiptDto> {
    const brand = await this.resolveBrand(user, brandId);
    return this.feedback.createFromBusiness(user.id, brand, { kind: dto.kind, message: dto.message });
  }

  private async resolveBrand(user: AuthenticatedUser, brandId?: string): Promise<string> {
    if (brandId) {
      await this.brandScope.assertBrand(user, brandId);
      return brandId;
    }
    const scope = await this.brandScope.resolveBrandIds(user);
    const first = scope?.[0];
    if (!first) throw new NotFoundException('No brand for the current user');
    return first;
  }
}
