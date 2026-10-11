import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalAuth } from '../auth/decorators/public.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateFeedbackDto, CreateSiteSupportDto, FeedbackReceiptDto } from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

// Dev gets a 10× multiplier, like the auth routes.
const DEV_MULTIPLIER = process.env['NODE_ENV'] !== 'production' ? 10 : 1;

// Per IP, on top of the per-account hourly cap in the service.
const FEEDBACK_PER_MINUTE = 5 * DEV_MULTIPLIER;

/**
 * The site's support form, per client: the address for a visitor, the
 * account for a signed-in customer (AppThrottlerGuard) — on top of the
 * per-contact and per-account caps in the service.
 */
export const SITE_SUPPORT_PER_HOUR = 3 * DEV_MULTIPLIER;

/**
 * «Обратная связь» from the customer's profile — any signed-in account —
 * and the site's «Поддержка» form, open to everyone.
 */
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

  /**
   * «Написать нам» on the site's «Поддержка» page. A visitor leaves an email
   * or a phone; a signed-in customer's message is linked to the account.
   * 204 whatever happens to it after validation — a bot filling the
   * honeypot gets the same answer as a person.
   */
  @Post('support')
  @OptionalAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: SITE_SUPPORT_PER_HOUR, ttl: 60 * 60_000 } })
  @ApiNoContentResponse({ description: 'Received.' })
  @ApiBadRequestResponse({
    description:
      '`SUPPORT_CONTACT_REQUIRED` — no contact without an account; `SUPPORT_CONTACT_INVALID` — neither an email nor a phone.',
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many from this address or account, or `FEEDBACK_TOO_MANY` — the hourly cap per contact.',
  })
  async support(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: CreateSiteSupportDto): Promise<void> {
    await this.feedback.createFromSite(user?.id ?? null, dto);
  }
}
