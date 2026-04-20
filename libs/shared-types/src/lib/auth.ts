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
  /**
   * `true` when the user was invited with a temporary password and must
   * rotate it before using the app. Clients should redirect to a
   * change-password screen before the normal landing page.
   */
  mustChangePassword?: boolean;
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
  name: string | null;
  locale: 'EN' | 'RU';
  currency: 'USD' | 'EUR' | 'GBP' | 'AED' | 'THB' | 'IDR';
  role: UserRole;
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
