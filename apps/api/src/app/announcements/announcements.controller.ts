import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { type Announcement, Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  type AnnouncementInput,
  type AnnouncementLink,
  type AnnouncementStats,
  AnnouncementsService,
  emptyAnnouncementStats,
  isDeletable,
  isEditable,
  isRetryable,
} from './announcements.service';
import {
  AnnouncementDto,
  AnnouncementPreviewDto,
  AnnouncementTestResultDto,
  CreateAnnouncementDto,
  TestAnnouncementDto,
  UpdateAnnouncementDto,
} from './dto/announcements.dto';

// Per account: a send reaches every customer of the platform. Dev gets 10x.
const DEV_MULTIPLIER = process.env['NODE_ENV'] !== 'production' ? 10 : 1;
const TESTS_PER_MINUTE = 10 * DEV_MULTIPLIER;
const SENDS_PER_MINUTE = 5 * DEV_MULTIPLIER;

/**
 * Platform announcements — the platform team writing to every customer who
 * allows promotional notifications, e.g. about a new partner. SUPER_ADMIN
 * only; no moderation, no plan gate.
 */
@ApiTags('admin: announcements')
@ApiBearerAuth()
@Controller('admin/announcements')
@Roles(Role.SUPER_ADMIN)
export class AnnouncementsController {
  constructor(private readonly service: AnnouncementsService) {}

  @Get()
  @ApiOkResponse({ type: AnnouncementDto, isArray: true })
  async list(): Promise<AnnouncementDto[]> {
    return this.toDtos(await this.service.list());
  }

  /** Who an announcement reaches now — the form shows it before sending. */
  @Get('preview')
  @ApiOkResponse({ type: AnnouncementPreviewDto })
  preview(): Promise<AnnouncementPreviewDto> {
    return this.service.preview();
  }

  /** «Отправить себе»: the copy to the signed-in admin only. */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: TESTS_PER_MINUTE, ttl: 60_000 } })
  @ApiOkResponse({ type: AnnouncementTestResultDto })
  async test(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TestAnnouncementDto,
  ): Promise<AnnouncementTestResultDto> {
    const link = await this.service.validateLink(dto.linkStoreId, dto.linkBrandId);
    return this.service.sendTest(user.id, { title: dto.title, body: dto.body, ...link });
  }

  @Get(':id')
  @ApiOkResponse({ type: AnnouncementDto })
  async get(@Param('id') id: string): Promise<AnnouncementDto> {
    return this.toDto(await this.service.get(id));
  }

  /** A new draft. Nothing goes out until «Отправить». */
  @Post()
  @ApiOkResponse({ type: AnnouncementDto })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAnnouncementDto): Promise<AnnouncementDto> {
    const link = await this.service.validateLink(dto.linkStoreId, dto.linkBrandId);
    const row = await this.service.create({
      title: dto.title,
      body: dto.body,
      ...link,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      createdById: user.id,
    });
    return this.toDto(row);
  }

  /** Edits a draft; 409 `ANNOUNCEMENT_NOT_EDITABLE` otherwise. */
  @Patch(':id')
  @ApiOkResponse({ type: AnnouncementDto })
  async update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto): Promise<AnnouncementDto> {
    const patch: Partial<AnnouncementInput> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.body !== undefined) patch.body = dto.body;
    if (dto.linkStoreId !== undefined || dto.linkBrandId !== undefined) {
      // A link is replaced as a pair: setting one clears the other.
      Object.assign(patch, await this.service.validateLink(dto.linkStoreId, dto.linkBrandId));
    }
    if (dto.scheduledAt !== undefined) patch.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    return this.toDto(await this.service.update(id, patch));
  }

  /**
   * «Отправить» a draft — now, or at its `scheduledAt` (SCHEDULED) — or
   * «Повторить» a failed, stuck or partly failed run. Answers at once.
   */
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: SENDS_PER_MINUTE, ttl: 60_000 } })
  @ApiOkResponse({ type: AnnouncementDto })
  async send(@Param('id') id: string): Promise<AnnouncementDto> {
    return this.toDto(await this.service.send(id));
  }

  /** «Отменить отправку»: SCHEDULED → DRAFT; 409 `ANNOUNCEMENT_NOT_SCHEDULED` otherwise. */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AnnouncementDto })
  async cancel(@Param('id') id: string): Promise<AnnouncementDto> {
    return this.toDto(await this.service.cancel(id));
  }

  /** A draft or a scheduled one; 409 `ANNOUNCEMENT_NOT_DELETABLE` once it has started. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async delete(@Param('id') id: string): Promise<void> {
    await this.service.delete(id);
  }

  private async toDto(row: Announcement): Promise<AnnouncementDto> {
    const [dto] = await this.toDtos([row]);
    return dto as AnnouncementDto;
  }

  private async toDtos(rows: Announcement[]): Promise<AnnouncementDto[]> {
    const ids = rows.map((r) => r.id);
    const [stats, links, people] = await Promise.all([
      this.service.stats(ids),
      this.service.links(rows),
      this.service.creators(rows),
    ]);
    return rows.map((r) => toAnnouncementDto(r, stats.get(r.id), links.get(r.id) ?? null, people.get(r.id) ?? null));
  }
}

export function toAnnouncementDto(
  a: Announcement,
  stats: AnnouncementStats = emptyAnnouncementStats(),
  link: AnnouncementLink | null = null,
  createdBy: AnnouncementDto['createdBy'] = null,
): AnnouncementDto {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    linkStoreId: a.linkStoreId,
    linkBrandId: a.linkBrandId,
    link,
    status: a.status,
    targetCount: a.targetCount,
    sentCount: a.sentCount,
    failedCount: a.failedCount,
    noChannelCount: a.noChannelCount,
    lastError: a.lastError,
    via: stats.via,
    errors: stats.errors,
    editable: isEditable(a),
    retryable: isRetryable(a),
    cancellable: a.status === 'SCHEDULED',
    deletable: isDeletable(a),
    scheduledAt: iso(a.scheduledAt),
    startedAt: iso(a.startedAt),
    sentAt: iso(a.sentAt),
    createdAt: a.createdAt.toISOString(),
    createdBy,
  };
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}
