import { Injectable, Logger } from '@nestjs/common';

import { StoreAvailabilityService } from '../kitchen/store-availability.service';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Tells every connected client that a store's availability changed
 * (`store.availabilityChanged`): a shift opened, closed or was extended past
 * the hours, the store was switched on or off, its hours were edited — or,
 * from the kitchen schedule cron, the hours or an extension ran out or the
 * queue filled up. Clients refetch the store for `openNow` and the rest.
 *
 * The state is read back from the database rather than passed in, so the
 * event always says what the catalog would say right now — two tablets
 * racing on the same button both announce the same final state.
 *
 * Best effort: the write the caller made has already happened, so a failed
 * read or emit is logged and swallowed instead of failing the request.
 */
@Injectable()
export class StoreAvailabilityNotifier {
  private readonly logger = new Logger(StoreAvailabilityNotifier.name);

  constructor(
    private readonly availability: StoreAvailabilityService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async announce(storeId: string): Promise<void> {
    try {
      const store = await this.availability.forStore(storeId);
      if (!store) return;
      this.realtime.emitStoreAvailabilityChanged({
        storeId,
        brandId: store.brandId,
        acceptingOrders: store.acceptingOrders,
      });
    } catch (err) {
      this.logger.warn(`store.availabilityChanged for ${storeId} not sent: ${(err as Error).message}`);
    }
  }

  /** A store that no longer exists takes no orders; there is nothing left to read. */
  announceGone(store: { id: string; brandId: string }): void {
    this.realtime.emitStoreAvailabilityChanged({ storeId: store.id, brandId: store.brandId, acceptingOrders: false });
  }
}
