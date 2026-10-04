/**
 * Socket.io events on the `/ws` namespace that are not tied to one order.
 *
 * Public events go to every connected socket, signed in or not: they carry
 * nothing private, so a storefront open in a browser tab can follow them
 * without an account.
 */

/** Event name of {@link StoreAvailabilityChangedEvent}. */
export type StoreAvailabilityChangedEventName = 'store.availabilityChanged';

/**
 * A store started or stopped taking orders: a shift was opened or closed,
 * or the owner switched the store on or off. `acceptingOrders` has the same
 * meaning as on the catalog's store DTO; clients refetch the store when they
 * need `openNow` (it also depends on working hours and the current ETA).
 */
export interface StoreAvailabilityChangedEvent {
  storeId: string;
  brandId: string;
  acceptingOrders: boolean;
}
