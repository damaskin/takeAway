import type { PrismaService } from '../prisma/prisma.service';
import { InboxService } from './inbox.service';

interface Row {
  id: string;
  userId: string;
  kind: 'BRAND_CAMPAIGN' | 'PLATFORM_ANNOUNCEMENT';
  title: string;
  body: string;
  brandId: string | null;
  campaignId: string | null;
  announcementId: string | null;
  linkStoreId: string | null;
  linkBrandId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

interface Where {
  id?: string;
  userId?: string | { in: string[] };
  readAt?: null;
  campaignId?: string;
  announcementId?: string;
  OR?: Array<{ createdAt: Date | { lt: Date }; id?: { lt: string } }>;
}

const BRANDS: Record<string, { id: string; name: string; logoUrl: string | null }> = {
  noname: { id: 'noname', name: 'NoName Coffee', logoUrl: 'https://cdn/noname.png' },
};

function matches(row: Row, where: Where): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (typeof where.userId === 'string' && row.userId !== where.userId) return false;
  if (typeof where.userId === 'object' && !where.userId.in.includes(row.userId)) return false;
  if (where.readAt === null && row.readAt !== null) return false;
  if (where.campaignId !== undefined && row.campaignId !== where.campaignId) return false;
  if (where.announcementId !== undefined && row.announcementId !== where.announcementId) return false;
  if (where.OR) {
    return where.OR.some((c) =>
      c.createdAt instanceof Date
        ? row.createdAt.getTime() === c.createdAt.getTime() && row.id < (c.id?.lt ?? '')
        : row.createdAt < c.createdAt.lt,
    );
  }
  return true;
}

function row(over: Partial<Row> & Pick<Row, 'id' | 'userId'>): Row {
  return {
    kind: 'BRAND_CAMPAIGN',
    title: 'Скидка',
    body: '−20%',
    brandId: 'noname',
    campaignId: 'c1',
    announcementId: null,
    linkStoreId: null,
    linkBrandId: null,
    readAt: null,
    createdAt: new Date('2026-10-14T10:00:00Z'),
    ...over,
  };
}

function setup(seed: Row[] = []) {
  const rows = [...seed];
  let nextId = 100;
  const withBrand = (r: Row) => ({ ...r, brand: r.brandId ? (BRANDS[r.brandId] ?? null) : null });
  const sorted = () =>
    [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
  const prisma = {
    customerNotification: {
      createMany: jest.fn(
        ({ data, skipDuplicates }: { data: Array<Partial<Row> & Pick<Row, 'userId'>>; skipDuplicates?: boolean }) => {
          let count = 0;
          for (const d of data) {
            const dup = rows.some(
              (r) =>
                r.userId === d.userId &&
                ((d.campaignId && r.campaignId === d.campaignId) ||
                  (d.announcementId && r.announcementId === d.announcementId)),
            );
            if (dup && skipDuplicates) continue;
            rows.push(
              row({
                brandId: null,
                campaignId: null,
                announcementId: null,
                linkStoreId: null,
                linkBrandId: null,
                ...d,
                id: `n${nextId++}`,
              }),
            );
            count++;
          }
          return Promise.resolve({ count });
        },
      ),
      findMany: jest.fn(({ where, take }: { where: Where; take?: number }) =>
        Promise.resolve(
          sorted()
            .filter((r) => matches(r, where))
            .slice(0, take)
            .map(withBrand),
        ),
      ),
      findFirst: jest.fn(({ where }: { where: Where }) => {
        const found = rows.find((r) => matches(r, where));
        return Promise.resolve(found ? withBrand(found) : null);
      }),
      count: jest.fn(({ where }: { where: Where }) => Promise.resolve(rows.filter((r) => matches(r, where)).length)),
      updateMany: jest.fn(({ where, data }: { where: Where; data: Partial<Row> }) => {
        const hit = rows.filter((r) => matches(r, where));
        for (const r of hit) Object.assign(r, data);
        return Promise.resolve({ count: hit.length });
      }),
    },
    store: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          [
            { id: 's-open', slug: 'noname-center', name: 'NoName Центр', brandId: 'noname' },
            // A closed store is filtered out by the query; it is simply absent here.
          ].filter((s) => where.id.in.includes(s.id)),
        ),
      ),
    },
    brand: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          [
            { id: 'one-store', name: 'Solo', stores: [{ id: 's-solo', slug: 'solo' }] },
            {
              id: 'chain',
              name: 'Chain',
              stores: [
                { id: 's-a', slug: 'a' },
                { id: 's-b', slug: 'b' },
              ],
            },
            { id: 'empty', name: 'Not yet', stores: [] },
          ].filter((b) => where.id.in.includes(b.id)),
        ),
      ),
    },
  };
  return { service: new InboxService(prisma as unknown as PrismaService), prisma, rows };
}

