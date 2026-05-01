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
 * BullMQ worker for the POS sync queue. One handler dispatches by
 * {@link PosSyncJobKind} into the right provider method, marking the
 * matching {@link PosSyncJob} row as RUNNING / COMPLETED / FAILED along
 * the way.
 *
 * Failure is recorded against both the job row and the parent
 * PosIntegration (`status: ERROR`, `lastErrorMessage` populated). BullMQ
 * itself retries per the queue config; the row only flips to FAILED on
 * the final attempt — see {@link onFailed}.
 *
 * Side-effects (writing imported menus into Category/Product/etc.) are
 * deferred to M2 — for now we just plumb progress through the provider
 * layer and persist whatever it returns to the syncJob row's metadata.
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
        case PosSyncJobKind.MENU:
          await provider.importMenu(ctx, progress);
          break;
        case PosSyncJobKind.STOP_LIST:
          await provider.importStopList(ctx, progress);
          break;
        case PosSyncJobKind.STORES:
          await provider.listStores(ctx);
          break;
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
