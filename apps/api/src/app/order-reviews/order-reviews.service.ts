import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrderReviewError } from '@takeaway/shared-types';

import { codedConflict } from '../common/http/coded-conflict';
import type { OrderDto } from '../orders/dto/order.dto';
import { OrdersService, isHandedOver } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AdminOrderReviewDto,
  AdminOrderReviewPageDto,
  AdminOrderReviewQueryDto,
  CreateOrderReviewDto,
  OrderReviewRatingCountsDto,
} from './dto/order-review.dto';

const DEFAULT_PAGE_SIZE = 25;

const ADMIN_REVIEW_SELECT = {
  id: true,
  rating: true,
  comment: true,
  createdAt: true,
  order: { select: { id: true, orderCode: true, customerName: true } },
  brand: { select: { id: true, name: true } },
  store: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, email: true, phone: true, telegramUserId: true, blockedAt: true } },
} satisfies Prisma.OrderReviewSelect;

type AdminReviewRow = Prisma.OrderReviewGetPayload<{ select: typeof ADMIN_REVIEW_SELECT }>;

/**
 * «Как вам заказ?»: the customer rates an order once it is in their hands,
 * and the platform team reads every review in the admin («Отзывы»). Brands
 * do not see them — nothing here is scoped to a brand's staff.
 */
@Injectable()
export class OrderReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  /**
   * Saves the customer's review of their own order and answers with the
   * order as their screen reads it — `review` set, `canReview` off.
   *
   * One review per order and no edits: a second one answers 409
   * `ORDER_ALREADY_REVIEWED` (the unique order id settles two sends racing
   * each other). Only a handed-over order (PICKED_UP or DELIVERED) takes
   * one; anything else — still in work, cancelled, expired — 409
   * `ORDER_NOT_REVIEWABLE`. Someone else's order is a 404, like reading it.
   */
  async create(userId: string, orderId: string, dto: CreateOrderReviewDto): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        status: true,
        storeId: true,
        store: { select: { brandId: true } },
        review: { select: { id: true } },
      },
    });
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found');
    if (!isHandedOver(order.status)) {
      throw codedConflict(OrderReviewError.NOT_REVIEWABLE, 'Only an order that was handed over can be reviewed');
    }
    if (order.review) throw alreadyReviewed();

    try {
      await this.prisma.orderReview.create({
        data: {
          orderId: order.id,
          userId,
          brandId: order.store.brandId,
          storeId: order.storeId,
          rating: dto.rating,
          comment: dto.comment?.trim() || null,
        },
        select: { id: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw alreadyReviewed();
      throw err;
    }
    return this.orders.getForUser(userId, orderId);
  }

  /**
   * Newest first, for the platform team. The summary on top — how many, the
   * average and how many gave each rating — counts the brand and the period
   * but not the rating filter.
   */
  async list(query: AdminOrderReviewQueryDto): Promise<AdminOrderReviewPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const scope: Prisma.OrderReviewWhereInput = {
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const where: Prisma.OrderReviewWhereInput = query.rating ? { ...scope, rating: query.rating } : scope;

    const [rows, total, byRating] = await Promise.all([
      this.prisma.orderReview.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: ADMIN_REVIEW_SELECT,
      }),
      this.prisma.orderReview.count({ where }),
      this.prisma.orderReview.groupBy({ by: ['rating'], where: scope, _count: { _all: true } }),
    ]);

    const ratingCounts: OrderReviewRatingCountsDto = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    let count = 0;
    let stars = 0;
    for (const group of byRating) {
      const n = group._count._all;
      ratingCounts[String(group.rating) as keyof OrderReviewRatingCountsDto] = n;
      count += n;
      stars += group.rating * n;
    }

    return {
      items: rows.map(toAdminReview),
      total,
      page,
      pageSize,
      count,
      averageRating: count > 0 ? Math.round((stars / count) * 10) / 10 : null,
      ratingCounts,
    };
  }
}

function alreadyReviewed() {
  return codedConflict(OrderReviewError.ALREADY_REVIEWED, 'This order is already reviewed');
}

function toAdminReview(row: AdminReviewRow): AdminOrderReviewDto {
  const user = row.user;
  // A deleted account is a blocked, scrubbed tombstone — the rule the
  // customers list and the feedback inbox go by. Its order lost the name
  // given at checkout too.
  const deleted = user.blockedAt !== null;
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    orderId: row.order.id,
    orderCode: row.order.orderCode,
    brand: row.brand,
    store: row.store,
    customer: {
      id: user.id,
      name: user.name ?? row.order.customerName ?? null,
      email: user.email,
      phone: user.phone,
      telegramUserId: user.telegramUserId?.toString() ?? null,
      deleted,
    },
  };
}
