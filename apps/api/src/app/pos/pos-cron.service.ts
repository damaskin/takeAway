import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PosIntegrationStatus, PosSyncJobKind, PosSyncJobStatus } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { PrismaService } from '../prisma/prisma.service';
import { POS_SYNC_QUEUE, PosSyncJobPayload } from './pos-sync.queue';
import { IikoProvider } from './providers/iiko.provider';
import { PosterProvider } from './providers/poster.provider';
import type { IPosProvider } from './providers/pos-provider.interface';

const POLL_PRIORITY = 20;

/**
 * Periodic stop-list refresher for back-offices without a push channel
 * (today: iiko Cloud). Scheduled via `@nestjs/schedule`; the implementation
 * is provider-flag driven — only enqueues a STOP_LIST job for providers
 * whose `supportsStopListPolling` is true. Flipping the flag on a provider
 * automatically opts it into the cron without any change here.
 *
 * To avoid stampeding when many integrations are connected, the loop
 * enqueues with a low priority (20 vs 1 for ORDER_PUSH) so live
 * customer-facing pushes always go through first.
 */
@Injectable()
export class PosCronService {
  private readonly logger = new Logger(PosCronService.name);
  private readonly providersByKind: Record<string, IPosProvider>;

  constructor(
    private readonly prisma: PrismaService,
    iiko: IikoProvider,
    poster: PosterProvider,
    @InjectQueue(POS_SYNC_QUEUE) private readonly queue: Queue<PosSyncJobPayload>,
  ) {
    this.providersByKind = { IIKO: iiko, POSTER: poster };
  }

  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'pos-stop-list-poll' })
  async pollStopLists(): Promise<void> {
    const integrations = await this.prisma.posIntegration.findMany({
      where: { status: PosIntegrationStatus.CONNECTED },
      select: { id: true, provider: true },
    });

    let enqueued = 0;
    for (const integration of integrations) {
      const provider = this.providersByKind[integration.provider];
      if (!provider?.supportsStopListPolling) continue;

      const job = await this.prisma.posSyncJob.create({
        data: {
          integrationId: integration.id,
          kind: PosSyncJobKind.STOP_LIST,
          status: PosSyncJobStatus.PENDING,
        },
      });
      await this.queue.add(
        PosSyncJobKind.STOP_LIST,
        { syncJobId: job.id, integrationId: integration.id, kind: PosSyncJobKind.STOP_LIST },
        { priority: POLL_PRIORITY, removeOnComplete: 1000, removeOnFail: 1000 },
      );
      enqueued += 1;
    }
    if (enqueued > 0) this.logger.log(`Stop-list poll: enqueued ${enqueued} job(s)`);
  }
}
