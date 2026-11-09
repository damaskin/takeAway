/**
 * «Как вам заказ?» — the customer's review of an order once it was handed
 * over: 1–5 stars and an optional comment, one per order, never edited.
 * Only the platform team reads reviews (SUPER_ADMIN, «Отзывы» in the admin);
 * the brand does not see them.
 */

/** The stars a review may give, lowest first. */
export const ORDER_REVIEW_RATINGS = [1, 2, 3, 4, 5] as const;

export type OrderReviewRating = (typeof ORDER_REVIEW_RATINGS)[number];

/** Longest comment the API accepts, after trimming. */
export const ORDER_REVIEW_COMMENT_MAX_LENGTH = 1000;

/** Order statuses that mean the customer has the order: only these can be reviewed. */
export const ORDER_REVIEWABLE_STATUSES = ['PICKED_UP', 'DELIVERED'] as const;

/** 409 codes of `POST /orders/:id/review`. */
export const OrderReviewError = {
  /** The order was not handed over (yet): in work, cancelled or expired. */
  NOT_REVIEWABLE: 'ORDER_NOT_REVIEWABLE',
  /** The customer already reviewed this order; a review is not edited. */
  ALREADY_REVIEWED: 'ORDER_ALREADY_REVIEWED',
} as const;

/** The review as the customer's order shows it back. */
export interface OrderReview {
  rating: number;
  /** Null when the customer wrote nothing. */
  comment: string | null;
  createdAt: string;
}

/** `POST /orders/:id/review` — answers with the whole order, `review` set. */
export interface CreateOrderReviewRequest {
  /** One of {@link ORDER_REVIEW_RATINGS}. */
  rating: number;
  /** Up to {@link ORDER_REVIEW_COMMENT_MAX_LENGTH} characters once trimmed; blank is the same as left out. */
  comment?: string;
}

/** The customer behind a review, as the platform admin sees them. */
export interface OrderReviewCustomer {
  id: string;
  /** The account's name, else the name given at checkout; null after account deletion. */
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Telegram user id, as a string — it does not fit a JS number safely. */
  telegramUserId: string | null;
  /** The account was deleted: its contacts are gone, the review stays. */
  deleted: boolean;
}

/** One review in `GET /admin/order-reviews`. */
export interface AdminOrderReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  orderId: string;
  orderCode: string;
  brand: { id: string; name: string };
  store: { id: string; name: string };
  customer: OrderReviewCustomer;
}

/**
 * `GET /admin/order-reviews` — newest first. The summary (`count`,
 * `averageRating`, `ratingCounts`) covers the brand and period filters but
 * not the rating filter, so the stars beside each count stay meaningful
 * while one of them is picked.
 */
export interface AdminOrderReviewPage {
  items: AdminOrderReview[];
  /** Reviews matching every filter, rating included — what the pages count. */
  total: number;
  page: number;
  pageSize: number;
  /** Reviews in the brand and period, whatever the rating filter. */
  count: number;
  /** Their average, to one decimal; null when there are none. */
  averageRating: number | null;
  /** How many gave each rating, keys 1 to 5. */
  ratingCounts: Record<'1' | '2' | '3' | '4' | '5', number>;
}

/** Query of `GET /admin/order-reviews`. */
export interface AdminOrderReviewQuery {
  brandId?: string;
  rating?: number;
  /** ISO instant, inclusive. */
  from?: string;
  /** ISO instant, exclusive. */
  to?: string;
  page?: number;
  pageSize?: number;
}