describe('InboxService', () => {
  describe('writing', () => {
    it('writes one campaign item per user and returns their ids, also on a retry', async () => {
      const h = setup();
      const campaign = { id: 'c1', brandId: 'noname', title: 'Скидка', body: '−20%' };

      const first = await h.service.writeForCampaign(campaign, ['ana', 'bob']);
      const again = await h.service.writeForCampaign(campaign, ['ana', 'bob']);

      expect(h.rows).toHaveLength(2);
      expect(again).toEqual(first);
      expect(h.rows[0]).toMatchObject({ kind: 'BRAND_CAMPAIGN', brandId: 'noname', campaignId: 'c1', userId: 'ana' });
      expect(h.prisma.customerNotification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
    });

    it('writes announcement items with the link and without a brand sender', async () => {
      const h = setup();
      const ids = await h.service.writeForAnnouncement(
        { id: 'a1', title: 'Новый партнёр', body: 'Solo теперь с нами', linkStoreId: null, linkBrandId: 'one-store' },
        ['ana'],
      );
      expect(ids.get('ana')).toBe(h.rows[0]?.id);
      expect(h.rows[0]).toMatchObject({
        kind: 'PLATFORM_ANNOUNCEMENT',
        brandId: null,
        announcementId: 'a1',
        linkBrandId: 'one-store',
      });
    });

    it('does not touch the database for nobody', async () => {
      const h = setup();
      await expect(h.service.writeForCampaign({ id: 'c1', brandId: 'b', title: 't', body: 'b' }, [])).resolves.toEqual(
        new Map(),
      );
      expect(h.prisma.customerNotification.createMany).not.toHaveBeenCalled();
    });
  });

  describe('reading', () => {
    const at = (minute: number) => new Date(`2026-10-14T10:${String(minute).padStart(2, '0')}:00Z`);

    it("lists only the caller's messages, newest first, with the sender", async () => {
      const h = setup([
        row({ id: 'a', userId: 'ana', createdAt: at(1) }),
        row({ id: 'b', userId: 'bob', createdAt: at(2) }),
        row({
          id: 'c',
          userId: 'ana',
          createdAt: at(3),
          kind: 'PLATFORM_ANNOUNCEMENT',
          brandId: null,
          campaignId: null,
        }),
      ]);
      const page = await h.service.list('ana');

      expect(page.items.map((i) => i.id)).toEqual(['c', 'a']);
      expect(page.items[0]?.sender).toEqual({ kind: 'PLATFORM', name: 'takeAway', logoUrl: null, brandId: null });
      expect(page.items[1]?.sender).toEqual({
        kind: 'BRAND',
        name: 'NoName Coffee',
        logoUrl: 'https://cdn/noname.png',
        brandId: 'noname',
      });
      expect(page).toMatchObject({ nextCursor: null, unreadCount: 2 });
    });

    it('pages with a cursor', async () => {
      const h = setup(Array.from({ length: 5 }, (_, i) => row({ id: `m${i}`, userId: 'ana', createdAt: at(i) })));
      const first = await h.service.list('ana', { limit: 2 });
      expect(first.items.map((i) => i.id)).toEqual(['m4', 'm3']);
      expect(first.nextCursor).toBe('m3');

      const second = await h.service.list('ana', { limit: 2, cursor: first.nextCursor ?? undefined });
      expect(second.items.map((i) => i.id)).toEqual(['m2', 'm1']);

      const last = await h.service.list('ana', { limit: 2, cursor: second.nextCursor ?? undefined });
      expect(last.items.map((i) => i.id)).toEqual(['m0']);
      expect(last.nextCursor).toBeNull();
    });

    it("ignores a cursor that points at someone else's message", async () => {
      const h = setup([row({ id: 'mine', userId: 'ana' }), row({ id: 'theirs', userId: 'bob' })]);
      const page = await h.service.list('ana', { cursor: 'theirs' });
      expect(page.items.map((i) => i.id)).toEqual(['mine']);
    });

    it("404s someone else's message instead of showing it", async () => {
      const h = setup([row({ id: 'theirs', userId: 'bob' })]);
      await expect(h.service.get('ana', 'theirs')).rejects.toMatchObject({ status: 404 });
      await expect(h.service.get('bob', 'theirs')).resolves.toMatchObject({ id: 'theirs' });
    });

    it('resolves links: a store, a one-store brand, a chain, and drops ones that lead nowhere', async () => {
      const ann = { kind: 'PLATFORM_ANNOUNCEMENT' as const, brandId: null, campaignId: null, userId: 'ana' };
      const h = setup([
        row({ ...ann, id: 'store', linkStoreId: 's-open', createdAt: at(5) }),
        row({ ...ann, id: 'closed', linkStoreId: 's-closed', createdAt: at(4) }),
        row({ ...ann, id: 'solo', linkBrandId: 'one-store', createdAt: at(3) }),
        row({ ...ann, id: 'chain', linkBrandId: 'chain', createdAt: at(2) }),
        row({ ...ann, id: 'empty', linkBrandId: 'empty', createdAt: at(1) }),
      ]);
      const links = Object.fromEntries((await h.service.list('ana')).items.map((i) => [i.id, i.link]));

      expect(links['store']).toEqual({
        kind: 'STORE',
        storeId: 's-open',
        storeSlug: 'noname-center',
        brandId: 'noname',
        name: 'NoName Центр',
      });
      expect(links['closed']).toBeNull();
      expect(links['solo']).toEqual({
        kind: 'BRAND',
        storeId: 's-solo',
        storeSlug: 'solo',
        brandId: 'one-store',
        name: 'Solo',
      });
      expect(links['chain']).toEqual({
        kind: 'BRAND',
        storeId: null,
        storeSlug: null,
        brandId: 'chain',
        name: 'Chain',
      });
      expect(links['empty']).toBeNull();
    });
  });

  describe('read state', () => {
    it('marks one of the caller’s messages read, again is fine, someone else’s is 404', async () => {
      const h = setup([row({ id: 'mine', userId: 'ana' }), row({ id: 'theirs', userId: 'bob' })]);

      await h.service.markRead('ana', 'mine');
      await h.service.markRead('ana', 'mine');
      await expect(h.service.markRead('ana', 'theirs')).rejects.toMatchObject({ status: 404 });

      expect(h.rows.find((r) => r.id === 'mine')?.readAt).toBeInstanceOf(Date);
      expect(h.rows.find((r) => r.id === 'theirs')?.readAt).toBeNull();
    });

    it('marks all of the caller’s messages read and nobody else’s', async () => {
      const h = setup([
        row({ id: 'a1', userId: 'ana' }),
        row({ id: 'a2', userId: 'ana', readAt: new Date('2026-10-01T00:00:00Z') }),
        row({ id: 'b1', userId: 'bob' }),
      ]);
      await expect(h.service.markAllRead('ana')).resolves.toBe(1);
      await expect(h.service.unreadCount('ana')).resolves.toBe(0);
      await expect(h.service.unreadCount('bob')).resolves.toBe(1);
    });
  });
});
