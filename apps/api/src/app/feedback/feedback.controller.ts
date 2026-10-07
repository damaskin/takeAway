import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateFeedbackDto, FeedbackReceiptDto } from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

// Per IP, on top of the per-account hourly cap in the service. Dev gets a
// 10× multiplier, like the auth routes.
const FEEDBACK_PER_MINUTE = 5 * (process.env['NODE_ENV'] !== 'production' ? 10 : 1);

/** «Обратная связь» from the customer's profile — any signed-in account. */
@ApiTags('feedback')
@ApiBearerAuth()
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: FEEDBACK_PER_MINUTE, ttl: 60_000 } })
  @ApiCreatedResponse({ type: FeedbackReceiptDto })
  @ApiTooManyRequestsResponse({ description: '`FEEDBACK_TOO_MANY` — the hourly cap per account.' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFeedbackDto): Promise<FeedbackReceiptDto> {
    return this.feedback.create(user.id, dto);
  }
}
