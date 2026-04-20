/**
 * Auth transport types shared between apps/api, web, tma, admin, kds.
 */

export interface PasswordLoginRequest {
  email: string;
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
}

export type UserRole = 'CUSTOMER' | 'STAFF' | 'STORE_MANAGER' | 'BRAND_ADMIN' | 'SUPER_ADMIN' | 'RIDER';

export interface AuthUser {
  id: string;
  phone: string | null;
  email: string | null;
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
