/**
 * True when the store takes no orders at all right now — switched off, or no
 * shift started ("Start work" in the cabinet). Such a store is shown as
 * inactive and checkout is refused. A store from an API that predates shifts
 * counts as active unless it is closed.
 */
export function isStoreInactive(store: { status: string; acceptingOrders?: boolean }): boolean {
  return store.status === 'CLOSED' || store.acceptingOrders === false;
}
