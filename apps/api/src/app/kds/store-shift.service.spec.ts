import { Prisma } from '@prisma/client';

import type { KitchenLoadService } from '../kitchen/kitchen-load.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import type { StoreAvailabilityNotifier } from '../realtime/store-availability.notifier';
import { customerArrival } from './kds.service';
import { StoreShiftService } from './store-shift.service';

function harness(openShift: { id: string } | null = null, initialStatus: 'OPEN' | 'OVERLOADED' | 'CLOSED' = 'OPEN') {
  let status: string = initialStatus;
  const prisma = {
    store: {
      findUnique: jest.fn(async () => ({
        id: 'store-1',
        status,
        busyMeter: 0,
        baseEtaSeconds: 600,
        kitchenParallelism: 2,
      })),
      updateMany: jest.fn(async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
        if (where.status !== status) return { count: 0 };
        status = data.status;
        return { count: 1 };
      }),
    },
    storeShift: {
      findFirst: jest.fn(async ({ where }: { where: { closedAt?: null } }) => {
        if ('closedAt' in where) return openShift;
        return openShift
          ? {
              id: openShift.id,
              storeId: 'store-1',
              openedAt: new Date('2026-09-26T07:00:00Z'),
              closedAt: null,
              openedBy: { name: 'Анна', email: null },
              closedBy: null,
            }
          : null;
      }),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const realtime = { emitKdsShiftChanged: jest.fn(), emitStoreLoad: jest.fn() };
  const availability = { announce: jest.fn().mockResolvedValue(undefined) };
  const kitchen = { queueWaitSeconds: jest.fn().mockResolvedValue(240) };
  const service = new StoreShiftService(
    prisma as unknown as PrismaService,
    realtime as unknown as RealtimeGateway,
    availability as unknown as StoreAvailabilityNotifier,
    kitchen as unknown as KitchenLoadService,
  );
  return { service, prisma, realtime, availability, status: () => status };
}

describe('StoreShiftService', () => {
  it('reports a store that never had a shift as closed', async () => {
    const { service } = harness();
    await expect(service.current('store-1')).resolves.toEqual({
      storeId: 'store-1',
      open: false,
      openedAt: null,
      openedByName: null,
      closedAt: null,
      closedByName: null,
      busy: false,
    });
  });

  it('opens a shift once and tells every kitchen screen of the store', async () => {
    const { service, prisma, realtime } = harness();
    await service.open('store-1', 'staff-1');
    expect(prisma.storeShift.create).toHaveBeenCalledWith({ data: { storeId: 'store-1', openedById: 'staff-1' } });
    expect(realtime.emitKdsShiftChanged).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store-1' }));
  });

  it('does not open a second shift when one is already open', async () => {
    const { service, prisma } = harness({ id: 'shift-1' });
    const shift = await service.open('store-1', 'staff-2');
    expect(prisma.storeShift.create).not.toHaveBeenCalled();
    expect(shift.open).toBe(true);
    expect(shift.openedByName).toBe('Анна');
  });

  it('treats losing the race to another tablet as success', async () => {
    const { service, prisma } = harness();
    prisma.storeShift.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
    );
    await expect(service.open('store-1', 'staff-1')).resolves.toMatchObject({ storeId: 'store-1' });
  });

  it('closes whatever shift is open and records who closed it', async () => {
    const { service, prisma } = harness({ id: 'shift-1' });
    await service.close('store-1', 'staff-1');
    expect(prisma.storeShift.updateMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', closedAt: null },
      data: { closedAt: expect.any(Date), closedById: 'staff-1' },
    });
  });

  it.each(['open', 'close'] as const)(
    'announces to every client whether the store takes orders after %s',
    async (action) => {
      const { service, availability } = harness(action === 'close' ? { id: 'shift-1' } : null);
      await service[action]('store-1', 'staff-1');
      expect(availability.announce).toHaveBeenCalledWith('store-1');
    },
  );

  it('answers 404 for a store that does not exist', async () => {
    const { service, prisma } = harness();
    prisma.store.findUnique.mockResolvedValue(null as never);
    await expect(service.open('nope', 'staff-1')).rejects.toMatchObject({ status: 404 });
  });

  describe('«Загружены»', () => {
    it('marks the store OVERLOADED and tells the kitchens, the storefronts and the load channel', async () => {
      const { service, realtime, availability, status } = harness({ id: 'shift-1' });
      const shift = await service.setBusy('store-1', true);

      expect(status()).toBe('OVERLOADED');
      expect(shift.busy).toBe(true);
      expect(realtime.emitKdsShiftChanged).toHaveBeenCalledWith({
        storeId: 'store-1',
        shift: expect.objectContaining({ busy: true, open: true }),
      });
      expect(availability.announce).toHaveBeenCalledWith('store-1');
      // Full meter, and the ETA is still the real queue: base 600 + 240 waiting.
      expect(realtime.emitStoreLoad).toHaveBeenCalledWith({
        storeId: 'store-1',
        busy: true,
        busyMeter: 100,
        currentEtaSeconds: 840,
      });
    });

    it('switches back to OPEN, and does nothing the second time', async () => {
      const { service, prisma, status } = harness({ id: 'shift-1' }, 'OVERLOADED');
      await expect(service.setBusy('store-1', false)).resolves.toMatchObject({ busy: false });
      expect(status()).toBe('OPEN');
      prisma.store.updateMany.mockClear();
      await service.setBusy('store-1', false);
      expect(prisma.store.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a store that is switched off with STORE_SWITCHED_OFF and leaves it off', async () => {
      const { service, status } = harness(null, 'CLOSED');
      await expect(service.setBusy('store-1', true)).rejects.toMatchObject({
        status: 409,
        response: { code: 'STORE_SWITCHED_OFF' },
      });
      expect(status()).toBe('CLOSED');
    });

    it('is cleared when the shift ends, so tomorrow does not open busy', async () => {
      const { service, status, realtime } = harness({ id: 'shift-1' }, 'OVERLOADED');
      await service.close('store-1', 'staff-1');
      expect(status()).toBe('OPEN');
      expect(realtime.emitStoreLoad).toHaveBeenCalledWith(expect.objectContaining({ busy: false, busyMeter: 0 }));
    });
  });
});

describe('customerArrival', () => {
  const at = (iso: string) => new Date(iso);

  it('is empty until the customer sends anything', () => {
    expect(customerArrival([])).toEqual({ customerArrival: null, customerArrivedAt: null });
  });

  it('shows the customer as here once they tapped "I\'m here", even after a nearby ping', () => {
    expect(
      customerArrival([
        { type: 'CUSTOMER_NEARBY', createdAt: at('2026-09-26T08:00:00Z') },
        { type: 'CUSTOMER_HERE', createdAt: at('2026-09-26T08:03:00Z') },
      ]),
    ).toEqual({ customerArrival: 'HERE', customerArrivedAt: '2026-09-26T08:03:00.000Z' });
  });

  it('shows the customer as nearby before they arrive', () => {
    expect(customerArrival([{ type: 'CUSTOMER_NEARBY', createdAt: at('2026-09-26T08:00:00Z') }])).toEqual({
      customerArrival: 'NEARBY',
      customerArrivedAt: '2026-09-26T08:00:00.000Z',
    });
  });
});
