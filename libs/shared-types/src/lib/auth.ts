/**
 * Auth transport types shared between apps/api, web, tma, admin.
 */

/**
 * `POST /auth/password/login`. `identifier` is an email or a staff login —
 * one with an '@' is an email. Older clients send `email` instead; the API
 * still takes it.
 */
export interface PasswordLoginRequest {
  identifier: string;
  password: string;
}

export interface PasswordForgotRequest {
  email: string;
}

export interface PasswordResetRequest {
  token: string;
  newPassword: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
  refreshTokenExpiresInSeconds: number;
}

export interface AuthSession extends AuthTokens {
  user: AuthUser;
  /**
   * `true` when the user was invited with a temporary password and must
   * rotate it before using the app. Clients should redirect to a
   * change-password screen before the normal landing page.
   */
  mustChangePassword?: boolean;
  /**
   * Kitchen PIN session: the store the board opens on — the one the tablet
   * asked for, or the person's only (first) store. Sessions saved by builds
   * before 2026-10-20 carry only this.
   */
  kdsStoreId?: string;
  /**
   * Set when the session was opened with a kitchen PIN: the brand of the
   * tablet. The API lets such a session reach only the kitchen board and
   * stop-list of the person's stores in this brand (and the Telegram link);
   * the admin shows nothing else.
   */
  kdsBrandId?: string;
  /**
   * Kitchen PIN session: the person's stores in the tablet's brand. With
   * more than one the tablet asks which to open, and the board switches
   * between them without the PIN again.
   */
  kdsStores?: KitchenSessionStore[];
}

/** One of the stores a kitchen PIN session works. */
export interface KitchenSessionStore {
  id: string;
  name: string;
  city: string;
}

/**
 * `POST /auth/kds/pin` — the PIN first, the store after. `storeId` is sent
 * only to settle an old store-scoped PIN two people share (409
 * `KDS_PIN_STORE_REQUIRED`), or by tablets that still pick the store first.
 */
export interface KdsPinLoginRequest {
  pin: string;
  deviceToken?: string;
  storeId?: string;
}

export interface PasswordChangeSelfRequest {
  currentPassword: string;
  newPassword: string;
}

export type UserRole = 'CUSTOMER' | 'STAFF' | 'STORE_MANAGER' | 'BRAND_ADMIN' | 'SUPER_ADMIN' | 'RIDER';

export interface AuthUser {
  id: string;
  phone: string | null;
  email: string | null;
  /** Staff sign-in name of an account without an email; null (or absent, from an older API) otherwise. */
  login?: string | null;
  name: string | null;
  locale: 'EN' | 'RU';
  currency: 'USD' | 'EUR' | 'GBP' | 'AED' | 'THB' | 'IDR';
  role: UserRole;
  /**
   * The Telegram account a customer signs in with (Mini App, Telegram
   * Login), as a string because the upstream BigInt overflows JSON. Staff
   * notifications do not use it: see {@link TelegramNotifyStatus}.
   */
  telegramUserId: string | null;
}

/**
 * `GET /auth/telegram/notify-link` — whether the signed-in employee, owner or
 * platform admin gets work notifications (new orders, alerts) from the bot.
 */
export interface TelegramNotifyStatus {
  /** Work notifications go to a Telegram chat. */
  linked: boolean;
  /**
   * The bot can link a chat on this server: it has a username and receives
   * messages (its webhook is configured). False — the cabinet offers the
   * older Telegram sign-in button instead, where there is one.
   */
  botLinkAvailable: boolean;
}

/**
 * `POST /auth/telegram/notify-link` — a one-time link to the bot. Opened on
 * the person's phone (as a QR code or the link itself), it starts the bot
 * with `/start link_<code>`, and the bot writes to that chat from then on.
 */
export interface TelegramNotifyLinkCode {
  /** `https://t.me/<bot>?start=link_<code>`. */
  url: string;
  /** When the code stops working (ISO, UTC); about ten minutes. */
  expiresAt: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface JwtAccessPayload {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}

/** Which of Telegram, Google, Apple and email lead into the signed-in customer's profile. */
export interface SignInMethods {
  telegram: boolean;
  google: boolean;
  apple: boolean;
  /**
   * The proven address a sign-in code by email leads into this profile;
   * null when there is none. An address only typed into the profile does
   * not count.
   */
  email: string | null;
}

/** `GET /auth/methods`: which customer sign-in methods the server can complete. */
export interface AuthMethods {
  /** Sign-in with a code sent by email; false until SMTP is configured on the server. */
  email: boolean;
  google: boolean;
  apple: boolean;
  telegram: boolean;
}

/**
 * Stable reasons `POST /auth/email/start` and `/auth/email/verify` refuse
 * with, in the body's `code`. Clients word them in the customer's language.
 */
export type EmailLoginErrorCode =
  | 'EMAIL_LOGIN_UNAVAILABLE'
  | 'EMAIL_CODE_NOT_SENT'
  | 'EMAIL_CODE_COOLDOWN'
  | 'EMAIL_CODE_LIMIT'
  | 'EMAIL_CODE_INVALID'
  | 'EMAIL_CODE_EXPIRED'
  | 'EMAIL_CODE_TOO_MANY_ATTEMPTS'
  | 'EMAIL_LOGIN_STAFF_ACCOUNT';

/**
 * Result of linking a sign-in method. `session` is present when the method
 * already led into a profile with orders and this one had none: the customer
 * was moved there, and the client must switch to the new session.
 */
export interface LinkSignInMethodResult {
  methods: SignInMethods;
  session?: AuthSession;
}
