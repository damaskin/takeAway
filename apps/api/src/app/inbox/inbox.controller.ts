import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { InboxCountDto, InboxItemDto, InboxPageDto, InboxQueryDto } from './dto/inbox.dto';
import { InboxService } from './inbox.service';

/**
 * «Уведомления» of the signed-in customer: brand campaigns and platform
 * announcements. Every route is scoped to the caller's own messages.
 */
@ApiTags('inbox')
@ApiBearerAuth()
@Controller('inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @ApiOkResponse({ type: InboxPageDto })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: InboxQueryDto): Promise<InboxPageDto> {
    return this.inbox.list(user.id, { cursor: query.cursor, limit: query.limit });
  }

  /** The badge on the bell and on the profile. */
  @Get('unread-count')
  @ApiOkResponse({ type: InboxCountDto })
  async unreadCount(@CurrentUser() user: AuthenticatedUser): Promise<InboxCountDto> {
    return { count: await this.inbox.unreadCount(user.id) };
  }

  /** «Прочитать все». */
  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Every message is read' })
  async readAll(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.inbox.markAllRead(user.id);
  }

  /** One message — a tapped push opens it. */
  @Get(':id')
  @ApiOkResponse({ type: InboxItemDto })
  @ApiNotFoundResponse({ description: 'Not one of this customer’s messages' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<InboxItemDto> {
    return this.inbox.get(user.id, id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Read (already read is fine)' })
  @ApiNotFoundResponse({ description: 'Not one of this customer’s messages' })
  async read(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.inbox.markRead(user.id, id);
  }
}
