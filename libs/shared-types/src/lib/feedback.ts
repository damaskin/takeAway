/**
 * Customer feedback («Обратная связь»): a review, a suggestion or a problem
 * report sent from the profile in the app, on the site or in the Telegram
 * Mini App, and read by the platform team in the admin.
 */

export type FeedbackKind = 'REVIEW' | 'SUGGESTION' | 'PROBLEM';

export const FEEDBACK_KINDS: readonly FeedbackKind[] = ['REVIEW', 'SUGGESTION', 'PROBLEM'];

/** Where the customer wrote it from. */
export type FeedbackSource = 'IOS' | 'ANDROID' | 'WEB' | 'TMA';

export const FEEDBACK_SOURCES: readonly FeedbackSource[] = ['IOS', 'ANDROID', 'WEB', 'TMA'];

/** NEW until a platform admin opens it; ARCHIVED once dealt with. */
export type FeedbackStatus = 'NEW' | 'READ' | 'ARCHIVED';

export const FEEDBACK_STATUSES: readonly FeedbackStatus[] = ['NEW', 'READ', 'ARCHIVED'];

/** Longest message the API accepts, after trimming. */
export const FEEDBACK_MESSAGE_MAX_LENGTH = 2000;
/** Longest "how to reach me" the API accepts, after trimming. */
export const FEEDBACK_CONTACT_MAX_LENGTH = 200;

/** `POST /feedback` — signed-in customers only. */
export interface CreateFeedbackRequest {
  kind: FeedbackKind;
  /** 1…{@link FEEDBACK_MESSAGE_MAX_LENGTH} characters once trimmed. */
  message: string;
  /** How to reach the customer, when it is not the account's own contacts. */
  contact?: string;
  source: FeedbackSource;
  /** The app build, e.g. `1.2.0 (3)`; the web clients leave it out. */
  appVersion?: string;
}

/** What `POST /feedback` answers with. */
export interface FeedbackReceipt {
  id: string;
  createdAt: string;
}

/** The person behind a feedback, as the platform admin sees them. */
export interface FeedbackAuthor {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Telegram user id, as a string — it does not fit a JS number safely. */
  telegramUserId: string | null;
  /** The account was deleted; its contacts are gone. */
  deleted: boolean;
}

export interface AdminFeedback {
  id: string;
  kind: FeedbackKind;
  message: string;
  contact: string | null;
  source: FeedbackSource;
  appVersion: string | null;
  status: FeedbackStatus;
  createdAt: string;
  /** When it was first marked read; null while NEW. */
  readAt: string | null;
  /** Null when the account row is gone. */
  author: FeedbackAuthor | null;
}

/** `GET /admin/feedback` — newest first. */
export interface AdminFeedbackPage {
  items: AdminFeedback[];
  total: number;
  page: number;
  pageSize: number;
  /** Feedback nobody has read yet, whatever the filter — the sidebar badge. */
  newCount: number;
}

/** `PATCH /admin/feedback/:id` */
export interface UpdateFeedbackStatusRequest {
  status: FeedbackStatus;
}
