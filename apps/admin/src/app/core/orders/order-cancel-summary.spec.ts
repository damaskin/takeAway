import { orderCancelSummary } from './order-cancel-summary';
import type { AdminOrderDetail } from './orders.service';

type Input = Parameters<typeof orderCancelSummary>[0];

const cancelled = (patch: Partial<Input> = {}): Input => ({
  status: 'CANCELLED',
  cancelledBy: null,
  cancelReason: null,
  cancelComment: null,
  cancelMoney: null,
  events: [],
  ...patch,
});

const event = (type: string, payload: unknown): AdminOrderDetail['events'][number] => ({
  id: `${type}-1`,
  type,
  createdAt: '2026-11-09T09:00:00Z',
  actorId: null,
  payload,
});

describe('orderCancelSummary', () => {
  it("gives who turned the order down, the kitchen's reason and words, and where the money went", () => {
    expect(
      orderCancelSummary(
        cancelled({
          cancelledBy: 'STORE',
          cancelReason: 'OUT_OF_STOCK',
          cancelComment: ' Нет овсяного молока ',
          cancelMoney: 'RELEASED',
        }),
      ),
    ).toEqual({
      title: 'admin.orderDetail.cancel.title',
      by: 'admin.orderDetail.cancel.byStore',
      reason: 'admin.orderDetail.cancel.reasons.OUT_OF_STOCK',
      comment: 'Нет овсяного молока',
      money: 'admin.orderDetail.cancel.moneyOutcome.RELEASED',
      bankMessage: null,
    });
  });

  it("tells a declined card apart, with the bank's own words from the event", () => {
    const summary = orderCancelSummary(
      cancelled({
        cancelledBy: 'STORE',
        cancelReason: 'CARD_DECLINED',
        cancelMoney: 'NOT_CHARGED',
        events: [
          event('STATUS_CHANGED', { from: 'CREATED', to: 'PAID' }),
          event('CANCELLED', {
            from: 'PAID',
            by: 'store',
            reason: 'CARD_DECLINED',
            bankMessage: 'Недостаточно средств',
          }),
        ],
      }),
    );
    expect(summary).toMatchObject({
      by: 'admin.orderDetail.cancel.byCardDeclined',
      reason: null,
      money: 'admin.orderDetail.cancel.moneyOutcome.NOT_CHARGED',
      bankMessage: 'Недостаточно средств',
    });
  });

  it("keeps the customer's own cancel free of a reason", () => {
    expect(
      orderCancelSummary(cancelled({ cancelledBy: 'CUSTOMER', cancelReason: 'OTHER', cancelMoney: 'PENDING' })),
    ).toMatchObject({ by: 'admin.orderDetail.cancel.byCustomer', reason: null, comment: null });
  });

  it('says where the money of an expired order went', () => {
    expect(orderCancelSummary(cancelled({ status: 'EXPIRED', cancelMoney: 'REFUNDED' }))).toEqual({
      title: 'admin.orderDetail.cancel.expiredTitle',
      by: null,
      reason: null,
      comment: null,
      money: 'admin.orderDetail.cancel.moneyOutcome.REFUNDED',
      bankMessage: null,
    });
  });

  it('stays out of the way of a live order, and of one with nothing on record', () => {
    expect(orderCancelSummary(cancelled({ status: 'READY', cancelMoney: 'RELEASED' }))).toBeNull();
    expect(orderCancelSummary(cancelled())).toBeNull();
    expect(orderCancelSummary(cancelled({ status: 'EXPIRED' }))).toBeNull();
    // From an API older than this build: no cancel fields at all.
    expect(orderCancelSummary({ status: 'CANCELLED', events: [] })).toBeNull();
  });
});
