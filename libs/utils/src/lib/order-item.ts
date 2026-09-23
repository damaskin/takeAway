import type {
  CartChangedError,
  OrderItemModifier,
  OrderItemSnapshot,
  OrderItemVariation,
  VariationType,
} from '@takeaway/shared-types';

/**
 * The order a barista reads a drink in: the size picks the cup and the milk
 * picks the jug, so those come first; temperature and cup follow.
 */
export const VARIATION_DISPLAY_ORDER: readonly VariationType[] = ['SIZE', 'MILK', 'TEMPERATURE', 'CUP'];

/** Sorts variations into {@link VARIATION_DISPLAY_ORDER}, keeping ties in the order given. */
export function sortVariationsForDisplay<T extends { type: VariationType }>(variations: readonly T[]): T[] {
  return [...variations].sort(
    (a, b) => VARIATION_DISPLAY_ORDER.indexOf(a.type) - VARIATION_DISPLAY_ORDER.indexOf(b.type),
  );
}

/**
 * Reads an order line's snapshot without trusting its shape — it may come
 * straight from the database's JSON column, a socket payload or an API
 * response.
 *
 * Every field comes back present. Orders placed before options were
 * snapshotted have no `variations` or `modifierLines`; those read as empty
 * lists, so an old order still renders as its product name and notes.
 */
export function readOrderItemSnapshot(raw: unknown): OrderItemSnapshot {
  const snap = isRecord(raw) ? raw : {};
  const variationIds = snap['variationIds'];
  return {
    id: typeof snap['id'] === 'string' ? snap['id'] : '',
    slug: typeof snap['slug'] === 'string' ? snap['slug'] : '',
    name: typeof snap['name'] === 'string' ? snap['name'] : '',
    variationIds: Array.isArray(variationIds) ? variationIds.filter((id): id is string => typeof id === 'string') : [],
    modifiers: readCounts(snap['modifiers']),
    notes: typeof snap['notes'] === 'string' && snap['notes'].trim() !== '' ? snap['notes'] : null,
    unitPrepSeconds: isFiniteNumber(snap['unitPrepSeconds']) ? snap['unitPrepSeconds'] : 0,
    variations: sortVariationsForDisplay(readList(snap['variations'], readVariation)),
    modifierLines: readList(snap['modifierLines'], readModifier),
  };
}

/**
 * The line's options as one run of text for a receipt or an order list:
 * "L · Oat · +Vanilla syrup ×2". Empty when there are none. The customer's
 * notes are left out — they are their own words and get a line of their own.
 */
export function describeOrderItemOptions(snapshot: Pick<OrderItemSnapshot, 'variations' | 'modifierLines'>): string {
  return [
    ...snapshot.variations.map((v) => v.name),
    ...snapshot.modifierLines.map((m) => (m.count > 1 ? `+${m.name} ×${m.count}` : `+${m.name}`)),
  ].join(' · ');
}

/** Recognises the 409 body `POST /orders` answers with when the cart no longer matches the menu. */
export function isCartChangedError(body: unknown): body is CartChangedError {
  return isRecord(body) && body['code'] === 'CART_CHANGED' && Array.isArray(body['items']);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readList<T>(value: unknown, read: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(read).filter((entry): entry is T => entry !== null);
}

function readVariation(entry: unknown): OrderItemVariation | null {
  if (!isRecord(entry)) return null;
  const { id, type, name, priceDeltaCents } = entry;
  if (typeof id !== 'string' || typeof name !== 'string') return null;
  const known = VARIATION_DISPLAY_ORDER.find((t) => t === type);
  if (!known) return null;
  return { id, type: known, name, priceDeltaCents: isFiniteNumber(priceDeltaCents) ? priceDeltaCents : 0 };
}

function readModifier(entry: unknown): OrderItemModifier | null {
  if (!isRecord(entry)) return null;
  const { id, name, count, priceCents } = entry;
  if (typeof id !== 'string' || typeof name !== 'string') return null;
  if (!isFiniteNumber(count) || count <= 0) return null;
  return { id, name, count, priceCents: isFiniteNumber(priceCents) ? priceCents : 0 };
}

function readCounts(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const counts: Record<string, number> = {};
  for (const [id, count] of Object.entries(value)) {
    if (isFiniteNumber(count) && count > 0) counts[id] = count;
  }
  return counts;
}
