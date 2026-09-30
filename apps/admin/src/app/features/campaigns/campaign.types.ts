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
  sentAt: string | null;
  createdAt: string;
}

export const CAMPAIGN_CHANNELS: Array<CampaignRow['channel']> = ['PUSH', 'TELEGRAM', 'EMAIL'];
export const CAMPAIGN_AUDIENCES: Array<CampaignRow['audience']> = ['ALL', 'HAS_ORDERED', 'INACTIVE_30D'];
