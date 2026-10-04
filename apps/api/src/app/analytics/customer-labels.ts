import type { PrismaService } from '../prisma/prisma.service';
import type { AnalyticsScope } from './analytics-scope';
import { orderWhere } from './analytics-sql';

export interface CustomerLabel {
  name: string | null;
  phone: string | null;
}

/**
 * How the business knows each customer: the account's name and phone, or
 * the ones typed at their latest checkout here when the account has none (a
 * Telegram sign-in often carries no phone). Deleted accounts are scrubbed on
 * both, so they come back blank.
 */
export async function customerLabels(
  prisma: PrismaService,
  scope: AnalyticsScope,
  userIds: readonly string[],
): Promise<Map<string, CustomerLabel>> {
  const labels = new Map<string, CustomerLabel>();
  if (userIds.length === 0) return labels;
  const ids = [...new Set(userIds)];
  const [users, latest] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true } }),
    prisma.order.findMany({
      where: { ...orderWhere(scope), userId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      distinct: ['userId'],
      select: { userId: true, customerName: true, customerPhone: true },
    }),
  ]);
  const checkout = new Map(latest.map((o) => [o.userId, o]));
  for (const user of users) {
    const order = checkout.get(user.id);
    labels.set(user.id, {
      name: user.name ?? order?.customerName ?? null,
      phone: user.phone ?? order?.customerPhone ?? null,
    });
  }
  return labels;
}
