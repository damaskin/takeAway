/**
 * Money for admin screens: integer cents in the brand's or store's currency.
 * Without a currency (a list spanning several brands) the amount is shown as
 * a bare number rather than pretending it is in dollars.
 */
export function formatMoney(cents: number, currency: string | null | undefined, wholeUnits = false): string {
  const digits = wholeUnits ? 0 : undefined;
  if (!currency) {
    return new Intl.NumberFormat('en', {
      maximumFractionDigits: digits ?? 2,
      minimumFractionDigits: digits ?? 2,
    }).format(cents / 100);
  }
  return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: digits }).format(
    cents / 100,
  );
}
