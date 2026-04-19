import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Order, OrderStatus, Prisma } from '@prisma/client';

import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const OPEN_STATUSES: OrderStatus[] = ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY'];

const ALLOWED_TRANSITIONS: Record<string, OrderStatus[]> = {
  accept: ['CREATED', 'PAID'],
  start: ['ACCEPTED'],
  ready: ['IN_PROGRESS'],
  pickedUp: ['READY'],
};

@Injectable()
export class KdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  async listOpen(storeId: string) {
    const orders = await this.prisma.order.findMany({
      where: { storeId, status: { in: OPEN_STATUSES } },
      orderBy: { pickupAt: 'asc' },
      include: { items: true },
    });

    return orders.map((o) => ({
      id: o.id,
      orderCode: o.orderCode,
      status: o.status,
      pickupMode: o.pickupMode,
      pickupAt: o.pickupAt.toISOString(),
      createdAt: o.createdAt.toISOString(),
      customerName: o.customerName,
      notes: o.notes,
      items: o.items.map((i) => ({
        productSnapshot: i.productSnapshot,
        quantity: i.quantity,
      })),
    }));
  }

  accept(storeId: string, orderId: string, staffUserId: string) {
    return this.transition(storeId, orderId, staffUserId, 'accept', {
      status: 'ACCEPTED',
      acceptedAt: new Date(),
    });
  }

  start(storeId: string, orderId: string, staffUserId: string) {
    return this.transition(storeId, orderId, staffUserId, 'start', {
      status: 'IN_PROGRESS',
      startedAt: new Date(),
    });
  }

  ready(storeId: string, orderId: string, staffUserId: string) {
    return this.transition(storeId, orderId, staffUserId, 'ready', {
      status: 'READY',
      readyAt: new Date(),
    });
  }

  pickedUp(storeId: string, orderId: string, staffUserId: string) {
    return this.transition(storeId, orderId, staffUserId, 'pickedUp', {
      status: 'PICKED_UP',
      pickedUpAt: new Date(),
    });
  }

  private async transition(
    storeId: string,
    orderId: string,
    staffUserId: string,
    key: keyof typeof ALLOWED_TRANSITIONS,
    patch: Partial<Order> & { status: OrderStatus },
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.storeId !== storeId) throw new NotFoundException('Order not found for this store');
    // DELIVERY orders never reach PICKED_UP — they move through OUT_FOR_DELIVERY
    // → DELIVERED via the rider flow. Guard in KDS so a barista can't fat-finger
    // the wrong button.
    if (key === 'pickedUp' && order.fulfillmentType === 'DELIVERY') {
      throw new BadRequestException('Delivery orders must be dispatched via the rider flow, not marked picked up');
    }
    const allowed = ALLOWED_TRANSITIONS[key] ?? [];
    if (!allowed.includes(order.status)) {
      throw new BadRequestException(`Cannot ${key} an order in status ${order.status}`);
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        ...patch,
        events: {
          create: {
            type: 'STATUS_CHANGED',
            actorId: staffUserId,
            payload: { from: order.status, to: patch.status } satisfies Prisma.InputJsonValue,
          },
        },
      },
    });

    this.realtime.emitOrderStatusChanged(
      {
        orderId: updated.id,
        status: updated.status,
        etaSeconds: 0,
        occurredAt: new Date().toISOString(),
      },
      updated.userId,
    );

    // Fire-and-forget: a push failure shouldn't block the kitchen from
    // advancing the order, so we don't await and don't let rejections
    // escape — NotificationsService already swallows provider errors.
    void this.notifications.notifyOrderStatus(
      {
        id: updated.id,
        userId: updated.userId,
        orderCode: updated.orderCode,
        storeId: updated.storeId,
        fulfillmentType: updated.fulfillmentType,
      },
      updated.status,
    );

    // Push to the kitchen board too. PICKED_UP orders leave the open list,
    // so we send a "removed" hint; everything else is an "updated" patch
    // carrying the fresh KDS row so the client can re-render in place.
    if (updated.status === 'PICKED_UP') {
      this.realtime.emitKdsOrderChanged({
        storeId: updated.storeId,
        kind: 'removed',
        orderId: updated.id,
        order: null,
      });
    } else {
      const [row] = await this.listOpenByIds(storeId, [updated.id]);
      this.realtime.emitKdsOrderChanged({
        storeId: updated.storeId,
        kind: 'updated',
        orderId: updated.id,
        order: row ?? null,
      });
    }

    return {
      id: updated.id,
      status: updated.status,
      orderCode: updated.orderCode,
      pickupAt: updated.pickupAt.toISOString(),
    };
  }

  /** Same mapping as listOpen() but filtered by specific ids — used to get a
   *  fresh row after a transition so the KDS socket payload is ready-to-paint. */
  private async listOpenByIds(storeId: string, ids: string[]) {
    const orders = await this.prisma.order.findMany({
      where: { storeId, id: { in: ids } },
      include: { items: true },
    });
    return orders.map((o) => ({
      id: o.id,
      orderCode: o.orderCode,
      status: o.status,
      pickupMode: o.pickupMode,
      pickupAt: o.pickupAt.toISOString(),
      createdAt: o.createdAt.toISOString(),
      customerName: o.customerName,
      notes: o.notes,
      items: o.items.map((i) => ({
        productSnapshot: i.productSnapshot,
        quantity: i.quantity,
      })),
    }));
  }
}
