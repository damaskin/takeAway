import {
  KITCHEN_REJECT_REASONS,
  acceptOverdue,
  applyKitchenEvent,
  awaitsAcceptance,
  canReject,
  countdown,
  inColumn,
  isLaterPreorder,
  lateMinutes,
  laterPreorders,
  nextAction,
  rejectOutcomeKey,
  shiftBanner,
  startDue,
} from './kitchen-board';
import type { KitchenOrder, StoreShift } from './kitchen.api';

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

describe('kitchen policy on the board', () => {
  const now = Date.parse('2026-10-14T08:00:00Z');
  const preorder = (patch: Partial<KitchenOrder> = {}): KitchenOrder => ({
    ...order('p', 'PAID'),
    pickupMode: 'SCHEDULED',
    pickupAt: '2026-10-14T09:15:00Z',
    startBy: '2026-10-14T09:03:00Z',
    ...patch,
  });

  it('keeps a pre-order in «Предзаказы» until 15 minutes before its start, then in «Новые»', () => {
    expect(isLaterPreorder(preorder(), now)).toBe(true);
    expect(inColumn(preorder(), 'NEW', now)).toBe(false);
    const soon = Date.parse('2026-10-14T08:48:00Z');
    expect(isLaterPreorder(preorder(), soon)).toBe(false);
    expect(inColumn(preorder(), 'NEW', soon)).toBe(true);
    // Accepted early, it still waits there; started, it is in «Готовятся».
    expect(isLaterPreorder(preorder({ status: 'ACCEPTED' }), now)).toBe(true);
    expect(isLaterPreorder(preorder({ status: 'IN_PROGRESS' }), now)).toBe(false);
    // ASAP orders never wait there, whatever their time.
    expect(isLaterPreorder({ ...preorder(), pickupMode: 'ASAP' }, now)).toBe(false);
  });

  it('lists pre-orders by pickup time', () => {
    const later = preorder({ id: 'b', pickupAt: '2026-10-14T11:00:00Z', startBy: '2026-10-14T10:50:00Z' });
    const early = preorder({ id: 'a' });
    expect(laterPreorders([later, early, order('x', 'PAID')], now).map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('counts down in h:mm:ss above an hour, not in hundreds of minutes', () => {
    expect(countdown(12 * 3600_000)).toBe('12:00:00');
    expect(countdown(61 * 60_000 + 5_000)).toBe('1:01:05');
    expect(countdown(59 * 60_000)).toBe('59:00');
    expect(countdown(-60_000)).toBe('−1:00');
    expect(countdown(0)).toBe('0:00');
  });

  it('says how late an accepted order is', () => {
    const accepted = { ...order('a', 'ACCEPTED'), pickupAt: '2026-10-14T07:52:30Z' };
    expect(lateMinutes(accepted, now)).toBe(7);
    expect(lateMinutes({ ...accepted, pickupAt: '2026-10-14T08:05:00Z' }, now)).toBe(0);
    expect(lateMinutes({ ...accepted, status: 'READY' }, now)).toBe(0);
  });

  it('flags an order nobody accepted past its alert time', () => {
    const waiting = { ...order('a', 'PAID'), acceptAlertAt: '2026-10-14T07:59:00Z' };
    expect(acceptOverdue(waiting, now)).toBe(true);
    expect(acceptOverdue({ ...waiting, acceptAlertAt: '2026-10-14T08:01:00Z' }, now)).toBe(false);
    expect(acceptOverdue({ ...waiting, status: 'ACCEPTED' }, now)).toBe(false);
  });

  it('reminds about a pre-order once its start came, until it is being made', () => {
    expect(startDue(preorder(), Date.parse('2026-10-14T09:03:00Z'))).toBe(true);
    expect(startDue(preorder(), Date.parse('2026-10-14T09:02:59Z'))).toBe(false);
    expect(startDue(preorder({ status: 'IN_PROGRESS' }), Date.parse('2026-10-14T09:05:00Z'))).toBe(false);
  });

  describe('shift banner', () => {
    const shift = (patch: Partial<StoreShift>): StoreShift => ({
      storeId: 's',
      open: true,
      openedAt: '2026-10-14T06:00:00Z',
      openedByName: null,
      closedAt: null,
      closedByName: null,
      busy: false,
      ...patch,
    });
    const at = (iso: string) => Date.parse(iso);

    it('warns 15 minutes before the hours end', () => {
      const s = shift({ closesAt: '2026-10-14T21:00:00Z', asapOpen: true });
      expect(shiftBanner(s, at('2026-10-14T20:44:00Z'))).toBeNull();
      expect(shiftBanner(s, at('2026-10-14T20:45:00Z'))).toEqual({
        kind: 'closingSoon',
        at: '2026-10-14T21:00:00.000Z',
        extended: false,
      });
      // Past the closing before the next read of the shift: closed by the schedule.
      expect(shiftBanner(s, at('2026-10-14T21:00:30Z'))).toEqual({ kind: 'outsideHours', opensAt: null });
    });

    it('warns before an extension ends, and says nothing while it has long to run', () => {
      const s = shift({ closesAt: null, extendedUntil: '2026-10-14T22:00:00Z', asapOpen: true });
      expect(shiftBanner(s, at('2026-10-14T21:10:00Z'))).toBeNull();
      expect(shiftBanner(s, at('2026-10-14T21:50:00Z'))).toMatchObject({ kind: 'closingSoon', extended: true });
    });

    it('says the store is closed by the schedule outside the hours, with the next opening', () => {
      const s = shift({ asapBlockedReason: 'OUTSIDE_HOURS', opensAt: '2026-10-15T06:00:00Z' });
      expect(shiftBanner(s, at('2026-10-14T23:50:00Z'))).toEqual({
        kind: 'outsideHours',
        opensAt: '2026-10-15T06:00:00Z',
      });
    });

    it('stays quiet without a shift and for a store open around the clock', () => {
      expect(shiftBanner(shift({ open: false, asapBlockedReason: 'OUTSIDE_HOURS' }), now)).toBeNull();
      expect(shiftBanner(shift({ closesAt: null, asapOpen: true }), now)).toBeNull();
    });
  });
});
