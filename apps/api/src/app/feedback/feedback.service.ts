import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type FeedbackKind, FeedbackSource, FeedbackStatus, type Prisma } from '@prisma/client';
import { normalizeContact } from '@takeaway/utils';

import { PrismaService } from '../prisma/prisma.service';
import type {
  AdminFeedbackDto,
  AdminFeedbackPageDto,
  AdminFeedbackQueryDto,
  CreateFeedbackDto,
  CreateSiteSupportDto,
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

/**
 * Messages one email or phone may send through the site's support form in a
 * sliding hour — the visitor's own cap, since without an account there is
 * none to count. The route also caps each client address (FeedbackController).
 */
export const SITE_SUPPORT_PER_CONTACT_PER_HOUR = 3;

/** 400 codes of the site's support form. */
export const SiteSupportError = {
  /** A visitor without an account left no way to answer them. */
  CONTACT_REQUIRED: 'SUPPORT_CONTACT_REQUIRED',
  /** The contact reads as neither an email nor a phone number. */
  CONTACT_INVALID: 'SUPPORT_CONTACT_INVALID',
} as const;

const DEFAULT_PAGE_SIZE = 25;

const ADMIN_FEEDBACK_SELECT = {
  id: true,
  kind: true,
  message: true,
  contact: true,
  name: true,
  source: true,
  appVersion: true,
  status: true,
  createdAt: true,
  readAt: true,
  user: { select: { id: true, name: true, email: true, phone: true, telegramUserId: true, blockedAt: true } },
  brand: { select: { id: true, name: true, contactPhone: true } },
} satisfies Prisma.FeedbackSelect;

type AdminFeedbackRow = Prisma.FeedbackGetPayload<{ select: typeof ADMIN_FEEDBACK_SELECT }>;

/**
 * Customer feedback («Обратная связь»): customers write it from their
 * profile, visitors from the site's «Поддержка» page, businesses from the
 * admin; the platform team reads it all in the admin.
 */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: FeedbackNotifier,
  ) {}

  /**
   * Saves the customer's message and tells the platform team. 429
   * `FEEDBACK_TOO_MANY` past {@link FEEDBACK_PER_HOUR} messages an hour.
   */
  async create(userId: string, dto: CreateFeedbackDto, now = new Date()): Promise<FeedbackReceiptDto> {
    await this.assertUnderHourlyCap(userId, now);

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

  /**
   * A message from a brand's staff in the business admin — «Написать в
   * поддержку», or the plan-change request behind «Перейти на PRO». Lands
   * in the same inbox and pings the platform team the same way, with the
   * brand and its phone attached. Same hourly cap as customers.
   */
  async createFromBusiness(
    userId: string,
    brandId: string,
    input: { kind: FeedbackKind; message: string },
    now = new Date(),
  ): Promise<FeedbackReceiptDto> {
    await this.assertUnderHourlyCap(userId, now);
    const saved = await this.prisma.feedback.create({
      data: {
        userId,
        brandId,
        kind: input.kind,
        message: input.message.trim(),
        source: FeedbackSource.BUSINESS,
      },
      select: { id: true, createdAt: true },
    });
    void this.notifier.feedbackReceived(saved.id);
    return { id: saved.id, createdAt: saved.createdAt.toISOString() };
  }

  /**
   * A message from the site's «Поддержка» page — it replaced the Telegram
   * bot there, which only sends notifications and never read what customers
   * wrote to it. Open to visitors without an account: they leave an email or
   * a phone (stored in one canonical form) and, if they like, a name. A
   * signed-in customer's message is filed under their account, a contact
   * being optional then. Lands in the same inbox and pings the platform team
   * like any feedback.
   *
   * Anti-spam: a filled honeypot field is dropped without a word, a contact
   * gets {@link SITE_SUPPORT_PER_CONTACT_PER_HOUR} messages an hour and an
   * account the usual {@link FEEDBACK_PER_HOUR}; the route caps each client
   * address on top.
   */
  async createFromSite(userId: string | null, dto: CreateSiteSupportDto, now = new Date()): Promise<void> {
    if (dto.website) {
      this.logger.warn('Site support message dropped: the honeypot field was filled');
      return;
    }
    const contact = dto.contact ? normalizeContact(dto.contact) : null;
    if (dto.contact && !contact) {
      throw badRequest(SiteSupportError.CONTACT_INVALID, 'contact must be an email address or a phone number');
    }
    if (!userId && !contact) {
      throw badRequest(SiteSupportError.CONTACT_REQUIRED, 'Leave an email or a phone number to answer you on');
    }
    if (userId) await this.assertUnderHourlyCap(userId, now);
    if (contact) await this.assertContactUnderHourlyCap(contact.value, now);

    const saved = await this.prisma.feedback.create({
      data: {
        userId,
        kind: dto.kind,
        message: dto.message.trim(),
        contact: contact?.value ?? null,
        // A signed-in author is the account; the name is for visitors.
        name: userId ? null : dto.name?.trim() || null,
        source: FeedbackSource.WEB,
      },
      select: { id: true },
    });
    void this.notifier.feedbackReceived(saved.id);
  }

  /** 429 `FEEDBACK_TOO_MANY` past {@link FEEDBACK_PER_HOUR} messages from one account in an hour. */
  private async assertUnderHourlyCap(userId: string, now: Date): Promise<void> {
    const recent = await this.prisma.feedback.count({
      where: { userId, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } },
    });
    if (recent >= FEEDBACK_PER_HOUR) throw tooMany();
  }

  /** 429 `FEEDBACK_TOO_MANY` past {@link SITE_SUPPORT_PER_CONTACT_PER_HOUR} messages leaving one contact in an hour. */
  private async assertContactUnderHourlyCap(contact: string, now: Date): Promise<void> {
    const recent = await this.prisma.feedback.count({
      where: { contact, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } },
    });
    if (recent >= SITE_SUPPORT_PER_CONTACT_PER_HOUR) throw tooMany();
  }

  /** Newest first. Without a status filter, everything that is not archived. */
  async list(query: AdminFeedbackQueryDto): Promise<AdminFeedbackPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.FeedbackWhereInput = {
      status: query.status ?? { not: FeedbackStatus.ARCHIVED },
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.source ? { source: query.source } : {}),
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

function tooMany(): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      error: 'Too Many Requests',
      code: FEEDBACK_TOO_MANY,
      message: 'Too many messages in an hour, try again later',
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

function badRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ statusCode: HttpStatus.BAD_REQUEST, error: 'Bad Request', code, message });
}

function toAdminFeedback(row: AdminFeedbackRow): AdminFeedbackDto {
  const user = row.user;
  return {
    id: row.id,
    kind: row.kind,
    message: row.message,
    contact: row.contact,
    name: row.name,
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
    brand: row.brand,
  };
}
