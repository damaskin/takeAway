import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PosProvider } from '@prisma/client';

import { BrandScopeService } from '../auth/services/brand-scope.service';
import { SecretCipher } from '../common/crypto/secret-cipher';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { POS_SYNC_QUEUE } from './pos-sync.queue';
import { PosService } from './pos.service';
import { IikoProvider } from './providers/iiko.provider';
import { PosterProvider } from './providers/poster.provider';

/** A POS spot becomes a store the owner still has to finish — not a live one at 0,0. */
describe('PosService.upsertImportedStores', () => {
  async function build(siblingZones: string[]) {
    const prisma = {
      posIntegration: {
        findUnique: jest.fn().mockResolvedValue({
          brandId: 'brand-1',
          provider: PosProvider.POSTER,
          brand: { currency: 'MDL' },
        }),
      },
      store: {
        findMany: jest.fn().mockResolvedValue(siblingZones.map((timezone) => ({ timezone }))),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        PosService,
        { provide: PrismaService, useValue: prisma },
        { provide: SecretCipher, useValue: {} },
        { provide: BrandScopeService, useValue: {} },
        { provide: IikoProvider, useValue: {} },
        { provide: PosterProvider, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
        { provide: getQueueToken(POS_SYNC_QUEUE), useValue: {} },
      ],
    }).compile();
    return { service: module.get(PosService), prisma };
  }

  function createdData(prisma: Awaited<ReturnType<typeof build>>['prisma']): Record<string, unknown> {
    const args = prisma.store.create.mock.calls[0] as [{ data: Record<string, unknown> }] | undefined;
    if (!args) throw new Error('no store was created');
    return args[0].data;
  }

  it("creates the store closed, in the brand's currency and its stores' zone", async () => {
    const { service, prisma } = await build(['Europe/Chisinau']);
    await service.upsertImportedStores('int-1', [{ externalId: '7', name: 'Балка' }]);
    expect(createdData(prisma)).toMatchObject({
      status: 'CLOSED',
      currency: 'MDL',
      timezone: 'Europe/Chisinau',
      latitude: 0,
      longitude: 0,
    });
  });

  it('keeps a zone the POS reports, and falls back to the UTC placeholder with nothing to go on', async () => {
    const reported = await build(['Europe/Chisinau']);
    await reported.service.upsertImportedStores('int-1', [{ externalId: '7', name: 'Балка', timezone: 'Europe/Kiev' }]);
    expect(createdData(reported.prisma)['timezone']).toBe('Europe/Kiev');

    const nothing = await build([]);
    await nothing.service.upsertImportedStores('int-1', [{ externalId: '7', name: 'Балка', timezone: 'nonsense' }]);
    expect(createdData(nothing.prisma)['timezone']).toBe('UTC');
  });
});
