import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../auth/decorators/roles.decorator';
import {
  AdminFeedbackDto,
  AdminFeedbackPageDto,
  AdminFeedbackQueryDto,
  UpdateFeedbackStatusDto,
} from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

/** Customer feedback for the platform team — SUPER_ADMIN only. */
@ApiTags('admin: feedback')
@ApiBearerAuth()
@Controller('admin/feedback')
@Roles(Role.SUPER_ADMIN)
export class AdminFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  @ApiOkResponse({ type: AdminFeedbackPageDto })
  list(@Query() query: AdminFeedbackQueryDto): Promise<AdminFeedbackPageDto> {
    return this.feedback.list(query);
  }

  /** How many nobody has read yet — the badge on «Обратная связь». */
  @Get('new-count')
  @ApiOkResponse({ schema: { properties: { count: { type: 'number' } } } })
  newCount(): Promise<{ count: number }> {
    return this.feedback.newCount();
  }

  @Patch(':id')
  @ApiOkResponse({ type: AdminFeedbackDto })
  setStatus(@Param('id') id: string, @Body() dto: UpdateFeedbackStatusDto): Promise<AdminFeedbackDto> {
    return this.feedback.setStatus(id, dto.status);
  }
}
