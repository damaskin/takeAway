import type { Promo } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import { PromoService } from './promo.service';

const NOW = new Date('2026-10-10T12:00:00Z');
const day = (offset: number) => new Date(NOW.getTime() + offset * 24 * 60 * 60_000);

type PromoRow = Promo & { _count: { redemptions: number } };

const base: PromoRow = {
  id: 'p1',
  brandId: 'b1',
  code: 'BACK15',
  label: 'Возвращайтесь',
  type: 'PERCENT',
  value: 15,
  minSubtotalCents: null,
  maxRedemptions: 0,
  perUserLimit: 1,
  startsAt: day(-1),
  endsAt: day(13),
  status: 'RUNNING',
  currency: 'MDL',
  inactiveDays: null,
  segmentStoreId: null,
  createdAt: day(-2),
  updatedAt: day(-2),
  _count: { redemptions: 0 },
};

function setup(over: Partial<PromoRow> = {}, opts: { segment?: unknown[]; usedByUser?: number } = {}) {
  let row: PromoRow = { ...base, ...over };
  const prisma = {
    promo: {
      findUnique: jest.fn(() => Promise.resolve(row)),
      create: jest.fn(({ data }: { data: Partial<PromoRow> }) => Promise.resolve({ ...base, ...data })),
      update: jest.fn(({ data }: { data: Partial<PromoRow> }) => {
        const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
        row = { ...row, ...defined };
        return Promise.resolve(row);
      }),
    },
    promoRedemption: { count: jest.fn(() => Promise.resolve(opts.usedByUser ?? 0)) },
    store: { findFirst: jest.fn(() => Promise.resolve({ id: 's1' })) },
    $queryRaw: jest.fn(() => Promise.resolve(opts.segment ?? [])),
  };
  return { svc: new PromoService(prisma as unknown as PrismaService), prisma, row: () => row };
}

