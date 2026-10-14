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
   * Set when the session was opened with a kitchen PIN: the one store it
   * works. The API lets such a session reach only that store's kitchen
   * board and stop-list; the admin shows nothing else.
   */
  kdsStoreId?: string;
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
   * Telegram chat id the user's account is linked to. `null` means the
   * account has no Telegram bound — for staff it means they haven't
   * completed the /admin/telegram-link flow yet; for CUSTOMER it's
   * expected (customers sign in via Telegram and the id is set there).
   * Serialized as a string because the upstream BigInt overflows JSON.
   */
  telegramUserId: string | null;
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

/** Which of Telegram, Google and Apple lead into the signed-in customer's profile. */
export interface SignInMethods {
  telegram: boolean;
  google: boolean;
  apple: boolean;
}

/**
 * Result of linking a sign-in method. `session` is present when the method
 * already led into a profile with orders and this one had none: the customer
 * was moved there, and the client must switch to the new session.
 */
export interface LinkSignInMethodResult {
  methods: SignInMethods;
  session?: AuthSession;
}
