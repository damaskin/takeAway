import type { SettlementReport, SettlementTotals } from '@takeaway/shared-types';

import { SETTLEMENT_CSV_COLUMNS, settlementCsv } from './settlement-csv';

const zero: SettlementTotals = {
  orders: 0,
  cardOrders: 0,
  zeroTotalOrders: 0,
  unpaidOrders: 0,
  unpaidTotalCents: 0,
  salesCents: 0,
  promoDiscountCents: 0,
  pointsDiscountCents: 0,
  giftCardCents: 0,
  deliveryFeeCents: 0,
  capturedCents: 0,
  refundedCents: 0,
  commissionBaseCents: 0,
  commissionCents: 0,
  payableCents: 0,
};

const day: SettlementTotals = {
  ...zero,
  orders: 2,
  cardOrders: 2,
  salesCents: 12000,
  giftCardCents: 5000,
  capturedCents: 7005,
  refundedCents: 5,
  commissionBaseCents: 7000,
  commissionCents: 1050,
  payableCents: 5950,
};

const report: SettlementReport = {
  brand: { id: 'b1', name: 'NoName; Coffee', plan: 'PRO', currentBps: 1500, planBps: 1500 },
  currency: 'RUP',
  currencies: ['RUP'],
  period: { from: '2026-10-01', to: '2026-10-02', days: 2, timeZone: 'Europe/Chisinau' },
  totals: day,
  days: [
    { date: '2026-10-01', ...day },
    { date: '2026-10-02', ...zero },
  ],
  rates: [{ bps: 1250, source: 'INDIVIDUAL', from: '2026-10-01', to: '2026-10-02' }],
  balance: {
    openingCents: 0,
    payableCents: 5950,
    paidCents: 0,
    pendingCents: 0,
    closingCents: 5950,
    closingPendingCents: 0,
  },
  nextPayout: {
    periodFrom: '2026-10-01',
    periodTo: '2026-10-02',
    amountCents: 5950,
    cardNetCents: 7000,
    commissionCents: 1050,
    blocked: null,
    lastSettledDay: null,
  },
  payouts: [],
};

describe('settlementCsv', () => {
  it('writes a Russian file for Excel: semicolons, decimal commas, kopecks kept', () => {
    const csv = settlementCsv(report, (key) => `[${key}]`, 'ru');
    const lines = csv.split('\r\n');
    // A name with the separator in it is quoted.
    expect(lines[0]).toBe('[brand];"NoName; Coffee"');
    expect(lines[4]).toBe('[rate];12,5 % (2026-10-01 – 2026-10-02)');
    expect(lines[5]).toBe('');
    expect(lines[6]).toBe(['[date]', ...SETTLEMENT_CSV_COLUMNS.map((c) => `[${c}]`)].join(';'));
    expect(lines[7]).toBe('2026-10-01;2;2;120,00;0,00;0,00;50,00;0,00;70,05;0,05;70,00;10,50;59,50');
    expect(lines[8]).toBe('2026-10-02;0;0;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00');
    expect(lines[9]?.startsWith('[total];2;2;120,00')).toBe(true);
  });

  it('writes an English file with commas and decimal points', () => {
    const lines = settlementCsv(report, (key) => key, 'en').split('\r\n');
    expect(lines[7]).toBe('2026-10-01,2,2,120.00,0.00,0.00,50.00,0.00,70.05,0.05,70.00,10.50,59.50');
  });

  it('keeps the sign of a negative amount', () => {
    const negative = { ...report, totals: { ...day, payableCents: -1005 } };
    const total = settlementCsv(negative, (key) => key, 'en')
      .split('\r\n')
      .at(-1);
    expect(total?.endsWith(',-10.05')).toBe(true);
  });
});
