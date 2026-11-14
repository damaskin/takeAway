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
  cardNetCents: 0,
  takeawayCompensationCents: 0,
  pointsCompensationCents: 0,
  compensationCents: 0,
  commissionBaseCents: 0,
  commissionCents: 0,
  netCents: 0,
};

const day: SettlementTotals = {
  ...zero,
  orders: 2,
  cardOrders: 2,
  salesCents: 12000,
  pointsDiscountCents: 500,
  giftCardCents: 5000,
  capturedCents: 7005,
  refundedCents: 5,
  cardNetCents: 7000,
  // A takeAway promo order and points: takeAway owes 10,00 + 5,00.
  takeawayCompensationCents: 1000,
  pointsCompensationCents: 500,
  compensationCents: 1500,
  commissionBaseCents: 8500,
  commissionCents: 1063,
  // 10,63 − 15,00: takeAway owes the brand 4,37.
  netCents: -437,
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
    netCents: -437,
    settledCents: 0,
    openCents: 0,
    closingCents: -437,
    closingOpenCents: 0,
  },
  nextPayout: {
    periodFrom: '2026-10-01',
    periodTo: '2026-10-02',
    direction: 'TAKEAWAY_TO_BRAND',
    amountCents: 437,
    netCents: -437,
    cardNetCents: 7000,
    commissionCents: 1063,
    compensationCents: 1000,
    pointsCompensationCents: 500,
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
    // … captured, refunds, card net, promo and points compensation, compensation, base, commission, net.
    expect(lines[7]).toBe(
      '2026-10-01;2;2;120,00;0,00;5,00;50,00;0,00;70,05;0,05;70,00;10,00;5,00;15,00;85,00;10,63;-4,37',
    );
    expect(lines[8]).toBe('2026-10-02;0;0;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00');
    expect(lines[9]?.startsWith('[total];2;2;120,00')).toBe(true);
  });

  it('carries the netted model, not a payout', () => {
    expect(SETTLEMENT_CSV_COLUMNS).toEqual(
      expect.arrayContaining([
        'cardNetCents',
        'takeawayCompensationCents',
        'pointsCompensationCents',
        'compensationCents',
        'commissionCents',
        'netCents',
      ]),
    );
    expect(SETTLEMENT_CSV_COLUMNS).not.toContain('payableCents');
    expect(SETTLEMENT_CSV_COLUMNS.at(-1)).toBe('netCents');
  });

  it('writes an English file with commas and decimal points', () => {
    const lines = settlementCsv(report, (key) => key, 'en').split('\r\n');
    expect(lines[7]).toBe(
      '2026-10-01,2,2,120.00,0.00,5.00,50.00,0.00,70.05,0.05,70.00,10.00,5.00,15.00,85.00,10.63,-4.37',
    );
  });

  it('writes 0 for a figure an older API does not send', () => {
    const older: Partial<SettlementTotals> = { ...day };
    delete older.pointsCompensationCents;
    const days = [{ date: '2026-10-01', ...(older as SettlementTotals) }];
    const lines = settlementCsv({ ...report, days }, (key) => key, 'en').split('\r\n');
    expect(lines[7]).toBe(
      '2026-10-01,2,2,120.00,0.00,5.00,50.00,0.00,70.05,0.05,70.00,10.00,0.00,15.00,85.00,10.63,-4.37',
    );
  });

  it('keeps the sign of the net: what the brand owes is positive', () => {
    const owed = { ...report, totals: { ...day, netCents: 1005 } };
    const total = (r: SettlementReport) =>
      settlementCsv(r, (key) => key, 'en')
        .split('\r\n')
        .at(-1);
    expect(total(owed)?.endsWith(',10.05')).toBe(true);
    expect(total(report)?.endsWith(',-4.37')).toBe(true);
  });
});
