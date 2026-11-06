import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../auth/decorators/roles.decorator';
import { AdminOrderReviewPageDto, AdminOrderReviewQueryDto } from './dto/order-review.dto';
import { OrderReviewsService } from './order-reviews.service';

/** Customers' reviews of their orders, for the platform team — SUPER_ADMIN only; brands never see them. */
@ApiTags('admin: order reviews')
@ApiBearerAuth()
@Controller('admin/order-reviews')
@Roles(Role.SUPER_ADMIN)
export class AdminOrderReviewsController {
  constructor(private readonly reviews: OrderReviewsService) {}

  @Get()
  @ApiOkResponse({ type: AdminOrderReviewPageDto })
  list(@Query() query: AdminOrderReviewQueryDto): Promise<AdminOrderReviewPageDto> {
    return this.reviews.list(query);
  }
}
