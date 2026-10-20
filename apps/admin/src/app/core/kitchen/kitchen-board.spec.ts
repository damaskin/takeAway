import {
  KITCHEN_REJECT_REASONS,
  acceptOverdue,
  acceptPill,
  activePause,
  applyKitchenEvent,
  asapNote,
  awaitsAcceptance,
  canReject,
  countdown,
  inColumn,
  isLaterPreorder,
  lateMinutes,
  laterPreorders,
  nextAction,
  rejectOutcomeKey,
  removalNotice,
  scheduleStatus,
  shiftBanner,
  showsPickupCountdown,
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

  describe('closing banner', () => {
    const shift = (patch: Partial<StoreShift>): StoreShift => ({
      storeId: 's',
      open: true,
      openedAt: '2026-10-14T06:00:00Z',
      openedByName: null,
      closedAt: null,
      closedByName: null,
      busy: false,
      canExtend: true,
      ...patch,
    });
    const at = (iso: string) => Date.parse(iso);

    it('warns 15 minutes before the hours end, offering «Продлить» while the API allows it', () => {
      const s = shift({ closesAt: '2026-10-14T21:00:00Z', asapOpen: true });
      expect(shiftBanner(s, at('2026-10-14T20:44:00Z'))).toBeNull();
      expect(shiftBanner(s, at('2026-10-14T20:45:00Z'))).toEqual({
        kind: 'closingSoon',
        at: '2026-10-14T21:00:00.000Z',
        extended: false,
        canExtend: true,
      });
      expect(shiftBanner({ ...s, canExtend: false }, at('2026-10-14T20:50:00Z'))).toMatchObject({ canExtend: false });
    });

    it('warns before an extension ends, and says nothing while it has long to run', () => {
      const s = shift({ closesAt: null, extendedUntil: '2026-10-14T22:00:00Z', asapOpen: true });
      expect(shiftBanner(s, at('2026-10-14T21:10:00Z'))).toBeNull();
      expect(shiftBanner(s, at('2026-10-14T21:50:00Z'))).toMatchObject({ kind: 'closingSoon', extended: true });
    });

    it('offers nothing outside the hours — at 23:57 there is nothing to extend', () => {
      const s = shift({ asapBlockedReason: 'OUTSIDE_HOURS', opensAt: '2026-10-15T06:00:00Z', canExtend: false });
      expect(shiftBanner(s, at('2026-10-14T23:57:00Z'))).toBeNull();
      // Past the closing before the next read of the shift: quiet too.
      expect(shiftBanner(shift({ closesAt: '2026-10-14T21:00:00Z' }), at('2026-10-14T21:00:30Z'))).toBeNull();
    });

    it('stays quiet without a shift and for a store open around the clock', () => {
      expect(shiftBanner(shift({ open: false, closesAt: '2026-10-14T21:00:00Z' }), now)).toBeNull();
      expect(shiftBanner(shift({ closesAt: null, asapOpen: true }), now)).toBeNull();
    });
  });

  describe('schedule status (the shift follows the hours)', () => {
    const shift = (patch: Partial<StoreShift>): StoreShift => ({
      storeId: 's',
      open: true,
      openedAt: '2026-10-14T06:00:00Z',
      openedByName: null,
      closedAt: null,
      closedByName: null,
      busy: false,
      closesAt: null,
      opensAt: null,
      extendedUntil: null,
      asapBlockedReason: null,
      ...patch,
    });
    const at = (iso: string) => Date.parse(iso);

    it('works by the schedule until the closing, and says when it was extended', () => {
      expect(scheduleStatus(shift({ closesAt: '2026-10-14T21:00:00Z' }), 'OPEN', now)).toEqual({
        kind: 'open',
        until: '2026-10-14T21:00:00.000Z',
      });
      expect(
        scheduleStatus(
          shift({ closesAt: '2026-10-14T21:00:00Z', extendedUntil: '2026-10-14T21:30:00Z' }),
          'OVERLOADED',
          at('2026-10-14T20:50:00Z'),
        ),
      ).toEqual({ kind: 'extended', until: '2026-10-14T21:30:00.000Z' });
      // Past the hours, the extension still running.
      expect(
        scheduleStatus(
          shift({ extendedUntil: '2026-10-14T21:30:00Z', asapBlockedReason: null }),
          'OPEN',
          at('2026-10-14T21:10:00Z'),
        ),
      ).toEqual({ kind: 'extended', until: '2026-10-14T21:30:00.000Z' });
    });

    it('is closed by the schedule with the next opening, and does not take the shift for it', () => {
      const night = shift({ open: false, asapBlockedReason: 'OUTSIDE_HOURS', opensAt: '2026-10-15T06:00:00Z' });
      expect(scheduleStatus(night, 'OPEN', at('2026-10-14T23:57:00Z'))).toEqual({
        kind: 'closed',
        opensAt: '2026-10-15T06:00:00.000Z',
      });
      // The closing passed between two reads: closed, the opening to come with the next read.
      expect(scheduleStatus(shift({ closesAt: '2026-10-14T21:00:00Z' }), 'OPEN', at('2026-10-14T21:00:30Z'))).toEqual({
        kind: 'closed',
        opensAt: null,
      });
    });

    it('is opening for the minute before the schedule opens the shift, and open around the clock with no hours', () => {
      expect(scheduleStatus(shift({ open: false, closesAt: '2026-10-14T21:00:00Z' }), 'OPEN', now)).toEqual({
        kind: 'opening',
      });
      expect(scheduleStatus(shift({}), 'OPEN', now)).toEqual({ kind: 'aroundTheClock' });
    });

    it('is switched off for a store closed in its settings, whatever the shift says', () => {
      expect(scheduleStatus(shift({ closesAt: '2026-10-14T21:00:00Z' }), 'CLOSED', now)).toEqual({
        kind: 'switchedOff',
      });
      expect(scheduleStatus(null, 'CLOSED', now)).toEqual({ kind: 'switchedOff' });
      expect(scheduleStatus(null, 'OPEN', now)).toBeNull();
    });

    it('says why no ASAP orders come while open: the queue or the closing', () => {
      expect(asapNote(shift({ asapBlockedReason: 'QUEUE_FULL' }))).toBe('queueFull');
      expect(asapNote(shift({ asapBlockedReason: 'CLOSING_SOON' }))).toBe('closingSoon');
      expect(asapNote(shift({ asapBlockedReason: 'PAUSED' }))).toBeNull();
    });

    it('carries the pause while it runs', () => {
      const paused = shift({
        pausedUntil: '2026-10-14T08:30:00Z',
        pauseReason: 'EQUIPMENT',
        pauseComment: 'кофемашина',
        pausedByName: 'Анна',
      });
      expect(activePause(paused, now)).toEqual({
        until: '2026-10-14T08:30:00Z',
        reason: 'EQUIPMENT',
        comment: 'кофемашина',
        byName: 'Анна',
      });
      expect(activePause(paused, at('2026-10-14T08:30:01Z'))).toBeNull();
      expect(activePause(shift({ pausedUntil: null }), now)).toBeNull();
    });
  });

  describe('card timers (item 16)', () => {
    const asap = (patch: Partial<KitchenOrder> = {}): KitchenOrder => ({
      ...order('a', 'PAID'),
      acceptAlertAt: '2026-10-14T08:03:00Z',
      acceptDeadlineAt: '2026-10-14T08:08:00Z',
      ...patch,
    });

    it('shows only the acceptance pill while nobody accepted the order, the pickup countdown after', () => {
      expect(showsPickupCountdown(asap())).toBe(false);
      expect(acceptPill(asap(), now)).toEqual({ overdue: false, countdown: true });
      expect(acceptPill(asap(), Date.parse('2026-10-14T08:03:00Z'))).toEqual({ overdue: true, countdown: true });
      expect(showsPickupCountdown(asap({ status: 'ACCEPTED' }))).toBe(true);
      expect(acceptPill(asap({ status: 'ACCEPTED' }), now)).toBeNull();
    });

    it('counts a pre-order down to its auto-cancel only once it is overdue', () => {
      const pre = preorder({ acceptAlertAt: '2026-10-14T09:00:00Z', acceptDeadlineAt: '2026-10-14T09:05:00Z' });
      expect(acceptPill(pre, now)).toEqual({ overdue: false, countdown: false });
      expect(acceptPill(pre, Date.parse('2026-10-14T09:00:00Z'))).toEqual({ overdue: true, countdown: true });
    });
  });

  describe('a ticket that left without the kitchen', () => {
    const board = [order('a', 'PAID'), order('b', 'IN_PROGRESS')];

    it('is announced when the customer cancelled it or nobody accepted it in time', () => {
      expect(
        removalNotice(board, {
          storeId: 's',
          kind: 'removed',
          orderId: 'a',
          order: null,
          reason: 'CANCELLED_BY_CUSTOMER',
          orderCode: '1234',
        }),
      ).toEqual({ reason: 'CANCELLED_BY_CUSTOMER', code: '1234' });
      expect(
        removalNotice(board, { storeId: 's', kind: 'removed', orderId: 'a', order: null, reason: 'NOT_ACCEPTED' }),
      ).toEqual({ reason: 'NOT_ACCEPTED', code: 'A' });
    });

    it('stays quiet for the kitchen’s own moves, its own rejections and tickets it never showed', () => {
      expect(removalNotice(board, { storeId: 's', kind: 'removed', orderId: 'a', order: null })).toBeNull();
      expect(
        removalNotice(board, { storeId: 's', kind: 'removed', orderId: 'a', order: null, reason: 'REJECTED' }),
      ).toBeNull();
      expect(
        removalNotice(board, { storeId: 's', kind: 'removed', orderId: 'x', order: null, reason: 'EXPIRED' }),
      ).toBeNull();
      expect(
        removalNotice(board, {
          storeId: 's',
          kind: 'removed',
          orderId: 'x',
          order: null,
          reason: 'CANCELLED_BY_CUSTOMER',
        }),
      ).toBeNull();
    });
  });
});
