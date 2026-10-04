import {
  KITCHEN_REJECT_REASONS,
  applyKitchenEvent,
  awaitsAcceptance,
  canReject,
  inColumn,
  nextAction,
  rejectOutcomeKey,
} from './kitchen-board';
import type { KitchenOrder } from './kitchen.api';

function order(id: string, status: KitchenOrder['status']): KitchenOrder {
  return {
    id,
    orderCode: id.toUpperCase(),
    status,
    pickupMode: 'ASAP',
    pickupAt: '2026-09-26T10:00:00Z',
    createdAt: '2026-09-26T09:50:00Z',
    customerName: null,
    notes: null,
    items: [],
  };
}

describe('kitchen board', () => {
  it('keeps the three columns of the kitchen app', () => {
    expect(inColumn(order('a', 'PAID'), 'NEW')).toBe(true);
    expect(inColumn(order('a', 'ACCEPTED'), 'NEW')).toBe(true);
    expect(inColumn(order('a', 'IN_PROGRESS'), 'PREPARING')).toBe(true);
    expect(inColumn(order('a', 'READY'), 'READY')).toBe(true);
    expect(inColumn(order('a', 'READY'), 'NEW')).toBe(false);
  });

  it('offers one next step per ticket', () => {
    expect(nextAction(order('a', 'CREATED'))).toBe('accept');
    expect(nextAction(order('a', 'PAID'))).toBe('accept');
    expect(nextAction(order('a', 'ACCEPTED'))).toBe('start');
    expect(nextAction(order('a', 'IN_PROGRESS'))).toBe('ready');
    expect(nextAction(order('a', 'READY'))).toBe('pickedUp');
  });

  it('lets the kitchen turn down only orders nobody has accepted', () => {
    expect(canReject(order('a', 'CREATED'))).toBe(true);
    expect(canReject(order('a', 'PAID'))).toBe(true);
    expect(canReject(order('a', 'ACCEPTED'))).toBe(false);
    expect(canReject(order('a', 'IN_PROGRESS'))).toBe(false);
    expect(canReject(order('a', 'READY'))).toBe(false);
  });

  it('offers the four rejection reasons the API takes', () => {
    expect(KITCHEN_REJECT_REASONS).toEqual(['OUT_OF_STOCK', 'TOO_BUSY', 'CLOSING', 'OTHER']);
  });

  it('words the rejection notice by what happened to the money', () => {
    expect(rejectOutcomeKey('released')).toBe('admin.kitchen.reject.done.released');
    expect(rejectOutcomeKey('refunded')).toBe('admin.kitchen.reject.done.refunded');
    expect(rejectOutcomeKey('pending')).toBe('admin.kitchen.reject.done.pending');
    expect(rejectOutcomeKey('none')).toBe('admin.kitchen.reject.done.none');
  });

  it('counts only orders nobody has accepted as waiting', () => {
    expect(awaitsAcceptance({ status: 'PAID' })).toBe(true);
    expect(awaitsAcceptance({ status: 'CREATED' })).toBe(true);
    expect(awaitsAcceptance({ status: 'ACCEPTED' })).toBe(false);
  });

  describe('applyKitchenEvent', () => {
    const board = [order('a', 'PAID'), order('b', 'IN_PROGRESS')];

    it('adds a new order and replaces a known one in place', () => {
      const added = applyKitchenEvent(board, {
        storeId: 's',
        kind: 'created',
        orderId: 'c',
        order: order('c', 'PAID'),
      });
      expect(added?.map((o) => o.id)).toEqual(['a', 'b', 'c']);

      const moved = applyKitchenEvent(board, {
        storeId: 's',
        kind: 'updated',
        orderId: 'a',
        order: order('a', 'ACCEPTED'),
      });
      expect(moved?.map((o) => o.status)).toEqual(['ACCEPTED', 'IN_PROGRESS']);
    });

    it('takes a closed or removed order off the board', () => {
      const picked = applyKitchenEvent(board, {
        storeId: 's',
        kind: 'updated',
        orderId: 'b',
        order: { ...order('b', 'READY'), status: 'PICKED_UP' },
      });
      expect(picked?.map((o) => o.id)).toEqual(['a']);
      expect(applyKitchenEvent(board, { storeId: 's', kind: 'removed', orderId: 'a', order: null })?.length).toBe(1);
    });

    it('asks for a re-read when an update carries no row', () => {
      expect(applyKitchenEvent(board, { storeId: 's', kind: 'updated', orderId: 'a', order: null })).toBeNull();
    });
  });

  it("keeps the customer's arrival when an update arrives without it", () => {
    const here = {
      ...order('a', 'ACCEPTED'),
      customerArrival: 'HERE' as const,
      customerArrivedAt: '2026-09-26T09:58:00Z',
    };
    const next = applyKitchenEvent([here], {
      storeId: 's',
      kind: 'created',
      orderId: 'a',
      order: order('a', 'IN_PROGRESS'),
    });
    expect(next?.[0]).toMatchObject({ status: 'IN_PROGRESS', customerArrival: 'HERE' });
  });

  it('takes the arrival from a row that carries it', () => {
    const next = applyKitchenEvent([order('a', 'ACCEPTED')], {
      storeId: 's',
      kind: 'updated',
      orderId: 'a',
      order: { ...order('a', 'ACCEPTED'), customerArrival: 'NEARBY', customerArrivedAt: '2026-09-26T09:58:00Z' },
    });
    expect(next?.[0]?.customerArrival).toBe('NEARBY');
  });
});
