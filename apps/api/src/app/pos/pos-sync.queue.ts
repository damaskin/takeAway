import { PosSyncJobKind } from '@prisma/client';

/**
 * BullMQ queue name for all POS sync work — menu pulls, stop-list pulls,
 * outgoing order pushes. The {@link PosSyncJobKind} carried in the job
 * payload chooses the actual handler.
 *
 * Single queue keeps the priority math simple: an order push (M3) goes in
 * with `priority: 1`, menu imports default to `priority: 10`. BullMQ
 * lower-number = higher priority.
 */
export const POS_SYNC_QUEUE = 'pos-sync';

export interface PosSyncJobPayload {
  /** PosSyncJob row id — the worker reads/updates this row as it progresses. */
  syncJobId: string;
  integrationId: string;
  kind: PosSyncJobKind;
  /** Optional kind-specific payload. ORDER_PUSH carries `{ orderId }`. */
  args?: Record<string, unknown>;
}
