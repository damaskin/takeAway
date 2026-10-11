import { Logger, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { type Campaign, Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { OpsChatService } from '../notifications/ops-chat.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CampaignModerationService } from './campaign-moderation.service';
import type { CampaignsService } from './campaigns.service';

const owner = { id: 'owner', role: Role.BRAND_ADMIN } as AuthenticatedUser;
const root = { id: 'root', role: Role.SUPER_ADMIN } as AuthenticatedUser;
const NOW = new Date('2026-10-10T12:00:00Z');

const base: Campaign = {
  id: 'c1',
  brandId: 'b1',
  title: 'Скидка',
  body: '−20% на капучино до пятницы',
  channel: 'PUSH',
  audience: 'INACTIVE_30D',
  status: 'DRAFT',
  targetCount: 0,
  sentCount: 0,
  failedCount: 0,
  noChannelCount: 0,
  optedOutCount: 0,
  lastError: null,
  scheduledAt: null,
  createdById: 'owner',
  submittedAt: null,
  reviewedAt: null,
  reviewedById: null,
  reviewNote: null,
  approvedAt: null,
  startedAt: null,
  sentAt: null,
  createdAt: new Date('2026-10-09T10:00:00Z'),
  updatedAt: new Date('2026-10-09T10:00:00Z'),
};

interface Where {
  id?: string;
  status?: Campaign['status'] | { in: Array<Campaign['status']> };
}

describe('CampaignModerationService', () => {
  let row: Campaign | null;
  let prisma: {
    campaign: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let campaigns: { findOwned: jest.Mock; audienceSize: jest.Mock; startIfDue: jest.Mock; preview: jest.Mock };
  let opsChat: { enabled: boolean; send: jest.Mock };
  let service: CampaignModerationService;
  let errors: jest.SpyInstance;

  function given(over: Partial<Campaign> = {}): void {
    row = { ...base, ...over };
  }

  beforeEach(() => {
    given();
    prisma = {
      campaign: {
        findUnique: jest.fn(({ select }: { select?: Record<string, unknown> }) =>
          Promise.resolve(row && select?.['brand'] ? { ...row, brand: { name: 'Кофейня Ромашка' } } : row),
        ),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(row)),
        findMany: jest.fn(() => Promise.resolve(row ? [row] : [])),
        updateMany: jest.fn(({ where, data }: { where: Where; data: Partial<Campaign> }) => {
          if (!row || (where.id && where.id !== row.id)) return Promise.resolve({ count: 0 });
          const s = where.status;
          if (typeof s === 'string' && s !== row.status) return Promise.resolve({ count: 0 });
          if (typeof s === 'object' && !s.in.includes(row.status)) return Promise.resolve({ count: 0 });
          row = { ...row, ...data };
          return Promise.resolve({ count: 1 });
        }),
        count: jest.fn().mockResolvedValue(3),
      },
    };
    campaigns = {
      findOwned: jest.fn((brandId: string) =>
        row && row.brandId === brandId ? Promise.resolve(row) : Promise.reject(new NotFoundException()),
      ),
      audienceSize: jest.fn().mockResolvedValue(42),
      startIfDue: jest.fn().mockResolvedValue(true),
      preview: jest.fn().mockResolvedValue({ total: 42, reachable: 30 }),
    };
    opsChat = { enabled: true, send: jest.fn().mockResolvedValue(true) };
    service = new CampaignModerationService(
      prisma as unknown as PrismaService,
      campaigns as unknown as CampaignsService,
      opsChat as unknown as OpsChatService,
      {
        get: jest.fn((key: string) => (key === 'ADMIN_APP_URL' ? 'https://admin.takeaway.md/' : undefined)),
      } as unknown as ConfigService,
    );
    errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => errors.mockRestore());

  /** Lets the fire-and-forget ops alert finish. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  describe('submit', () => {
    it('puts a business draft in the queue and tells the ops chat — nothing is sent', async () => {
      const result = await service.submit('b1', 'c1', owner, NOW);
      await flush();

      expect(result).toMatchObject({ status: 'PENDING_REVIEW', submittedAt: NOW, approvedAt: null });
      expect(campaigns.startIfDue).not.toHaveBeenCalled();
      expect(opsChat.send).toHaveBeenCalledTimes(1);
      const text = opsChat.send.mock.calls[0][0] as string;
      expect(text).toContain('Рассылка на модерации: Кофейня Ромашка');
      expect(text).toContain('не возвращались 30+ дней (42)');
      expect(text).toContain('−20% на капучино до пятницы');
      expect(text).toContain('https://admin.takeaway.md/campaign-moderation');
    });

    it('resubmits a rejected campaign and clears the old reason', async () => {
      given({ status: 'REJECTED', reviewNote: 'Уберите капс', reviewedAt: new Date('2026-10-09T12:00:00Z') });

      const result = await service.submit('b1', 'c1', owner, NOW);

      expect(result).toMatchObject({ status: 'PENDING_REVIEW', reviewNote: null });
    });

    it("approves a platform admin's own campaign on the spot and starts it", async () => {
      const result = await service.submit('b1', 'c1', root, NOW);
      await flush();

      expect(result).toMatchObject({ status: 'APPROVED', approvedAt: NOW, reviewedById: 'root' });
      expect(campaigns.startIfDue).toHaveBeenCalledWith('c1', NOW);
      expect(opsChat.send).not.toHaveBeenCalled();
    });

    it.each(['PENDING_REVIEW', 'APPROVED', 'SENDING', 'SENT', 'FAILED'] as const)(
      'refuses to submit a %s campaign',
      async (status) => {
        given({ status });

        await expect(service.submit('b1', 'c1', owner, NOW)).rejects.toMatchObject({
          response: { code: 'CAMPAIGN_NOT_SUBMITTABLE' },
        });
        expect(prisma.campaign.updateMany).not.toHaveBeenCalled();
      },
    );

    it('refuses a send time that has already passed', async () => {
      given({ scheduledAt: new Date('2026-10-10T11:00:00Z') });

      await expect(service.submit('b1', 'c1', owner, NOW)).rejects.toMatchObject({
        response: { code: 'CAMPAIGN_SCHEDULED_IN_PAST' },
      });
      expect(row?.status).toBe('DRAFT');
    });

    it('refuses an audience nobody is in yet, instead of queueing it', async () => {
      campaigns.audienceSize.mockResolvedValue(0);

      await expect(service.submit('b1', 'c1', owner, NOW)).rejects.toMatchObject({
        response: { code: 'CAMPAIGN_NO_RECIPIENTS' },
      });
      expect(row?.status).toBe('DRAFT');
    });

    it('stays submitted when the ops chat is down', async () => {
      opsChat.send.mockRejectedValue(new Error('Telegram 502'));

      await expect(service.submit('b1', 'c1', owner, NOW)).resolves.toMatchObject({ status: 'PENDING_REVIEW' });
      await flush();
      expect(row?.status).toBe('PENDING_REVIEW');
    });
  });

  describe('decisions', () => {
    beforeEach(() => given({ status: 'PENDING_REVIEW', submittedAt: new Date('2026-10-10T09:00:00Z') }));

    it('approves and starts the run (now, or at the scheduled time — startIfDue decides)', async () => {
      const result = await service.approve('c1', root, NOW);

      expect(result).toMatchObject({ status: 'APPROVED', approvedAt: NOW, reviewedAt: NOW, reviewedById: 'root' });
      expect(campaigns.startIfDue).toHaveBeenCalledWith('c1', NOW);
    });

    it('keeps the approval when the start fails; the scheduler picks it up', async () => {
      campaigns.startIfDue.mockRejectedValue(new Error('connection reset'));

      await expect(service.approve('c1', root, NOW)).resolves.toMatchObject({ status: 'APPROVED' });
    });

    it('rejects with the reason the business sees, and sends nothing', async () => {
      const result = await service.reject('c1', root, 'Нельзя обещать «бесплатно» без условий', NOW);

      expect(result).toMatchObject({
        status: 'REJECTED',
        reviewNote: 'Нельзя обещать «бесплатно» без условий',
        approvedAt: null,
        reviewedById: 'root',
      });
      expect(campaigns.startIfDue).not.toHaveBeenCalled();
    });

    it.each(['DRAFT', 'APPROVED', 'REJECTED', 'SENT'] as const)(
      'refuses to decide on a %s campaign — someone else already did',
      async (status) => {
        given({ status });

        await expect(service.approve('c1', root, NOW)).rejects.toMatchObject({
          response: { code: 'CAMPAIGN_NOT_PENDING' },
        });
        await expect(service.reject('c1', root, 'нет', NOW)).rejects.toMatchObject({
          response: { code: 'CAMPAIGN_NOT_PENDING' },
        });
        expect(campaigns.startIfDue).not.toHaveBeenCalled();
      },
    );

    it('404s a campaign that does not exist', async () => {
      row = null;

      await expect(service.approve('c1', root, NOW)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('queue', () => {
    it('lists what waits, oldest first, with who it reaches right now', async () => {
      given({ status: 'PENDING_REVIEW' });

      const items = await service.list('PENDING_REVIEW');

      expect(prisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PENDING_REVIEW' },
          orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
        }),
      );
      expect(campaigns.preview).toHaveBeenCalledWith('b1', 'INACTIVE_30D', 'PUSH');
      expect(items).toEqual([{ campaign: row, reach: { total: 42, reachable: 30 } }]);
    });

    it('lists everything ever approved under "approved", newest decision first', async () => {
      await service.list('APPROVED');

      expect(prisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { approvedAt: { not: null } }, orderBy: expect.any(Array) }),
      );
      expect(campaigns.preview).not.toHaveBeenCalled();
    });

    it('counts the campaigns waiting for the sidebar badge', async () => {
      await expect(service.pendingCount()).resolves.toEqual({ count: 3 });
      expect(prisma.campaign.count).toHaveBeenCalledWith({ where: { status: 'PENDING_REVIEW' } });
    });
  });
});