describe('PromoService.validate', () => {
  it('lets a started promo work once its date comes, SCHEDULED or RUNNING', async () => {
    const { svc } = setup({ status: 'SCHEDULED' });
    const result = await svc.validate('u1', 'back15', 'b1', 10_000, NOW);
    expect(result).toMatchObject({ valid: true, discountCents: 1_500 });
    expect(result.promo?.status).toBe('RUNNING');
  });

  it('keeps a scheduled promo closed before its start', async () => {
    const { svc } = setup({ status: 'SCHEDULED', startsAt: day(2) });
    await expect(svc.validate('u1', 'BACK15', 'b1', 10_000, NOW)).resolves.toMatchObject({
      valid: false,
      reasonCode: 'PROMO_NOT_STARTED',
    });
  });

  it('refuses drafts and paused promos', async () => {
    for (const status of ['DRAFT', 'PAUSED'] as const) {
      const { svc } = setup({ status });
      await expect(svc.validate('u1', 'BACK15', 'b1', 10_000, NOW)).resolves.toMatchObject({
        reasonCode: 'PROMO_INACTIVE',
      });
    }
  });

  it('gives a win-back code to an inactive customer only', async () => {
    const lapsed = setup({ inactiveDays: 14 }, { segment: [{ orders: 5, lastOrderAt: day(-20) }] });
    await expect(lapsed.svc.validate('u1', 'BACK15', 'b1', 10_000, NOW)).resolves.toMatchObject({ valid: true });

    const regular = setup({ inactiveDays: 14 }, { segment: [{ orders: 5, lastOrderAt: day(-2) }] });
    await expect(regular.svc.validate('u1', 'BACK15', 'b1', 10_000, NOW)).resolves.toMatchObject({
      valid: false,
      reasonCode: 'PROMO_NOT_ELIGIBLE',
    });
  });

  it('lets a signed-out guest preview a win-back code', async () => {
    const { svc, prisma } = setup({ inactiveDays: 14 });
    await expect(svc.validate(null, 'BACK15', 'b1', 10_000, NOW)).resolves.toMatchObject({ valid: true });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('PromoService.update', () => {
  it('edits a draft fully', async () => {
    const { svc, row } = setup({ status: 'DRAFT', _count: { redemptions: 0 } });
    const promo = await svc.update('p1', { code: 'back20', value: 20, inactiveDays: 7 }, NOW);
    expect(promo).toMatchObject({ code: 'BACK20', value: 20, inactiveDays: 7, status: 'DRAFT' });
    expect(row().segmentStoreId).toBeNull();
  });

  it('edits a paused promo nobody has used', async () => {
    const { svc } = setup({ status: 'PAUSED' });
    await expect(svc.update('p1', { label: 'Новое' }, NOW)).resolves.toMatchObject({ label: 'Новое' });
  });

  it('refuses to change a promo that is running or already used', async () => {
    await expect(setup({ status: 'RUNNING' }).svc.update('p1', { value: 50 }, NOW)).rejects.toMatchObject({
      response: { code: 'PROMO_NOT_EDITABLE' },
    });
    await expect(
      setup({ status: 'PAUSED', _count: { redemptions: 3 } }).svc.update('p1', { value: 50 }, NOW),
    ).rejects.toMatchObject({ response: { code: 'PROMO_NOT_EDITABLE' } });
  });

  it('says so when the new code belongs to another promo', async () => {
    const { svc, prisma } = setup({ status: 'DRAFT' });
    prisma.promo.update.mockRejectedValueOnce(Object.assign(new Error('Unique'), { code: 'P2002' }));
    await expect(svc.update('p1', { code: 'TAKEN' }, NOW)).rejects.toMatchObject({
      response: { code: 'PROMO_CODE_TAKEN' },
    });
  });

  it('clears the store when the code stops being win-back only', async () => {
    const { svc, row } = setup({ status: 'DRAFT', inactiveDays: 7, segmentStoreId: 's1' });
    await svc.update('p1', { inactiveDays: null }, NOW);
    expect(row()).toMatchObject({ inactiveDays: null, segmentStoreId: null });
  });
});

describe('PromoService.updateStatus', () => {
  it('starts a draft as SCHEDULED before its date and RUNNING after', async () => {
    const later = setup({ status: 'DRAFT', startsAt: day(3) });
    await later.svc.updateStatus('p1', { status: 'RUNNING' }, NOW);
    expect(later.row().status).toBe('SCHEDULED');

    const now = setup({ status: 'DRAFT' });
    await now.svc.updateStatus('p1', { status: 'RUNNING' }, NOW);
    expect(now.row().status).toBe('RUNNING');
  });

  it('pauses, resumes and ends', async () => {
    const { svc, row } = setup({ status: 'RUNNING' });
    await svc.updateStatus('p1', { status: 'PAUSED' }, NOW);
    expect(row().status).toBe('PAUSED');
    await svc.updateStatus('p1', { status: 'RUNNING' }, NOW);
    expect(row().status).toBe('RUNNING');
    await svc.updateStatus('p1', { status: 'EXPIRED' }, NOW);
    expect(row().status).toBe('EXPIRED');
  });

  it('refuses moves outside draft → active → paused → ended', async () => {
    await expect(setup({ status: 'EXPIRED' }).svc.updateStatus('p1', { status: 'RUNNING' }, NOW)).rejects.toMatchObject(
      { response: { code: 'PROMO_STATUS_NOT_ALLOWED' } },
    );
    await expect(setup({ status: 'RUNNING' }).svc.updateStatus('p1', { status: 'DRAFT' }, NOW)).rejects.toMatchObject({
      response: { code: 'PROMO_STATUS_NOT_ALLOWED' },
    });
    // Past its end an active promo is ended already.
    await expect(
      setup({ status: 'RUNNING', endsAt: day(-1) }).svc.updateStatus('p1', { status: 'PAUSED' }, NOW),
    ).rejects.toMatchObject({ response: { code: 'PROMO_STATUS_NOT_ALLOWED' } });
  });

  it('will not start a draft whose end date has passed', async () => {
    await expect(
      setup({ status: 'DRAFT', startsAt: day(-10), endsAt: day(-1) }).svc.updateStatus(
        'p1',
        { status: 'RUNNING' },
        NOW,
      ),
    ).rejects.toMatchObject({ response: { code: 'PROMO_ENDED' } });
  });
});

describe('PromoService.create', () => {
  it('stores an active promo that starts later as SCHEDULED', async () => {
    const { svc, prisma } = setup();
    await svc.create(
      {
        brandId: 'b1',
        code: 'back15',
        label: 'Возвращайтесь',
        type: 'PERCENT',
        value: 15,
        startsAt: day(1).toISOString(),
        endsAt: day(15).toISOString(),
        status: 'RUNNING',
        inactiveDays: 14,
        segmentStoreId: 's1',
      },
      NOW,
    );
    expect(prisma.promo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ code: 'BACK15', status: 'SCHEDULED', inactiveDays: 14, segmentStoreId: 's1' }),
      }),
    );
    expect(prisma.store.findFirst).toHaveBeenCalledWith({ where: { id: 's1', brandId: 'b1' }, select: { id: true } });
  });
});
