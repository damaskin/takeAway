/**
 * Auth transport types shared between apps/api, web, tma, admin, kds.
 */

export interface SendOtpRequest {
  phone: string;
}

export interface SendOtpResponse {
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

export interface VerifyOtpRequest {
  phone: string;
  code: string;
  deviceType?: 'IOS' | 'ANDROID' | 'WEB' | 'TELEGRAM';
  pushToken?: string;
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

export interface AuthUser {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  locale: 'EN' | 'RU';
  currency: 'USD' | 'EUR' | 'GBP' | 'AED' | 'THB' | 'IDR';
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
