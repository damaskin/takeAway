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
 * A store's availability changed: its `acceptingOrders` or its `openNow`
 * (a shift opened, closed or was extended, the owner switched the store on
 * or off, the working hours or an extension ran out, the queue filled up).
 * The payload carries `acceptingOrders` only, with the same meaning as on
 * the catalog's store DTO; clients refetch the store for `openNow`,
 * `asapBlockedReason`, `opensAt` and `closesAt`.
 */
export interface StoreAvailabilityChangedEvent {
  storeId: string;
  brandId: string;
  acceptingOrders: boolean;
}
