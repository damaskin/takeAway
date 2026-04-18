import { randomBytes, randomInt } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Cart, CartItem, Order, Prisma, Product } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { OrderDto, OrderItemDto, OrderSummaryDto } from './dto/order.dto';

const ORDER_CODE_MAX_ATTEMPTS = 8;
const MIN_SCHEDULED_LEAD_MINUTES = 10;
const MAX_SCHEDULED_LEAD_HOURS = 24;
const CANCELLABLE_STATUSES = new Set<string>(['CREATED', 'PAID', 'ACCEPTED']);

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async create(userId: string, dto: CreateOrderDto): Promise<OrderDto> {
    const cart = await this.prisma.cart.findUnique({
      where: { id: dto.cartId },
      include: { items: { include: { product: true } }, store: true },
    });
    if (!cart) throw new NotFoundException('Cart not found');
    if (cart.userId !== userId) throw new ForbiddenException('Cart does not belong to the current user');
    if (cart.items.length === 0) throw new BadRequestException('Cart is empty');

    const pickupAt = this.resolvePickupAt(cart, dto);

    const subtotalCents = cart.items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
    if (subtotalCents < cart.store.minOrderCents) {
      throw new BadRequestException('Cart total below store minimum');
    }
    const discountCents = 0;
    const taxCents = 0;
    const totalCents = subtotalCents - discountCents + taxCents;

    const order = await this.withUniqueOrderCode((orderCode) =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            userId,
            storeId: cart.storeId,
            status: 'CREATED',
            fulfillmentType: dto.fulfillmentType ?? 'PICKUP',
            pickupMode: dto.pickupMode,
            pickupAt,
            subtotalCents,
            discountCents,
            taxCents,
            totalCents,
            currency: cart.store.currency,
            orderCode,
            qrToken: randomBytes(16).toString('hex'),
            customerName: dto.customerName,
            customerPhone: dto.customerPhone,
            notes: dto.notes,
            couponCode: dto.couponCode,
            items: {
              create: cart.items.map((i) => ({
                productSnapshot: this.snapshotItem(i) as Prisma.InputJsonValue,
                quantity: i.quantity,
                unitPriceCents: i.unitPriceCents,
                totalCents: i.unitPriceCents * i.quantity,
              })),
            },
            events: {
              create: {
                type: 'STATUS_CHANGED',
                actorId: userId,
                payload: { to: 'CREATED' } satisfies Prisma.InputJsonValue,
              },
            },
          },
          include: { items: true, store: true },
        });

        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        await tx.cart.update({
          where: { id: cart.id },
          data: { subtotalCents: 0, etaSeconds: 0 },
        });

        return created;
      }),
    );

    return this.toOrderDto(order);
  }

  async getForUser(userId: string, orderId: string): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, store: { select: { name: true } } },
    });
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found');
    return this.toOrderDto(order);
  }

  async listForUser(userId: string, take = 20): Promise<OrderSummaryDto[]> {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, take)),
      include: { items: { select: { quantity: true } }, store: { select: { name: true } } },
    });
    return orders.map((o) => ({
      id: o.id,
      orderCode: o.orderCode,
      status: o.status,
      pickupMode: o.pickupMode,
      pickupAt: o.pickupAt.toISOString(),
      totalCents: o.totalCents,
      currency: o.currency,
      storeId: o.storeId,
      storeName: o.store.name,
      itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
      createdAt: o.createdAt.toISOString(),
    }));
  }

  async cancel(userId: string, orderId: string): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found');
    if (!CANCELLABLE_STATUSES.has(order.status)) {
      throw new BadRequestException(`Cannot cancel an order in status ${order.status}`);
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        events: {
          create: {
            type: 'CANCELLED',
            actorId: userId,
            payload: { from: order.status } satisfies Prisma.InputJsonValue,
          },
        },
      },
      include: { items: true, store: { select: { name: true } } },
    });

    this.realtime.emitOrderStatusChanged(
      {
        orderId: updated.id,
        status: updated.status,
        etaSeconds: 0,
        occurredAt: (updated.cancelledAt ?? new Date()).toISOString(),
      },
      updated.userId,
    );

    return this.toOrderDto(updated);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private resolvePickupAt(
    cart: Cart & { store: { currentEtaSeconds: number }; items: CartItem[] },
    dto: CreateOrderDto,
  ): Date {
    if (dto.pickupMode === 'ASAP') {
      const etaSeconds = cart.etaSeconds > 0 ? cart.etaSeconds : cart.store.currentEtaSeconds;
      return new Date(Date.now() + etaSeconds * 1000);
    }
    if (!dto.pickupAt) {
      throw new BadRequestException('pickupAt is required for SCHEDULED pickup mode');
    }
    const minAt = new Date(Date.now() + MIN_SCHEDULED_LEAD_MINUTES * 60_000);
    const maxAt = new Date(Date.now() + MAX_SCHEDULED_LEAD_HOURS * 60 * 60_000);
    if (dto.pickupAt < minAt || dto.pickupAt > maxAt) {
      throw new BadRequestException(
        `Scheduled pickup must be between ${MIN_SCHEDULED_LEAD_MINUTES} min and ${MAX_SCHEDULED_LEAD_HOURS} h from now`,
      );
    }
    return dto.pickupAt;
  }

  private snapshotItem(item: CartItem & { product: Product }): Record<string, unknown> {
    return {
      id: item.product.id,
      slug: item.product.slug,
      name: item.product.name,
      variationIds: item.variationIds,
      modifiers: item.modifiersJson,
      notes: item.notes,
      unitPrepSeconds: item.unitPrepSeconds,
    };
  }

  private async withUniqueOrderCode<T extends Order>(
    fn: (code: string) => Promise<T>,
  ): Promise<T & { items: Array<unknown>; store?: { name?: string } }> {
    for (let attempt = 0; attempt < ORDER_CODE_MAX_ATTEMPTS; attempt++) {
      const code = String(randomInt(0, 10_000)).padStart(4, '0');
      try {
        return (await fn(code)) as T & { items: Array<unknown>; store?: { name?: string } };
      } catch (err) {
        const isUnique =
          typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'P2002';
        if (!isUnique) throw err;
      }
    }
    throw new ConflictException('Could not allocate a unique order code; please retry');
  }

  private toOrderDto(
    order: Order & {
      items: Array<{
        id: string;
        productSnapshot: unknown;
        quantity: number;
        unitPriceCents: number;
        totalCents: number;
      }>;
      store?: { name?: string | null } | null;
    },
  ): OrderDto {
    return {
      id: order.id,
      orderCode: order.orderCode,
      qrToken: order.qrToken,
      status: order.status,
      pickupMode: order.pickupMode,
      fulfillmentType: order.fulfillmentType,
      pickupAt: order.pickupAt.toISOString(),
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      currency: order.currency,
      storeId: order.storeId,
      storeName: order.store?.name ?? '',
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      notes: order.notes,
      couponCode: order.couponCode,
      items: order.items.map<OrderItemDto>((i) => ({
        id: i.id,
        productSnapshot: (i.productSnapshot as Record<string, unknown>) ?? {},
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        totalCents: i.totalCents,
      })),
      createdAt: order.createdAt.toISOString(),
      acceptedAt: order.acceptedAt?.toISOString() ?? null,
      startedAt: order.startedAt?.toISOString() ?? null,
      readyAt: order.readyAt?.toISOString() ?? null,
      pickedUpAt: order.pickedUpAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      expiredAt: order.expiredAt?.toISOString() ?? null,
    };
  }
}
