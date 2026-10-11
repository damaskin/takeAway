import type { CampaignTransport } from '@takeaway/shared-types';

/**
 * DRAFT → PENDING_REVIEW (submitted) → APPROVED (waits for its time, if
 * any) → SENDING → SENT / FAILED; or PENDING_REVIEW → REJECTED, edited and
 * submitted again.
 */
export type CampaignStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SENDING' | 'SENT' | 'FAILED';

/** One marketing campaign, as `/admin/campaigns` returns it. */
export interface CampaignRow {
  id: string;
  brandId: string;
  title: string;
  body: string;
  channel: 'PUSH' | 'TELEGRAM' | 'EMAIL';
  audience: 'ALL' | 'HAS_ORDERED' | 'INACTIVE_30D';
  status: CampaignStatus;
  targetCount: number;
  sentCount: number;
  failedCount: number;
  /** People with no push token, Telegram chat or email to deliver to. */
  noChannelCount: number;
  /** People who turned promotions off. */
  optedOutCount: number;
  /** Last delivery error or why the run failed — diagnostic text from the server. */
  lastError: string | null;
  /** People each transport reached; someone reached on two transports counts in both. */
  via: Record<CampaignTransport, number>;
  /**
   * Most common delivery errors, most frequent first (up to three) — also
   * app pushes that failed before a Telegram fallback landed.
   */
  errors: Array<{ error: string; count: number }>;
  /** Retry may be pressed: an approved campaign with a failed or stuck run, or with failures. */
  sendable: boolean;
  /** A draft or a rejected campaign: it can be edited and submitted. */
  editable: boolean;
  /** Nothing has gone out yet, so it can be deleted. */
  deletable: boolean;
  /** Send no earlier than this; null — as soon as it is approved. */
  scheduledAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  /** Why the moderator rejected it. */
  reviewNote: string | null;
  approvedAt: string | null;
  startedAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

/** A campaign in the platform admin's moderation queue or history. */
export interface ModerationCampaign extends CampaignRow {
  brand: { id: string; name: string; slug: string; logoUrl: string | null };
  createdBy: { id: string; name: string | null; email: string | null } | null;
  reviewedBy: { id: string; name: string | null; email: string | null } | null;
  /** Who it reaches right now — for campaigns waiting for review only. */
  reach: CampaignPreview | null;
}

/** `/admin/campaigns/preview` — who a campaign would reach, before it is sent. */
export interface CampaignPreview {
  total: number;
  reachable: number;
  optedOut: number;
  noChannel: number;
  byChannel: { appPush: number; webPush: number; telegram: number; email: number };
  transports: { apns: boolean; fcm: boolean; webpush: boolean; telegram: boolean; email: boolean };
}

/** `/admin/campaigns/test` — what happened to the copy sent to the admin. */
export interface CampaignTestResult {
  outcome: 'sent' | 'failed' | 'no_channel';
  via: CampaignTransport[];
  /** What failed — also on a test that was sent (the app push before the Telegram fallback). */
  error?: string;
}

export const CAMPAIGN_CHANNELS: Array<CampaignRow['channel']> = ['PUSH', 'TELEGRAM', 'EMAIL'];
export const CAMPAIGN_AUDIENCES: Array<CampaignRow['audience']> = ['ALL', 'HAS_ORDERED', 'INACTIVE_30D'];

/** How the status pill is coloured. */
export function campaignStatusTone(status: CampaignStatus): 'ok' | 'bad' | 'busy' | 'wait' | 'idle' {
  if (status === 'SENT') return 'ok';
  if (status === 'FAILED' || status === 'REJECTED') return 'bad';
  if (status === 'SENDING') return 'busy';
  if (status === 'PENDING_REVIEW' || status === 'APPROVED') return 'wait';
  return 'idle';
}
