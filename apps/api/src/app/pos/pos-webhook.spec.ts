import { createHmac } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { PosIntegrationStatus, PosProvider, PosSyncJobKind, PosSyncJobStatus } from '@prisma/client';

import { BrandScopeService } from '../auth/services/brand-scope.service';
import { SecretCipher } from '../common/crypto/secret-cipher';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { POS_SYNC_QUEUE } from './pos-sync.queue';
import { PosService } from './pos.service';
import { IikoProvider } from './providers/iiko.provider';
import { PosterProvider } from './providers/poster.provider';

const baseIntegration = {
  id: 'int-1',
  brandId: 'brand-1',
  provider: PosProvider.POSTER,
  status: PosIntegrationStatus.CONNECTED,
  settings: {} as Record<string, unknown>,
};

const buildPrisma = (overrides: { settings?: Record<string, unknown> } = {}) => ({
  posIntegration: {
    findFirst: jest.fn().mockResolvedValue({ ...baseIntegration, settings: overrides.settings ?? {} }),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  },
  posSyncJob: {
    create: jest.fn(async ({ data }) => ({
      id: 'job-1',
      kind: data.kind,
      status: PosSyncJobStatus.PENDING,
      progress: 0,
      total: 0,
      errorMessage: null,
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
    })),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  order: { findUnique: jest.fn(), update: jest.fn() },
  product: { findMany: jest.fn() },
  modifier: { findMany: jest.fn() },
});

const buildModule = async (prisma: ReturnType<typeof buildPrisma>) => {
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const module = await Test.createTestingModule({
    providers: [
      PosService,
      { provide: PrismaService, useValue: prisma },
      { provide: SecretCipher, useValue: new SecretCipher({ get: () => undefined } as unknown as ConfigService) },
      { provide: BrandScopeService, useValue: { resolveBrandIds: jest.fn(), brandWhere: jest.fn() } },
      { provide: IikoProvider, useValue: { kind: 'IIKO' } },
      { provide: PosterProvider, useValue: { kind: 'POSTER' } },
      {
        provide: NotificationsService,
        useValue: { notifyBrandAdminPosError: jest.fn().mockResolvedValue(undefined) },
      },
      { provide: getQueueToken(POS_SYNC_QUEUE), useValue: queue },
    ],
  }).compile();
  return { service: module.get(PosService), queue };
};

describe('PosService.handlePosterWebhook', () => {
  it('enqueues a MENU sync for product/changed without a configured secret', async () => {
    const prisma = buildPrisma();
    const { service, queue } = await buildModule(prisma);

    const accepted = await service.handlePosterWebhook('brand-1', {}, { object: 'product', action: 'changed' });
    expect(accepted).toBe(true);
    expect(prisma.posSyncJob.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: PosSyncJobKind.MENU }) }),
    );
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('rejects events whose object/action does not map to a sync kind', async () => {
    const prisma = buildPrisma();
    const { service, queue } = await buildModule(prisma);
    const accepted = await service.handlePosterWebhook('brand-1', {}, { object: 'client', action: 'added' });
    expect(accepted).toBe(false);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects when no integration is connected for the brand', async () => {
    const prisma = buildPrisma();
    prisma.posIntegration.findFirst.mockResolvedValueOnce(null);
    const { service, queue } = await buildModule(prisma);
    const accepted = await service.handlePosterWebhook('brand-x', {}, { object: 'product', action: 'changed' });
    expect(accepted).toBe(false);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('enforces signature when settings.webhookSecret is set', async () => {
    const secret = 'super-secret-shared-key';
    const prisma = buildPrisma({ settings: { webhookSecret: secret } });
    const { service, queue } = await buildModule(prisma);
    const body = { object: 'product', action: 'changed' };
    const goodSig = createHmac('sha1', secret).update(JSON.stringify(body)).digest('hex');

    // bad signature is rejected
    const bad = await service.handlePosterWebhook('brand-1', { 'x-poster-signature': 'deadbeef' }, body);
    expect(bad).toBe(false);
    expect(queue.add).not.toHaveBeenCalled();

    // matching SHA-1 is accepted (Poster's `verify` field flavour)
    const good = await service.handlePosterWebhook('brand-1', {}, { ...body, verify: goodSig });
    expect(good).toBe(true);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});
