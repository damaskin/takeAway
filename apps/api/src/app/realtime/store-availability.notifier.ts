import { Injectable, Logger } from '@nestjs/common';

import { acceptingOrders } from '../catalog/store-availability';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Tells every connected client that a store started or stopped taking
 * orders (`store.availabilityChanged`). Called after anything that changes
 * the inputs of {@link acceptingOrders}: a shift opened or closed, the store
 * switched on or off.
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
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async announce(storeId: string): Promise<void> {
    try {
      const store = await this.prisma.store.findUnique({
        where: { id: storeId },
        select: {
          id: true,
          brandId: true,
          status: true,
          shifts: { where: { closedAt: null }, select: { id: true }, take: 1 },
        },
      });
      if (!store) return;
      this.realtime.emitStoreAvailabilityChanged({
        storeId: store.id,
        brandId: store.brandId,
        acceptingOrders: acceptingOrders(store),
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
