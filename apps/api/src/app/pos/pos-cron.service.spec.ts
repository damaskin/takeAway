import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PosProvider, PosSyncJobKind, PosSyncJobStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PosCronService } from './pos-cron.service';
import { POS_SYNC_QUEUE } from './pos-sync.queue';
import { IikoProvider } from './providers/iiko.provider';
import { PosterProvider } from './providers/poster.provider';

describe('PosCronService.pollStopLists', () => {
  const buildModule = async (
    integrations: Array<{ id: string; provider: PosProvider }>,
    providerFlags: { iiko: boolean; poster: boolean },
  ) => {
    const prisma = {
      posIntegration: { findMany: jest.fn().mockResolvedValue(integrations) },
      posSyncJob: {
        create: jest.fn(async ({ data }) => ({
          id: `job-${data.integrationId}`,
          kind: data.kind,
          status: PosSyncJobStatus.PENDING,
        })),
      },
    };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        PosCronService,
        { provide: PrismaService, useValue: prisma },
        { provide: IikoProvider, useValue: { kind: 'IIKO', supportsStopListPolling: providerFlags.iiko } },
        { provide: PosterProvider, useValue: { kind: 'POSTER', supportsStopListPolling: providerFlags.poster } },
        { provide: getQueueToken(POS_SYNC_QUEUE), useValue: queue },
      ],
    }).compile();
    return { service: module.get(PosCronService), prisma, queue };
  };

  it('skips every connected integration when no provider opts in', async () => {
    const { service, prisma, queue } = await buildModule(
      [
        { id: 'a', provider: PosProvider.IIKO },
        { id: 'b', provider: PosProvider.POSTER },
      ],
      { iiko: false, poster: false },
    );
    await service.pollStopLists();
    expect(prisma.posSyncJob.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('enqueues a STOP_LIST job per opted-in provider integration', async () => {
    const { service, prisma, queue } = await buildModule(
      [
        { id: 'a', provider: PosProvider.IIKO },
        { id: 'b', provider: PosProvider.POSTER },
      ],
      { iiko: true, poster: false },
    );
    await service.pollStopLists();
    expect(prisma.posSyncJob.create).toHaveBeenCalledTimes(1);
    expect(prisma.posSyncJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ integrationId: 'a', kind: PosSyncJobKind.STOP_LIST }),
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      PosSyncJobKind.STOP_LIST,
      expect.objectContaining({ integrationId: 'a' }),
      expect.any(Object),
    );
  });
});
