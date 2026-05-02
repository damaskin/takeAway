import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators/public.decorator';
import { PosService } from './pos.service';

interface PosterWebhookBody {
  /** Event identifier — Poster docs call this `object` (e.g. `transaction`, `product`). */
  object?: string;
  /** Verb on the object — `added`, `changed`, `deleted`, `transformed`. */
  action?: string;
  /** HMAC verification token when the integration is configured with one. */
  verify?: string;
  /** Per-event payload — opaque to us, the importer pulls afresh anyway. */
  data?: unknown;
  /** Some webhook flavours wrap the above in `body`. We accept both shapes. */
  body?: unknown;
}

/**
 * Public webhook ingress for back-offices that push state changes (Poster).
 * Bound under `/pos/webhooks` rather than `/admin/...` because the back-office
 * authenticates with its own signature, not a JWT — see {@link Public}.
 *
 * The endpoint always returns 200 once the body is accepted (signature
 * verified or absent). We never echo internal state to the back-office; if
 * the signature mismatches we return 200 + log silently to avoid leaking
 * "this brand exists / has an integration" information to scanners.
 */
@ApiTags('pos: webhooks')
@Controller('pos/webhooks')
export class PosWebhooksController {
  constructor(private readonly pos: PosService) {}

  /**
   * App-level Poster webhook. Poster sends events for ALL connected
   * accounts to a single URL configured in the application settings;
   * we resolve the right integration by `account_number` from the body.
   */
  @Public()
  @Post('poster')
  @HttpCode(HttpStatus.OK)
  async posterApp(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: PosterWebhookBody & { account_number?: string | number },
  ): Promise<{ accepted: boolean }> {
    const accountNumber = body.account_number == null ? null : String(body.account_number);
    const accepted = await this.pos.handlePosterAppWebhook(accountNumber, headers, body);
    return { accepted };
  }

  /**
   * Legacy per-tenant webhook. Pre-dates the app-catalog flow — kept so
   * existing single-tenant pilots don't break. New onboardings use the
   * URL above.
   */
  @Public()
  @Post('poster/:brandId')
  @HttpCode(HttpStatus.OK)
  async poster(
    @Param('brandId') brandId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: PosterWebhookBody,
  ): Promise<{ accepted: boolean }> {
    const accepted = await this.pos.handlePosterWebhook(brandId, headers, body);
    return { accepted };
  }
}
