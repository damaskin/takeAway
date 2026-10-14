import { Injectable, NotFoundException } from '@nestjs/common';
import type { CustomerNotification, Prisma } from '@prisma/client';
import {
  INBOX_PAGE_MAX,
  INBOX_PAGE_SIZE,
  type InboxItem,
  type InboxLink,
  type InboxPage,
} from '@takeaway/shared-types';

import { PLATFORM_SENDER_NAME } from '../notifications/push-copy';
import { PrismaService } from '../prisma/prisma.service';

const ITEM_INCLUDE = { brand: { select: { id: true, name: true, logoUrl: true } } } as const;

type ItemRow = Prisma.CustomerNotificationGetPayload<{ include: typeof ITEM_INCLUDE }>;

/** The copy and link of a campaign or announcement, as each recipient's item keeps it. */
export interface InboxSource {
  id: string;
  title: string;
  body: string;
}

/** A store or brand open to customers — the same rule as the public catalog. */
const PUBLIC_STORE: Prisma.StoreWhereInput = { status: { not: 'CLOSED' }, brand: { moderationStatus: 'APPROVED' } };

/**
 * «Уведомления» — the customer's inbox. Campaign and announcement runs write
 * one item per recipient before the push goes out, so the push can carry the
 * item's id; the customer reads them here, scoped to their own account.
 */
@Injectable()
export class InboxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gives each user an item for a brand's PUSH campaign and returns
   * user id → item id. Idempotent: a retry of the run finds the items the
   * first attempt wrote.
   */
  async writeForCampaign(campaign: InboxSource & { brandId: string }, userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    await this.prisma.customerNotification.createMany({
      data: userIds.map((userId) => ({
        userId,
        kind: 'BRAND_CAMPAIGN' as const,
        title: campaign.title,
        body: campaign.body,
        brandId: campaign.brandId,
        campaignId: campaign.id,
      })),
      skipDuplicates: true,
    });
    const rows = await this.prisma.customerNotification.findMany({
      where: { campaignId: campaign.id, userId: { in: userIds } },
      select: { id: true, userId: true },
    });
    return new Map(rows.map((r) => [r.userId, r.id]));
  }

  /** {@link writeForCampaign} for a platform announcement; the link goes along. */
  async writeForAnnouncement(
    announcement: InboxSource & { linkStoreId: string | null; linkBrandId: string | null },
    userIds: string[],
  ): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    await this.prisma.customerNotification.createMany({
      data: userIds.map((userId) => ({
        userId,
        kind: 'PLATFORM_ANNOUNCEMENT' as const,
        title: announcement.title,
        body: announcement.body,
        announcementId: announcement.id,
        linkStoreId: announcement.linkStoreId,
        linkBrandId: announcement.linkBrandId,
      })),
      skipDuplicates: true,
    });
    const rows = await this.prisma.customerNotification.findMany({
      where: { announcementId: announcement.id, userId: { in: userIds } },
      select: { id: true, userId: true },
    });
    return new Map(rows.map((r) => [r.userId, r.id]));
  }

  /** The user's messages, newest first; `cursor` is the last id of the previous page. */
  async list(userId: string, options: { cursor?: string; limit?: number } = {}): Promise<InboxPage> {
    const limit = Math.min(Math.max(options.limit ?? INBOX_PAGE_SIZE, 1), INBOX_PAGE_MAX);
    const where: Prisma.CustomerNotificationWhereInput = { userId };
    if (options.cursor) {
      // Resolved by the user too: a cursor of someone else's item reads as the first page.
      const after = await this.prisma.customerNotification.findFirst({
        where: { id: options.cursor, userId },
        select: { id: true, createdAt: true },
      });
      if (after) {
        where.OR = [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }];
      }
    }
    const [rows, unreadCount] = await Promise.all([
      this.prisma.customerNotification.findMany({
        where,
        include: ITEM_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      this.unreadCount(userId),
    ]);
    const page = rows.slice(0, limit);
    const items = await this.toItems(page);
    return {
      items,
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
      unreadCount,
    };
  }

  /** One message of the user's; 404 for anyone else's. */
  async get(userId: string, id: string): Promise<InboxItem> {
    const row = await this.prisma.customerNotification.findFirst({ where: { id, userId }, include: ITEM_INCLUDE });
    if (!row) throw new NotFoundException('Notification not found');
    const [item] = await this.toItems([row]);
    return item as InboxItem;
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.customerNotification.count({ where: { userId, readAt: null } });
  }

  /** Marks one of the user's messages read (again is fine); 404 for anyone else's. */
  async markRead(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.customerNotification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (count > 0) return;
    const exists = await this.prisma.customerNotification.findFirst({ where: { id, userId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Notification not found');
  }

  /** «Прочитать все». Returns how many were unread. */
  async markAllRead(userId: string): Promise<number> {
    const { count } = await this.prisma.customerNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return count;
  }

  private async toItems(rows: ItemRow[]): Promise<InboxItem[]> {
    const links = await this.resolveLinks(rows);
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      sender: row.brand
        ? { kind: 'BRAND', name: row.brand.name, logoUrl: row.brand.logoUrl, brandId: row.brand.id }
        : { kind: 'PLATFORM', name: PLATFORM_SENDER_NAME, logoUrl: null, brandId: null },
      link: links(row),
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt ? row.readAt.toISOString() : null,
    }));
  }

  /**
   * Where each item links, looked up now: a store or brand that closed or
   * left the platform since drops the link instead of leading to a 404. A
   * brand with exactly one open store links that store's menu.
   */
  private async resolveLinks(
    rows: Array<Pick<CustomerNotification, 'linkStoreId' | 'linkBrandId'>>,
  ): Promise<(row: Pick<CustomerNotification, 'linkStoreId' | 'linkBrandId'>) => InboxLink | null> {
    const storeIds = [...new Set(rows.map((r) => r.linkStoreId).filter((id): id is string => Boolean(id)))];
    const brandIds = [
      ...new Set(rows.filter((r) => !r.linkStoreId && r.linkBrandId).map((r) => r.linkBrandId as string)),
    ];
    const [stores, brands] = await Promise.all([
      storeIds.length > 0
        ? this.prisma.store.findMany({
            where: { id: { in: storeIds }, ...PUBLIC_STORE },
            select: { id: true, slug: true, name: true, brandId: true },
          })
        : [],
      brandIds.length > 0
        ? this.prisma.brand.findMany({
            where: { id: { in: brandIds }, moderationStatus: 'APPROVED' },
            select: {
              id: true,
              name: true,
              // Two are enough to tell "one store" from "several".
              stores: { where: PUBLIC_STORE, select: { id: true, slug: true }, orderBy: { name: 'asc' }, take: 2 },
            },
          })
        : [],
    ]);
    const storeById = new Map(stores.map((s) => [s.id, s]));
    const brandById = new Map(brands.map((b) => [b.id, b]));
    return (row) => {
      if (row.linkStoreId) {
        const store = storeById.get(row.linkStoreId);
        return store
          ? { kind: 'STORE', storeId: store.id, storeSlug: store.slug, brandId: store.brandId, name: store.name }
          : null;
      }
      if (row.linkBrandId) {
        const brand = brandById.get(row.linkBrandId);
        if (!brand || brand.stores.length === 0) return null;
        const only = brand.stores.length === 1 ? brand.stores[0] : undefined;
        return {
          kind: 'BRAND',
          storeId: only?.id ?? null,
          storeSlug: only?.slug ?? null,
          brandId: brand.id,
          name: brand.name,
        };
      }
      return null;
    };
  }
}
