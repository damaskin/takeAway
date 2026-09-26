import type { KitchenAction, KitchenOrder, KitchenOrderStatus } from './kitchen.api';

/** A `kds.orderChanged` event as the API broadcasts it to a store's room. */
export interface KitchenOrderChanged {
  storeId: string;
  kind: 'created' | 'updated' | 'removed';
  orderId: string;
  /** The full board row; null on "removed", and on updates that only say "look again". */
  order: (Omit<KitchenOrder, 'status'> & { status: string }) | null;
}

export type KitchenColumn = 'NEW' | 'PREPARING' | 'READY';

export const KITCHEN_COLUMNS: readonly KitchenColumn[] = ['NEW', 'PREPARING', 'READY'];

const COLUMN_STATUSES: Record<KitchenColumn, readonly KitchenOrderStatus[]> = {
  NEW: ['CREATED', 'PAID', 'ACCEPTED'],
  PREPARING: ['IN_PROGRESS'],
  READY: ['READY'],
};

const OPEN_STATUSES: readonly string[] = ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY'];

/** Orders someone still has to take on — what the new-order alerts count. */
export function awaitsAcceptance(order: { status: string }): boolean {
  return order.status === 'CREATED' || order.status === 'PAID';
}

export function inColumn(order: KitchenOrder, column: KitchenColumn): boolean {
  return COLUMN_STATUSES[column].includes(order.status);
}

/** The one button a ticket shows, by where it stands. */
export function nextAction(order: KitchenOrder): KitchenAction | null {
  switch (order.status) {
    case 'CREATED':
    case 'PAID':
      return 'accept';
    case 'ACCEPTED':
      return 'start';
    case 'IN_PROGRESS':
      return 'ready';
    case 'READY':
      return 'pickedUp';
    default:
      return null;
  }
}

/**
 * Patches the board with one realtime event. Returns `null` when the event
 * carries no row and the board has to be read again — an update such as
 * "the customer is here" arrives that way.
 */
export function applyKitchenEvent(list: readonly KitchenOrder[], event: KitchenOrderChanged): KitchenOrder[] | null {
  if (event.kind === 'removed') return list.filter((o) => o.id !== event.orderId);
  if (!event.order) return null;
  const incoming = event.order;
  if (!OPEN_STATUSES.includes(incoming.status)) return list.filter((o) => o.id !== incoming.id);
  const row = incoming as KitchenOrder;
  return list.some((o) => o.id === row.id) ? list.map((o) => (o.id === row.id ? row : o)) : [...list, row];
}
