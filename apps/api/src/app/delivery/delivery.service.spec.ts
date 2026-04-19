import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { DeliveryService } from './delivery.service';

/**
 * Covers the state machine — every rider-driven transition is guarded by
 * ownership + status checks, and a mis-wired guard would silently let a
 * DELIVERED order flip back to READY or let a rider modify someone else's
 * delivery. These are the places regressions hurt most.
 */
interface PrismaMock {
  order: {
    findUnique: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    findMany: jest.Mock;
  };
  userStore: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
  };
}

describe('DeliveryService', () => {
  let service: DeliveryService;
  let prisma: PrismaMock;
  let realtime: jest.Mocked<Pick<RealtimeGateway, 'emitOrderStatusChanged' | 'emitKdsOrderChanged'>>;
  let notifications: { notifyOrderStatus: jest.Mock };

  const RIDER_ID = 'rider-1';
  const ORDER_ID = 'order-1';
  const STORE_ID = 'store-1';

  beforeEach(() => {
    prisma = {
      order: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      userStore: {
        findUnique: jest.fn().mockResolvedValue({ userId: RIDER_ID, storeId: STORE_ID }),
        findMany: jest.fn().mockResolvedValue([{ storeId: STORE_ID }]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ role: 'RIDER' }),
      },
    };
    realtime = {
      emitOrderStatusChanged: jest.fn(),
      emitKdsOrderChanged: jest.fn(),
    };
    notifications = { notifyOrderStatus: jest.fn().mockResolvedValue(undefined) };

    service = new DeliveryService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeGateway,
      notifications as unknown as NotificationsService,
    );
  });

  describe('transition', () => {
    it('READY → OUT_FOR_DELIVERY sets outForDeliveryAt + emits KDS remove + dispatch update', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: ORDER_ID,
        storeId: STORE_ID,
        userId: 'cust-1',
        orderCode: '1234',
        fulfillmentType: 'DELIVERY',
        status: 'READY',
        riderId: RIDER_ID,
      });
      prisma.order.update.mockResolvedValueOnce({
        id: ORDER_ID,
        storeId: STORE_ID,
        userId: 'cust-1',
        orderCode: '1234',
        fulfillmentType: 'DELIVERY',
        status: 'OUT_FOR_DELIVERY',
        outForDeliveryAt: new Date(),
        deliveredAt: null,
      });

      const result = await service.transition(ORDER_ID, RIDER_ID, 'OUT_FOR_DELIVERY');

      expect(result.status).toBe('OUT_FOR_DELIVERY');
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'OUT_FOR_DELIVERY', outForDeliveryAt: expect.any(Date) }),
        }),
      );
      expect(realtime.emitKdsOrderChanged).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'removed', storeId: STORE_ID }),
      );
      expect(realtime.emitOrderStatusChanged).toHaveBeenCalled();
    });

    it('refuses OUT_FOR_DELIVERY from non-READY status', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: ORDER_ID,
        storeId: STORE_ID,
        fulfillmentType: 'DELIVERY',
        status: 'ACCEPTED',
        riderId: RIDER_ID,
      });
      await expect(service.transition(ORDER_ID, RIDER_ID, 'OUT_FOR_DELIVERY')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('OUT_FOR_DELIVERY → DELIVERED sets deliveredAt', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: ORDER_ID,
        storeId: STORE_ID,
        userId: 'cust-1',
        orderCode: '1234',
        fulfillmentType: 'DELIVERY',
        status: 'OUT_FOR_DELIVERY',
        riderId: RIDER_ID,
      });
      prisma.order.update.mockResolvedValueOnce({
        id: ORDER_ID,
        storeId: STORE_ID,
        userId: 'cust-1',
        orderCode: '1234',
        fulfillmentType: 'DELIVERY',
        status: 'DELIVERED',
        outForDeliveryAt: new Date(Date.now() - 60_000),
        deliveredAt: new Date(),
      });

      const result = await service.transition(ORDER_ID, RIDER_ID, 'DELIVERED');

      expect(result.status).toBe('DELIVERED');
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DELIVERED', deliveredAt: expect.any(Date) }),
        }),
      );
    });

    it('refuses transition when the caller is not the assigned rider', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: ORDER_ID,
        storeId: STORE_ID,
        fulfillmentType: 'DELIVERY',
        status: 'READY',
        riderId: 'someone-else',
      });
      await expect(service.transition(ORDER_ID, RIDER_ID, 'OUT_FOR_DELIVERY')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses to transition a PICKUP order through the rider flow', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: ORDER_ID,
        fulfillmentType: 'PICKUP',
        status: 'READY',
        riderId: null,
      });
      await expect(service.transition(ORDER_ID, RIDER_ID, 'OUT_FOR_DELIVERY')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('404s when the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValueOnce(null);
      await expect(service.transition(ORDER_ID, RIDER_ID, 'OUT_FOR_DELIVERY')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('selfAssign race guard', () => {
    it('refuses if a competing rider already claimed the order (updateMany returns count=0)', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: ORDER_ID,
        storeId: STORE_ID,
        fulfillmentType: 'DELIVERY',
        status: 'READY',
        riderId: null,
      });
      prisma.order.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.selfAssign(ORDER_ID, RIDER_ID)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('claims successfully and emits a dispatch update', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: ORDER_ID,
        storeId: STORE_ID,
        fulfillmentType: 'DELIVERY',
        status: 'READY',
        riderId: null,
      });
      prisma.order.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.selfAssign(ORDER_ID, RIDER_ID);

      expect(result).toEqual({ id: ORDER_ID, riderId: RIDER_ID });
      // Dispatch change currently piggybacks on the KDS channel (orderId='*')
      // — once PR #54 lands it moves to emitDispatchChanged. Assert via the
      // generic `kind: 'updated'` payload so the test survives the swap.
      expect(realtime.emitKdsOrderChanged).toHaveBeenCalledWith(
        expect.objectContaining({ storeId: STORE_ID, kind: 'updated' }),
      );
    });

    it('refuses to claim an order already assigned to a different rider', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: ORDER_ID,
        storeId: STORE_ID,
        fulfillmentType: 'DELIVERY',
        status: 'READY',
        riderId: 'other-rider',
      });
      await expect(service.selfAssign(ORDER_ID, RIDER_ID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to claim a non-READY order', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: ORDER_ID,
        storeId: STORE_ID,
        fulfillmentType: 'DELIVERY',
        status: 'ACCEPTED',
        riderId: null,
      });
      await expect(service.selfAssign(ORDER_ID, RIDER_ID)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('assignRider scope check', () => {
    it('refuses when the rider is not rostered for the store', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: ORDER_ID,
        storeId: STORE_ID,
        fulfillmentType: 'DELIVERY',
        status: 'READY',
        userId: 'cust-1',
      });
      prisma.userStore.findUnique.mockResolvedValueOnce(null);

      await expect(service.assignRider(ORDER_ID, RIDER_ID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('refuses when the target user is not a RIDER', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: ORDER_ID,
        storeId: STORE_ID,
        fulfillmentType: 'DELIVERY',
        status: 'READY',
        userId: 'cust-1',
      });
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'STAFF' });

      await expect(service.assignRider(ORDER_ID, RIDER_ID)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
