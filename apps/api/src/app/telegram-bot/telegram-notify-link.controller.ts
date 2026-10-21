import { Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { TelegramNotifyLinkCode, TelegramNotifyStatus } from '@takeaway/shared-types';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { KdsSessionAllowed } from '../auth/decorators/kds-session.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { TelegramNotifyLinkService } from './telegram-notify-link.service';

const STATUS_SCHEMA = { properties: { linked: { type: 'boolean' }, botLinkAvailable: { type: 'boolean' } } };

/**
 * «Telegram» in the cabinet: where the signed-in employee, owner or platform
 * admin gets work notifications. A kitchen PIN session reaches it too — the
 * employee links their own phone from the tablet — and only for its own
 * account.
 */
@ApiTags('auth')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF, Role.RIDER)
@KdsSessionAllowed()
@Controller('auth/telegram/notify-link')
export class TelegramNotifyLinkController {
  constructor(private readonly links: TelegramNotifyLinkService) {}

  @Get()
  @ApiOkResponse({ schema: STATUS_SCHEMA })
  status(@CurrentUser() user: AuthenticatedUser): Promise<TelegramNotifyStatus> {
    return this.links.status(user.id);
  }

  /**
   * A one-time `https://t.me/<bot>?start=link_<code>` for about ten minutes;
   * the page shows it as a QR code and polls `GET` until it is linked.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOkResponse({ schema: { properties: { url: { type: 'string' }, expiresAt: { type: 'string' } } } })
  @ApiServiceUnavailableResponse({ description: 'TELEGRAM_NOTIFY_LINK_UNAVAILABLE — the bot has no webhook here' })
  issue(@CurrentUser() user: AuthenticatedUser): Promise<TelegramNotifyLinkCode> {
    return this.links.issue(user.id);
  }

  /** «Отвязать»: the bot stops writing to the linked chat. */
  @Delete()
  @ApiOkResponse({ schema: STATUS_SCHEMA })
  unlink(@CurrentUser() user: AuthenticatedUser): Promise<TelegramNotifyStatus> {
    return this.links.unlink(user.id);
  }
}
