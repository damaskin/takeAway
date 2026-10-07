import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { FeedbackStatus, type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type {
  AdminFeedbackDto,
  AdminFeedbackPageDto,
  AdminFeedbackQueryDto,
  CreateFeedbackDto,
  FeedbackReceiptDto,
} from './dto/feedback.dto';
import { FeedbackNotifier } from './feedback-notifier.service';

/**
 * How much one account may send in a sliding hour. Each message pings the
 * platform team in Telegram, so a stuck "send" button or a script must not
 * turn into a flood; a real customer never gets near it.
 */
export const FEEDBACK_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

export const FEEDBACK_TOO_MANY = 'FEEDBACK_TOO_MANY';

const DEFAULT_PAGE_SIZE = 25;

const ADMIN_FEEDBACK_SELECT = {
  id: true,
  kind: true,
  message: true,
  contact: true,
  source: true,
  appVersion: true,
  status: true,
  createdAt: true,
  readAt: true,
  user: { select: { id: true, name: true, email: true, phone: true, telegramUserId: true, blockedAt: true } },
} satisfies Prisma.FeedbackSelect;

type AdminFeedbackRow = Prisma.FeedbackGetPayload<{ select: typeof ADMIN_FEEDBACK_SELECT }>;

/**
 * Customer feedback («Обратная связь»): customers write it from their
 * profile, the platform team reads it in the admin.
 */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: FeedbackNotifier,
  ) {}

  /**
   * Saves the customer's message and tells the platform team. 429
   * `FEEDBACK_TOO_MANY` past {@link FEEDBACK_PER_HOUR} messages an hour.
   */
  async create(userId: string, dto: CreateFeedbackDto, now = new Date()): Promise<FeedbackReceiptDto> {
    const recent = await this.prisma.feedback.count({
      where: { userId, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } },
    });
    if (recent >= FEEDBACK_PER_HOUR) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          code: FEEDBACK_TOO_MANY,
          message: 'Too many messages in an hour, try again later',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const saved = await this.prisma.feedback.create({
      data: {
        userId,
        kind: dto.kind,
        message: dto.message.trim(),
        contact: dto.contact?.trim() || null,
        source: dto.source,
        appVersion: dto.appVersion?.trim() || null,
      },
      select: { id: true, createdAt: true },
    });
    void this.notifier.feedbackReceived(saved.id);
    return { id: saved.id, createdAt: saved.createdAt.toISOString() };
  }

  /** Newest first. Without a status filter, everything that is not archived. */
  async list(query: AdminFeedbackQueryDto): Promise<AdminFeedbackPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.FeedbackWhereInput = {
      status: query.status ?? { not: FeedbackStatus.ARCHIVED },
      ...(query.kind ? { kind: query.kind } : {}),
    };
    const [rows, total, newCount] = await Promise.all([
      this.prisma.feedback.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: ADMIN_FEEDBACK_SELECT,
      }),
      this.prisma.feedback.count({ where }),
      this.prisma.feedback.count({ where: { status: FeedbackStatus.NEW } }),
    ]);
    return { items: rows.map(toAdminFeedback), total, page, pageSize, newCount };
  }

  /** Unread feedback — the badge on «Обратная связь». */
  async newCount(): Promise<{ count: number }> {
    const count = await this.prisma.feedback.count({ where: { status: FeedbackStatus.NEW } });
    return { count };
  }

  /**
   * Read, archived, or back to unread. `readAt` remembers the first time it
   * was read and survives archiving; only "unread" clears it.
   */
  async setStatus(id: string, status: FeedbackStatus, now = new Date()): Promise<AdminFeedbackDto> {
    const current = await this.prisma.feedback.findUnique({ where: { id }, select: { readAt: true } });
    if (!current) throw new NotFoundException('Feedback not found');
    const updated = await this.prisma.feedback.update({
      where: { id },
      data: { status, readAt: status === FeedbackStatus.NEW ? null : (current.readAt ?? now) },
      select: ADMIN_FEEDBACK_SELECT,
    });
    return toAdminFeedback(updated);
  }
}

function toAdminFeedback(row: AdminFeedbackRow): AdminFeedbackDto {
  const user = row.user;
  return {
    id: row.id,
    kind: row.kind,
    message: row.message,
    contact: row.contact,
    source: row.source,
    appVersion: row.appVersion,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    author: user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          telegramUserId: user.telegramUserId?.toString() ?? null,
          // A deleted account is a blocked, scrubbed tombstone — the same
          // rule the customers list goes by.
          deleted: user.blockedAt !== null,
        }
      : null,
  };
}
