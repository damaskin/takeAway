import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { DeliveryTransition } from './dto/update-delivery-status.dto';

/**
 * Delivery dispatch and rider flow.
 *
 * Dispatcher side (`STORE_MANAGER` / `BRAND_ADMIN`):
 *   - `queue()` — READY + unassigned delivery orders for a store
 *   - `assignRider()` — set Order.riderId (rider must be scoped to the store)
 *   - `availableRiders()` — RIDER users joined via UserStore
 *
 * Rider side (`RIDER`):
 *   - `myQueue()` — orders assigned to me OR unassigned+READY in my stores
 *   - `selfAssign()` — claim an unassigned ready order
 *   - `transition()` — READY → OUT_FOR_DELIVERY → DELIVERED
 *
 * Status machine (for DELIVERY orders only):
 *   READY → OUT_FOR_DELIVERY (rider collects from store)
 *   OUT_FOR_DELIVERY → DELIVERED (rider handed to customer; terminal)
 */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  /** Dispatcher queue — READY delivery orders (assigned + unassigned) in a store. */
  async queue(storeId: string) {
    const orders = await this.prisma.order.findMany({
      where: {
        storeId,
        fulfillmentType: 'DELIVERY',
        status: { in: ['READY', 'OUT_FOR_DELIVERY'] },
      },
      orderBy: { readyAt: 'asc' },
      include: {
        items: { select: { quantity: true } },
        rider: { select: { id: true, name: true, phone: true } },
      },
    });
    return orders.map((o) => this.toDispatchRow(o));
  }

  /**
   * Rider's queue:
   *   (a) orders assigned to me in any of my stores (any live status),
   *   (b) READY + unassigned orders in stores where I'm rostered
   *       (so the rider can self-claim from the same screen).
   */
  async myQueue(riderId: string) {
    const myStoreIds = await this.getRiderStoreIds(riderId);

    const orders = await this.prisma.order.findMany({
      where: {
        fulfillmentType: 'DELIVERY',
        OR: [
          { riderId, status: { in: ['READY', 'OUT_FOR_DELIVERY'] } },
          ...(myStoreIds.length > 0 ? [{ riderId: null, status: 'READY' as const, storeId: { in: myStoreIds } }] : []),
        ],
      },
      orderBy: [{ riderId: 'desc' }, { readyAt: 'asc' }],
      include: {
        items: { select: { quantity: true } },
        store: { select: { id: true, name: true, addressLine: true, city: true } },
      },
    });

    return orders.map((o) => ({
      ...this.toRiderRow(o),
      mine: o.riderId === riderId,
    }));
  }

  /** Manager-initiated rider assignment. Rider must be scoped to the store. */
  async assignRider(orderId: string, riderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, storeId: true, fulfillmentType: true, status: true, userId: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.fulfillmentType !== 'DELIVERY') {
      throw new BadRequestException('Only DELIVERY orders can be assigned to a rider');
    }
    if (!['READY', 'OUT_FOR_DELIVERY'].includes(order.status)) {
      throw new BadRequestException(`Cannot assign in status ${order.status}`);
    }
    await this.assertRiderInStore(riderId, order.storeId);

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        riderId,
        events: {
          create: {
            type: 'NOTE',
            actorId: riderId,
            payload: { kind: 'rider_assigned', riderId } satisfies Prisma.InputJsonValue,
          },
        },
      },
    });

    this.emitDispatchChange(updated.storeId, updated.id, 'updated');
    void this.notifications.notifyRider(
      {
        id: updated.id,
        userId: updated.userId,
        orderCode: updated.orderCode,
        storeId: updated.storeId,
        fulfillmentType: updated.fulfillmentType,
      },
      riderId,
      'assigned',
    );
    return { id: updated.id, riderId: updated.riderId };
  }

  /** Rider claims an unassigned READY order in one of their stores. */
  async selfAssign(orderId: string, riderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, storeId: true, fulfillmentType: true, status: true, riderId: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.fulfillmentType !== 'DELIVERY') {
      throw new BadRequestException('Only DELIVERY orders can be claimed');
    }
    if (order.status !== 'READY') throw new BadRequestException('Order is not ready yet');
    if (order.riderId && order.riderId !== riderId) {
      throw new ForbiddenException('Order is already assigned to another rider');
    }
    await this.assertRiderInStore(riderId, order.storeId);

    // Use updateMany with a conditional `riderId: null` guard so two riders
    // tapping "claim" at the same time can't both succeed — Postgres will
    // pick exactly one winner.
    const result = await this.prisma.order.updateMany({
      where: { id: orderId, riderId: null },
      data: { riderId },
    });
    if (result.count === 0) {
      throw new ForbiddenException('Someone else just claimed this order');
    }

    this.emitDispatchChange(order.storeId, orderId, 'updated');
    return { id: orderId, riderId };
  }

  /**
   * Rider-driven status transition. Enforces the delivery-only state machine
   * and that the caller is the assigned rider.
   */
  async transition(orderId: string, riderId: string, to: DeliveryTransition) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.fulfillmentType !== 'DELIVERY') {
      throw new BadRequestException('Only DELIVERY orders have rider transitions');
    }
    if (order.riderId !== riderId) {
      throw new ForbiddenException('This order is not assigned to you');
    }

    const now = new Date();
    const patch: Prisma.OrderUpdateInput = { status: to };
    if (to === 'OUT_FOR_DELIVERY') {
      if (order.status !== 'READY') {
        throw new BadRequestException(`Cannot go OUT_FOR_DELIVERY from ${order.status}`);
      }
      patch.outForDeliveryAt = now;
    } else {
      // DELIVERED
      if (order.status !== 'OUT_FOR_DELIVERY') {
        throw new BadRequestException(`Cannot go DELIVERED from ${order.status}`);
      }
      patch.deliveredAt = now;
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        ...patch,
        events: {
          create: {
            type: 'STATUS_CHANGED',
            actorId: riderId,
            payload: { from: order.status, to } satisfies Prisma.InputJsonValue,
          },
        },
      },
    });

    // Notify customer + dispatchers + rider.
    this.realtime.emitOrderStatusChanged(
      {
        orderId: updated.id,
        status: updated.status,
        etaSeconds: 0,
        occurredAt: now.toISOString(),
      },
      updated.userId,
    );

    // Push notification to the customer (Telegram today + iOS/Android stubs).
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

    // OUT_FOR_DELIVERY removes the order from the KDS barista board since
    // the rider has physically taken the bag and it's no longer on the
    // kitchen's plate. DELIVERED is a rider-only terminal, so we just nudge
    // the dispatcher queue to refresh (DELIVERED rows drop out of the
    // queue() filter automatically).
    if (to === 'OUT_FOR_DELIVERY') {
      this.realtime.emitKdsOrderChanged({
        storeId: updated.storeId,
        kind: 'removed',
        orderId: updated.id,
        order: null,
      });
      // Dispatcher keeps OUT_FOR_DELIVERY rows in its queue — it's now "en route"
      // state that still needs visibility, just no longer actionable.
      this.emitDispatchChange(updated.storeId, updated.id, 'updated');
    } else {
      // DELIVERED — drop from dispatch queue entirely.
      this.emitDispatchChange(updated.storeId, updated.id, 'removed');
    }

    return {
      id: updated.id,
      status: updated.status,
      outForDeliveryAt: updated.outForDeliveryAt?.toISOString() ?? null,
      deliveredAt: updated.deliveredAt?.toISOString() ?? null,
    };
  }

  /** Riders available for a store (rostered via UserStore with role RIDER). */
  async availableRiders(storeId: string) {
    const rows = await this.prisma.userStore.findMany({
      where: { storeId, user: { role: 'RIDER', blockedAt: null } },
      include: { user: { select: { id: true, name: true, phone: true } } },
    });
    return rows.map((r) => ({ id: r.user.id, name: r.user.name, phone: r.user.phone }));
  }

  private async getRiderStoreIds(riderId: string): Promise<string[]> {
    const rows = await this.prisma.userStore.findMany({
      where: { userId: riderId },
      select: { storeId: true },
    });
    return rows.map((r) => r.storeId);
  }

  private async assertRiderInStore(riderId: string, storeId: string): Promise<void> {
    const row = await this.prisma.userStore.findUnique({
      where: { userId_storeId: { userId: riderId, storeId } },
    });
    if (!row) {
      throw new ForbiddenException('Rider is not rostered for this store');
    }
    const rider = await this.prisma.user.findUnique({ where: { id: riderId }, select: { role: true } });
    if (rider?.role !== 'RIDER') {
      throw new BadRequestException('Target user is not a RIDER');
    }
  }

  private emitDispatchChange(storeId: string, orderId: string, kind: 'created' | 'updated' | 'removed'): void {
    this.realtime.emitDispatchChanged({ storeId, kind, orderId });
  }

  private toDispatchRow(o: {
    id: string;
    orderCode: string;
    status: string;
    pickupAt: Date;
    readyAt: Date | null;
    totalCents: number;
    deliveryFeeCents: number;
    currency: string;
    customerName: string | null;
    customerPhone: string | null;
    deliveryAddressLine: string | null;
    deliveryCity: string | null;
    deliveryNotes: string | null;
    riderId: string | null;
    rider: { id: string; name: string | null; phone: string | null } | null;
    items: Array<{ quantity: number }>;
    createdAt: Date;
  }) {
    return {
      id: o.id,
      orderCode: o.orderCode,
      status: o.status,
      pickupAt: o.pickupAt.toISOString(),
      readyAt: o.readyAt?.toISOString() ?? null,
      totalCents: o.totalCents,
      deliveryFeeCents: o.deliveryFeeCents,
      currency: o.currency,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      deliveryAddressLine: o.deliveryAddressLine,
      deliveryCity: o.deliveryCity,
      deliveryNotes: o.deliveryNotes,
      riderId: o.riderId,
      rider: o.rider,
      itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
      createdAt: o.createdAt.toISOString(),
    };
  }

  private toRiderRow(o: {
    id: string;
    orderCode: string;
    status: string;
    pickupAt: Date;
    readyAt: Date | null;
    totalCents: number;
    deliveryFeeCents: number;
    currency: string;
    customerName: string | null;
    customerPhone: string | null;
    deliveryAddressLine: string | null;
    deliveryCity: string | null;
    deliveryNotes: string | null;
    riderId: string | null;
    storeId: string;
    store: { id: string; name: string; addressLine: string; city: string };
    items: Array<{ quantity: number }>;
    createdAt: Date;
  }) {
    return {
      id: o.id,
      orderCode: o.orderCode,
      status: o.status,
      pickupAt: o.pickupAt.toISOString(),
      readyAt: o.readyAt?.toISOString() ?? null,
      totalCents: o.totalCents,
      deliveryFeeCents: o.deliveryFeeCents,
      currency: o.currency,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      deliveryAddressLine: o.deliveryAddressLine,
      deliveryCity: o.deliveryCity,
      deliveryNotes: o.deliveryNotes,
      riderId: o.riderId,
      store: o.store,
      itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
      createdAt: o.createdAt.toISOString(),
    };
  }
}
