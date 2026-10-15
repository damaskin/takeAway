/**
 * «Уведомления» — the customer's inbox: brand campaigns sent as push and
 * announcements from the platform itself. Every recipient gets an item,
 * whether or not a device push reached them. Order news is not here; the
 * Orders screens show it.
 */

/** BRAND_CAMPAIGN — a brand's campaign; PLATFORM_ANNOUNCEMENT — from takeAway itself. */
export type InboxItemKind = 'BRAND_CAMPAIGN' | 'PLATFORM_ANNOUNCEMENT';

/** Who a message is from, as the list shows it. */
export interface InboxSender {
  /** BRAND — the brand's name and logo; PLATFORM — takeAway (the clients draw their own mark). */
  kind: 'BRAND' | 'PLATFORM';
  name: string;
  logoUrl: string | null;
  brandId: string | null;
}

/** Where tapping a message leads. */
export interface InboxLink {
  /** STORE — that store's menu; BRAND — the brand's. */
  kind: 'STORE' | 'BRAND';
  /**
   * The store whose menu opens. For a BRAND link: its store when the brand
   * has exactly one open to customers; null when it has several (or none
   * yet) — the clients show the list of places instead.
   */
  storeId: string | null;
  storeSlug: string | null;
  brandId: string | null;
  /** The store's or the brand's name, for the button. */
  name: string;
}

/** One message of `GET /inbox`. */
export interface InboxItem {
  id: string;
  kind: InboxItemKind;
  title: string;
  body: string;
  sender: InboxSender;
  link: InboxLink | null;
  createdAt: string;
  /** Null until the customer opened it. */
  readAt: string | null;
}

/** `GET /inbox?cursor=&limit=` — newest first. */
export interface InboxPage {
  items: InboxItem[];
  /** Pass as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
  unreadCount: number;
}

/** `GET /inbox/unread-count` — the badge on the bell and on the profile. */
export interface InboxUnreadCount {
  count: number;
}

/**
 * The push `kind`s that stand for an inbox item: the push data carries
 * `notificationId` (and `storeId` / `brandId` when the message links one),
 * and a tap opens «Уведомления» on it. Order pushes keep opening the order.
 */
export type InboxPushKind = 'campaign' | 'announcement';

export const INBOX_PUSH_KINDS: readonly InboxPushKind[] = ['campaign', 'announcement'];

/** Default and largest page of `GET /inbox`. */
export const INBOX_PAGE_SIZE = 20;
export const INBOX_PAGE_MAX = 50;
