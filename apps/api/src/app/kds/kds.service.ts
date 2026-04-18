import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Order, OrderStatus, Prisma } from '@prisma/client';

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

    return {
      id: updated.id,
      status: updated.status,
      orderCode: updated.orderCode,
      pickupAt: updated.pickupAt.toISOString(),
    };
  }
}
