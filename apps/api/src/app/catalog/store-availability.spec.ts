import { hoursAround, type WorkingHour } from '../kitchen/opening-hours';
import {
  type AvailabilityFacts,
  type AvailabilityPolicy,
  closingBoundary,
  hasBookableSlot,
  slotBlocker,
  storeAvailability,
} from './store-availability';

const POLICY: AvailabilityPolicy = {
  maxAsapWaitSeconds: 2700,
  minScheduledLeadSeconds: 600,
  preorderHorizonSeconds: 24 * 3600,
  preorderOpeningLeadSeconds: 900,
};

/** 09:00–21:00 every day, UTC. */
const HOURS: WorkingHour[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opensAt: 9 * 60,
  closesAt: 21 * 60,
  isClosed: false,
}));

const at = (iso: string) => new Date(iso);

function availability(nowIso: string, facts: Partial<AvailabilityFacts> = {}, hours: readonly WorkingHour[] = HOURS) {
  const now = at(nowIso);
  return storeAvailability(
    { status: 'OPEN', openShift: { extendedUntil: null }, asapWaitSeconds: 600, ...facts },
    now,
    POLICY,
    hoursAround(hours, 'UTC', now),
  );
}

describe('store availability (kitchen policy 2026-10-14)', () => {
  it('takes ASAP orders within the hours while a shift is open', () => {
    expect(availability('2026-10-14T12:00:00Z')).toEqual({
      acceptingOrders: true,
      openNow: true,
      asapBlockedReason: null,
      opensAt: null,
      closesAt: at('2026-10-14T21:00:00Z'),
      withinHours: true,
      extendedUntil: null,
      pausedUntil: null,
    });
  });

  it('lets the hours win over a shift left open at 23:50, and still takes pre-orders for tomorrow', () => {
    const late = availability('2026-10-14T23:50:00Z');
    expect(late.openNow).toBe(false);
    expect(late.asapBlockedReason).toBe('OUTSIDE_HOURS');
    expect(late.acceptingOrders).toBe(true);
    expect(late.opensAt).toEqual(at('2026-10-15T09:00:00Z'));
    expect(late.closesAt).toBeNull();
  });

  it('takes ASAP orders past the hours while the kitchen extended its shift', () => {
    const extended = availability('2026-10-14T21:20:00Z', { openShift: { extendedUntil: at('2026-10-14T21:30:00Z') } });
    expect(extended.openNow).toBe(true);
    expect(extended.extendedUntil).toEqual(at('2026-10-14T21:30:00Z'));

    const over = availability('2026-10-14T21:31:00Z', { openShift: { extendedUntil: at('2026-10-14T21:30:00Z') } });
    expect(over.asapBlockedReason).toBe('OUTSIDE_HOURS');
    expect(over.extendedUntil).toBeNull();
  });

  it('takes pre-orders with the shift closed — ordering at 01:00 for the morning', () => {
    const night = availability('2026-10-14T01:00:00Z', { openShift: null });
    expect(night).toMatchObject({ openNow: false, acceptingOrders: true, asapBlockedReason: 'OUTSIDE_HOURS' });

    const forgotToOpen = availability('2026-10-14T12:00:00Z', { openShift: null });
    expect(forgotToOpen).toMatchObject({ openNow: false, acceptingOrders: true, asapBlockedReason: 'SHIFT_CLOSED' });
  });

  it('reports a full queue last, and only pre-orders are taken then', () => {
    expect(availability('2026-10-14T12:00:00Z', { asapWaitSeconds: 2701 })).toMatchObject({
      openNow: false,
      acceptingOrders: true,
      asapBlockedReason: 'QUEUE_FULL',
    });
    expect(availability('2026-10-14T12:00:00Z', { asapWaitSeconds: null }).asapBlockedReason).toBe('QUEUE_FULL');
    // Outside the hours wins over a closed shift, which wins over the queue.
    expect(availability('2026-10-14T23:00:00Z', { openShift: null, asapWaitSeconds: null }).asapBlockedReason).toBe(
      'OUTSIDE_HOURS',
    );
  });

  it('takes nothing while the store is switched off, and gives no ASAP reason then', () => {
    expect(availability('2026-10-14T12:00:00Z', { status: 'CLOSED' })).toMatchObject({
      acceptingOrders: false,
      openNow: false,
      asapBlockedReason: null,
    });
  });

  it('takes no order when no working hours fall within the next day', () => {
    const weekendOnly = HOURS.filter((h) => h.weekday === 0 || h.weekday === 6);
    // Tuesday 12:00: the next window is Saturday.
    const tuesday = availability('2026-10-13T12:00:00Z', { openShift: null }, weekendOnly);
    expect(tuesday).toMatchObject({ acceptingOrders: false, openNow: false, asapBlockedReason: 'OUTSIDE_HOURS' });
    expect(tuesday.opensAt).toEqual(at('2026-10-17T09:00:00Z'));
  });

  it('treats a store with no hours on file as open around the clock', () => {
    expect(availability('2026-10-14T03:00:00Z', {}, [])).toMatchObject({
      openNow: true,
      closesAt: null,
      opensAt: null,
    });
    expect(availability('2026-10-14T03:00:00Z', { openShift: null }, [])).toMatchObject({
      openNow: false,
      acceptingOrders: true,
      asapBlockedReason: 'SHIFT_CLOSED',
    });
  });

  describe('pre-order slots', () => {
    const ctx = (nowIso: string, shiftOpen: boolean) => {
      const now = at(nowIso);
      return { now, hours: hoursAround(HOURS, 'UTC', now), shiftOpen, policy: POLICY };
    };

    it('books 09:15 tomorrow at 01:00 with the shift closed, not 09:00', () => {
      const c = ctx('2026-10-14T01:00:00Z', false);
      expect(slotBlocker(at('2026-10-14T09:15:00Z'), c)).toBeNull();
      expect(slotBlocker(at('2026-10-14T09:00:00Z'), c)).toBe('BEFORE_OPENING_LEAD');
      expect(slotBlocker(at('2026-10-14T03:00:00Z'), c)).toBe('OUTSIDE_HOURS');
    });

    it('wants at least 10 minutes and at most 24 hours', () => {
      const c = ctx('2026-10-14T12:00:00Z', true);
      expect(slotBlocker(at('2026-10-14T12:05:00Z'), c)).toBe('TOO_SOON');
      expect(slotBlocker(at('2026-10-14T12:15:00Z'), c)).toBeNull();
      expect(slotBlocker(at('2026-10-15T12:15:00Z'), c)).toBe('TOO_FAR');
    });

    it('finds a bookable slot whenever a window starts or runs within the next day', () => {
      expect(hasBookableSlot(ctx('2026-10-14T20:55:00Z', true))).toBe(true); // tomorrow morning
      expect(hasBookableSlot(ctx('2026-10-14T12:00:00Z', false))).toBe(true);
    });
  });
});

