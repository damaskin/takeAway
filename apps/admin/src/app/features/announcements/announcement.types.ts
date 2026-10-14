import type { PushTransport } from '@takeaway/shared-types';

/** DRAFT → (send) SENDING → SENT / FAILED, or DRAFT → SCHEDULED → SENDING …; cancelling a schedule returns it to DRAFT. */
export type AnnouncementStatus = 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'FAILED';

/** One platform announcement, as `/admin/announcements` returns it. */
export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  linkStoreId: string | null;
  linkBrandId: string | null;
  /** The linked store or brand by name; null when none (or it no longer exists). */
  link: { kind: 'STORE' | 'BRAND'; id: string; name: string; brandName: string | null } | null;
  status: AnnouncementStatus;
  /** Customers who allowed promotions when the run started — each got it in «Уведомления». */
  targetCount: number;
  /** Of them, the ones a push reached. */
  sentCount: number;
  failedCount: number;
  /** No app or web push, no Telegram: «Уведомления» only. */
  noChannelCount: number;
  lastError: string | null;
  via: Record<PushTransport, number>;
  errors: Array<{ error: string; count: number }>;
  /** A draft: edit, send or schedule. */
  editable: boolean;
  /** «Повторить»: a failed or stuck run, or one with failed pushes. */
  retryable: boolean;
  /** Scheduled: «Отменить отправку» returns it to a draft. */
  cancellable: boolean;
  deletable: boolean;
  scheduledAt: string | null;
  startedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string | null; email: string | null } | null;
}

/** `/admin/announcements/preview` — who an announcement reaches now. */
export interface AnnouncementPreview {
  customers: number;
  optedOut: number;
  recipients: number;
  pushReachable: number;
  noChannel: number;
  byChannel: { appPush: number; webPush: number; telegram: number };
  transports: { apns: boolean; fcm: boolean; webpush: boolean; telegram: boolean };
}

/** `/admin/announcements/test` — what happened to the copy sent to the admin. */
export interface AnnouncementTestResult {
  outcome: 'sent' | 'failed' | 'no_channel';
  via: PushTransport[];
  error?: string;
}

/** What a tap on the announcement opens. */
export type AnnouncementLinkKind = 'NONE' | 'STORE' | 'BRAND';

export const ANNOUNCEMENT_TRANSPORTS: readonly PushTransport[] = ['apns', 'fcm', 'webpush', 'telegram'];

/** How the status pill is coloured. */
export function announcementStatusTone(status: AnnouncementStatus): 'ok' | 'bad' | 'busy' | 'wait' | 'idle' {
  if (status === 'SENT') return 'ok';
  if (status === 'FAILED') return 'bad';
  if (status === 'SENDING') return 'busy';
  if (status === 'SCHEDULED') return 'wait';
  return 'idle';
}
