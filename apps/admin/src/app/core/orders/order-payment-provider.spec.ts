import { orderMoneyPayment, paymentProviderKey, refundsInFullOnly } from './order-payment-provider';
import type { AdminOrderPayment } from './orders.service';

const payment = (provider: string, status: string, id = provider): AdminOrderPayment => ({
  id,
  provider,
  status,
  amountCents: 4500,
  refundedCents: 0,
  providerRef: null,
  createdAt: '2026-11-10T12:00:00Z',
});

describe('order payment provider', () => {
  it('finds the payment the money came with, past a lapsed QR invoice', () => {
    const paid = payment('AGROPROMBANK_WEB', 'SUCCEEDED');
    expect(orderMoneyPayment([payment('AGROPROMBANK_QR', 'FAILED'), paid])).toBe(paid);
    expect(orderMoneyPayment([paid, payment('AGROPROMBANK_QR', 'FAILED', 'late')])).toBe(paid);
    expect(orderMoneyPayment([payment('AGROPROMBANK', 'FAILED')])).toBeNull();
    expect(orderMoneyPayment([])).toBeNull();
  });

  it('has words for the providers it knows, and none for a newer one', () => {
    expect(paymentProviderKey('AGROPROMBANK_QR')).toBe('admin.orderDetail.providers.AGROPROMBANK_QR');
    expect(paymentProviderKey('APPLE_PAY')).toBeNull();
  });

  it('refunds a QR payment only in full, and a card one in part too', () => {
    expect(refundsInFullOnly([payment('AGROPROMBANK_QR', 'SUCCEEDED')])).toBe(true);
    expect(refundsInFullOnly([payment('AGROPROMBANK_QR', 'FAILED'), payment('AGROPROMBANK_WEB', 'SUCCEEDED')])).toBe(
      false,
    );
    expect(refundsInFullOnly([payment('AGROPROMBANK', 'SUCCEEDED')])).toBe(false);
  });
});
