import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OrderDto } from '../orders/dto/order.dto';
import { CreateOrderReviewDto } from './dto/order-review.dto';
import { OrderReviewsService } from './order-reviews.service';

// Per account. One review per order, so a real customer sends one now and
// then; this only stops a script. Dev gets 10x, like the other routes.
export const REVIEWS_PER_MINUTE = 10 * (process.env['NODE_ENV'] !== 'production' ? 10 : 1);

/** «Как вам заказ?» on the customer's order screen. */
@ApiTags('orders')
@ApiBearerAuth()
@Controller()
export class OrderReviewsController {
  constructor(private readonly reviews: OrderReviewsService) {}

  @Post('orders/:id/review')
  @Throttle({ default: { limit: REVIEWS_PER_MINUTE, ttl: 60_000 } })
  @ApiCreatedResponse({ type: OrderDto, description: 'The order with `review` set and `canReview` off.' })
  @ApiNotFoundResponse({ description: 'No such order of the caller.' })
  @ApiConflictResponse({
    description:
      '`ORDER_NOT_REVIEWABLE` — the order was not handed over (in work, cancelled or expired); ' +
      '`ORDER_ALREADY_REVIEWED` — a review is not edited.',
  })
  @ApiTooManyRequestsResponse()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateOrderReviewDto,
  ): Promise<OrderDto> {
    return this.reviews.create(user.id, id, dto);
  }
}
