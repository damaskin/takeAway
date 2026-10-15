import { acceptAlertAt, acceptDeadline, kitchenTimeline, startBy, type TimelineOrder } from './kitchen-timeline';

const POLICY = { acceptAlertSeconds: 180, acceptTimeoutSeconds: 480 };
const at = (iso: string) => new Date(iso);

function order(patch: Partial<TimelineOrder> = {}): TimelineOrder {
  return {
    status: 'CREATED',
    pickupMode: 'ASAP',
    pickupAt: at('2026-10-14T09:15:00Z'),
    prepSeconds: 180,
    workSeconds: 360,
    kitchenVisibleAt: at('2026-10-14T09:00:00Z'),
    ...patch,
  };
}

describe('kitchen timeline', () => {
  it('starts in time for the pickup: the longer of prep and work over the hands, plus two minutes', () => {
    // 360 s of work on two hands = 180 s, same as the prep: 09:15 − 3 min − 2 min.
    expect(startBy(order(), 2)).toEqual(at('2026-10-14T09:10:00Z'));
    // Six drinks on one pair of hands take longer than one drink's wait.
    expect(startBy(order({ workSeconds: 1080 }), 1)).toEqual(at('2026-10-14T08:55:00Z'));
  });

  it('alerts about an ASAP order 3 minutes after it reached the board and calls it off after 8', () => {
    expect(acceptAlertAt(order(), 2, POLICY)).toEqual(at('2026-10-14T09:03:00Z'));
    expect(acceptDeadline(order(), POLICY)).toEqual(at('2026-10-14T09:08:00Z'));
  });

  it('lets a pre-order placed at night wait for the morning: off 10 minutes before pickup, warned 5 before that', () => {
    const preorder = order({ pickupMode: 'SCHEDULED', kitchenVisibleAt: at('2026-10-14T01:00:00Z') });
    expect(acceptDeadline(preorder, POLICY)).toEqual(at('2026-10-14T09:05:00Z'));
    // Its start (09:10) would come after the deadline; the warning keeps the ASAP lead.
    expect(acceptAlertAt(preorder, 2, POLICY)).toEqual(at('2026-10-14T09:00:00Z'));

    // A long order starts well before: the alert comes at its start.
    const catering = order({ ...preorder, workSeconds: 3600 });
    expect(acceptAlertAt(catering, 2, POLICY)).toEqual(startBy(catering, 2));
    expect(startBy(catering, 2)).toEqual(at('2026-10-14T08:43:00Z'));
  });

  it('never calls a short-notice pre-order off sooner than an ASAP order', () => {
    const soon = order({ pickupMode: 'SCHEDULED', kitchenVisibleAt: at('2026-10-14T09:00:00Z') });
    expect(acceptDeadline(soon, POLICY)).toEqual(at('2026-10-14T09:08:00Z'));
  });

  it('has no acceptance clock once accepted, nor for an order that never reached the board', () => {
    expect(acceptAlertAt(order({ status: 'ACCEPTED' }), 2, POLICY)).toBeNull();
    expect(acceptDeadline(order({ kitchenVisibleAt: null }), POLICY)).toBeNull();
    expect(kitchenTimeline(order({ status: 'IN_PROGRESS' }), 2, POLICY)).toEqual({
      startBy: '2026-10-14T09:10:00.000Z',
      awaitingSince: '2026-10-14T09:00:00.000Z',
      acceptAlertAt: null,
      acceptDeadlineAt: null,
    });
  });
});
