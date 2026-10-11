import type { SettlementReport, SettlementTotals } from '@takeaway/shared-types';

/** The figures a CSV row carries, in column order. */
const COLUMNS: ReadonlyArray<{ key: keyof SettlementTotals; money: boolean }> = [
  { key: 'orders', money: false },
  { key: 'cardOrders', money: false },
  { key: 'salesCents', money: true },
  { key: 'promoDiscountCents', money: true },
  { key: 'pointsDiscountCents', money: true },
  { key: 'giftCardCents', money: true },
  { key: 'deliveryFeeCents', money: true },
  { key: 'capturedCents', money: true },
  { key: 'refundedCents', money: true },
  { key: 'commissionBaseCents', money: true },
  { key: 'commissionCents', money: true },
  { key: 'payableCents', money: true },
];

export const SETTLEMENT_CSV_COLUMNS = COLUMNS.map((c) => c.key);

/**
 * The settlement as a spreadsheet: a few lines about the brand, the period
 * and the rates, then one row per day and a total. In Russian the separator
 * is `;` and the decimal mark `,` — what Excel expects on a Russian system;
 * in English `,` and `.`. Amounts are in major units with two decimals, so
 * the file sums to the kopeck.
 *
 * `label` turns a column key ("salesCents") or a line name ("brand") into
 * the viewer's language.
 */
export function settlementCsv(report: SettlementReport, label: (key: string) => string, lang: string): string {
  const russian = lang.toLowerCase().startsWith('ru');
  const sep = russian ? ';' : ',';
  const money = (cents: number) => {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    const text = `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
    return russian ? text.replace('.', ',') : text;
  };
  const cell = (value: string) =>
    value.includes(sep) || /["\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const line = (cells: string[]) => cells.map(cell).join(sep);
  const row = (first: string, t: SettlementTotals) =>
    line([first, ...COLUMNS.map((c) => (c.money ? money(t[c.key]) : String(t[c.key])))]);
  const rates = report.rates
    .map((r) => `${formatPercent(r.bps, russian)} % (${r.from} – ${r.to})`)
    .join(russian ? '; ' : ', ');

  return [
    line([label('brand'), report.brand.name]),
    line([label('period'), `${report.period.from} – ${report.period.to}`]),
    line([label('currency'), report.currency]),
    line([label('timeZone'), report.period.timeZone]),
    line([label('rate'), rates]),
    '',
    line([label('date'), ...COLUMNS.map((c) => label(c.key))]),
    ...report.days.map((d) => row(d.date, d)),
    row(label('total'), report.totals),
  ].join('\r\n');
}

function formatPercent(bps: number, russian: boolean): string {
  const text = String(bps / 100);
  return russian ? text.replace('.', ',') : text;
}
