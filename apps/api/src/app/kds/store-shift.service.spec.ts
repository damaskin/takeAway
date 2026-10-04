import { Prisma } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import type { StoreAvailabilityNotifier } from '../realtime/store-availability.notifier';
import { customerArrival } from './kds.service';
import { StoreShiftService } from './store-shift.service';

function harness(openShift: { id: string } | null = null) {
  const prisma = {
    store: { findUnique: jest.fn().mockResolvedValue({ id: 'store-1' }) },
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
  const realtime = { emitKdsShiftChanged: jest.fn() };
  const availability = { announce: jest.fn().mockResolvedValue(undefined) };
  const service = new StoreShiftService(
    prisma as unknown as PrismaService,
    realtime as unknown as RealtimeGateway,
    availability as unknown as StoreAvailabilityNotifier,
  );
  return { service, prisma, realtime, availability };
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
    prisma.store.findUnique.mockResolvedValue(null);
    await expect(service.open('nope', 'staff-1')).rejects.toMatchObject({ status: 404 });
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
