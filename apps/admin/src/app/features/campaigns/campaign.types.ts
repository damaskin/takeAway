import type { CampaignTransport } from '@takeaway/shared-types';

/** One marketing campaign, as `/admin/campaigns` returns it. */
export interface CampaignRow {
  id: string;
  brandId: string;
  title: string;
  body: string;
  channel: 'PUSH' | 'TELEGRAM' | 'EMAIL';
  audience: 'ALL' | 'HAS_ORDERED' | 'INACTIVE_30D';
  status: 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'FAILED';
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
  /** Send may be pressed again: a draft, a failed or stuck run, or a run with failures. */
  sendable: boolean;
  startedAt: string | null;
  sentAt: string | null;
  createdAt: string;
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
