import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { PosSyncJobKind } from '@prisma/client';
import { Job } from 'bullmq';

import { PosService } from './pos.service';
import { POS_SYNC_QUEUE, PosSyncJobPayload } from './pos-sync.queue';
import { IikoProvider } from './providers/iiko.provider';
import { PosterProvider } from './providers/poster.provider';
import type { IPosProvider, SyncProgressCtx } from './providers/pos-provider.interface';

/**
 * BullMQ worker for the POS sync queue. Dispatches by {@link PosSyncJobKind}
 * to the right provider method, then funnels the result through the matching
 * `PosService.upsertImported*` helper so the data actually lands in our
 * Store / Category / Product / StopListEntry tables.
 *
 * Failure flow: the job row + parent PosIntegration both get the error
 * message, integration flips to `ERROR`. BullMQ retries are configured at
 * the queue level (currently disabled — first failure becomes a final
 * failure to keep the operator-facing surface honest).
 */
@Processor(POS_SYNC_QUEUE)
export class PosSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(PosSyncProcessor.name);
  private readonly providersByKind: { IIKO: IPosProvider; POSTER: IPosProvider };

  constructor(
    private readonly pos: PosService,
    iiko: IikoProvider,
    poster: PosterProvider,
  ) {
    super();
    this.providersByKind = { IIKO: iiko, POSTER: poster };
  }

  async process(job: Job<PosSyncJobPayload>): Promise<void> {
    const { syncJobId, integrationId, kind } = job.data;
    await this.pos._markJobRunning(syncJobId);

    try {
      const ctx = await this.pos.loadIntegrationCtx(integrationId);
      const provider = this.providersByKind[ctx.row.provider];
      const progress: SyncProgressCtx = {
        setTotal: async (total) => {
          await this.pos._setJobProgress(syncJobId, 0, total);
          await job.updateProgress({ total, current: 0 });
        },
        advance: async (delta) => {
          const cur = await this.readProgress(job, delta);
          await this.pos._setJobProgress(syncJobId, cur);
          await job.updateProgress({ current: cur });
        },
      };

      switch (kind) {
        case PosSyncJobKind.STORES: {
          const drafts = await provider.listStores(ctx);
          const result = await this.pos.upsertImportedStores(integrationId, drafts);
          this.logger.log(`STORES sync ok: created=${result.created} updated=${result.updated}`);
          break;
        }
        case PosSyncJobKind.MENU: {
          const menu = await provider.importMenu(ctx, progress);
          const result = await this.pos.upsertImportedMenu(integrationId, menu);
          this.logger.log(
            `MENU sync ok: categories ${result.categories.created}/${result.categories.updated}, ` +
              `products ${result.products.created}/${result.products.updated}`,
          );
          break;
        }
        case PosSyncJobKind.STOP_LIST: {
          const entries = await provider.importStopList(ctx, progress);
          const result = await this.pos.upsertImportedStopList(integrationId, entries);
          this.logger.log(`STOP_LIST sync ok: wiped=${result.wiped} created=${result.created}`);
          break;
        }
        case PosSyncJobKind.ORDER_PUSH:
          throw new Error('ORDER_PUSH is wired in M3 — should not be enqueued yet');
      }

      await this.pos._markJobCompleted(syncJobId, integrationId);
    } catch (err) {
      const message = (err as Error).message ?? 'unknown error';
      this.logger.warn(`POS sync ${kind} failed for integration=${integrationId}: ${message}`);
      await this.pos._markJobFailed(syncJobId, integrationId, message);
      throw err;
    }
  }

  /**
   * BullMQ's per-job progress is opaque JSON — we keep our own counter on
   * the job row and read whatever was last written back here. Acts as the
   * single source of truth for {@link SyncProgressCtx.advance}.
   */
  private async readProgress(job: Job<PosSyncJobPayload>, delta: number): Promise<number> {
    const cur = (job.progress as { current?: number } | undefined)?.current ?? 0;
    return cur + delta;
  }
}