describe('store availability (owner decisions 2026-10-20)', () => {
  describe('«Пауза»', () => {
    const paused = { pausedUntil: at('2026-10-14T12:30:00Z') };

    it('blocks ASAP orders with PAUSED until the pause ends, and still takes pre-orders for later', () => {
      expect(availability('2026-10-14T12:00:00Z', paused)).toMatchObject({
        openNow: false,
        acceptingOrders: true,
        asapBlockedReason: 'PAUSED',
        pausedUntil: at('2026-10-14T12:30:00Z'),
      });
      // A pause that ran out is no pause, even before the cron clears it.
      expect(availability('2026-10-14T12:31:00Z', paused)).toMatchObject({
        openNow: true,
        asapBlockedReason: null,
        pausedUntil: null,
      });
    });

    it('comes after the hours and before the shift and the queue', () => {
      expect(availability('2026-10-14T22:00:00Z', { pausedUntil: at('2026-10-14T23:00:00Z') }).asapBlockedReason).toBe(
        'OUTSIDE_HOURS',
      );
      expect(availability('2026-10-14T12:00:00Z', { ...paused, openShift: null, asapWaitSeconds: null })).toMatchObject(
        { asapBlockedReason: 'PAUSED' },
      );
    });

    it('takes no pre-order for a time before the pause ends', () => {
      const now = at('2026-10-14T12:00:00Z');
      const ctx = {
        now,
        hours: hoursAround(HOURS, 'UTC', now),
        shiftOpen: true,
        policy: POLICY,
        pausedUntil: at('2026-10-14T12:30:00Z'),
      };
      expect(slotBlocker(at('2026-10-14T12:15:00Z'), ctx)).toBe('PAUSED');
      expect(slotBlocker(at('2026-10-14T12:30:00Z'), ctx)).toBeNull();
      // A store open around the clock too.
      expect(slotBlocker(at('2026-10-14T12:15:00Z'), { ...ctx, hours: hoursAround([], 'UTC', now) })).toBe('PAUSED');
    });

    it('stops taking any order when the pause covers the rest of the day and nothing opens within it', () => {
      const tuesdayOnly = HOURS.filter((h) => h.weekday === 2);
      // Tuesday 12:00, paused until the 21:00 closing; the next window is next Tuesday.
      expect(
        availability('2026-10-13T12:00:00Z', { pausedUntil: at('2026-10-13T21:00:00Z') }, tuesdayOnly),
      ).toMatchObject({ acceptingOrders: false, asapBlockedReason: 'PAUSED' });
    });
  });

  describe('the last ASAP order before the closing (item 6)', () => {
    it('is taken while it would be ready by the closing', () => {
      // 20:40 + 20 min = 21:00 sharp.
      expect(availability('2026-10-14T20:40:00Z', { asapWaitSeconds: 1200 })).toMatchObject({
        openNow: true,
        asapBlockedReason: null,
      });
    });

    it('is refused with CLOSING_SOON once it would be ready after the closing; pre-orders stay', () => {
      expect(availability('2026-10-14T20:41:00Z', { asapWaitSeconds: 1200 })).toMatchObject({
        openNow: false,
        acceptingOrders: true,
        asapBlockedReason: 'CLOSING_SOON',
        closesAt: at('2026-10-14T21:00:00Z'),
      });
    });

    it('counts to the end of the extension when the kitchen extended the closing', () => {
      const extended = { openShift: { extendedUntil: at('2026-10-14T21:30:00Z') }, asapWaitSeconds: 1200 };
      expect(availability('2026-10-14T20:50:00Z', extended).openNow).toBe(true);
      expect(availability('2026-10-14T21:15:00Z', extended).asapBlockedReason).toBe('CLOSING_SOON');
    });

    it('comes before a full queue when the closing is nearer than the longest wait', () => {
      expect(availability('2026-10-14T20:30:00Z', { asapWaitSeconds: null }).asapBlockedReason).toBe('CLOSING_SOON');
      expect(availability('2026-10-14T12:00:00Z', { asapWaitSeconds: null }).asapBlockedReason).toBe('QUEUE_FULL');
    });

    it('never applies to a store open around the clock', () => {
      expect(availability('2026-10-14T23:59:00Z', { asapWaitSeconds: 2400 }, []).openNow).toBe(true);
    });
  });

  it('takes the later of the window end and the extension as the closing boundary', () => {
    expect(closingBoundary({ closesAt: at('2026-10-14T21:00:00Z'), extendedUntil: null })).toEqual(
      at('2026-10-14T21:00:00Z'),
    );
    expect(
      closingBoundary({ closesAt: at('2026-10-14T21:00:00Z'), extendedUntil: at('2026-10-14T21:30:00Z') }),
    ).toEqual(at('2026-10-14T21:30:00Z'));
    expect(closingBoundary({ closesAt: null, extendedUntil: at('2026-10-14T21:30:00Z') })).toEqual(
      at('2026-10-14T21:30:00Z'),
    );
    expect(closingBoundary({ closesAt: null, extendedUntil: null })).toBeNull();
  });

  it('keeps pre-order slots inside the window: the last one starts before the closing', () => {
    const now = at('2026-10-14T19:00:00Z');
    const ctx = { now, hours: hoursAround(HOURS, 'UTC', now), shiftOpen: true, policy: POLICY };
    expect(slotBlocker(at('2026-10-14T20:45:00Z'), ctx)).toBeNull();
    expect(slotBlocker(at('2026-10-14T21:00:00Z'), ctx)).toBe('OUTSIDE_HOURS');
  });
});
