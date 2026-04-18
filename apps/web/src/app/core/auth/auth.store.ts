import { Injectable, computed, signal } from '@angular/core';
import type { AuthSession, AuthTokens, AuthUser } from '@takeaway/shared-types';

const STORAGE_KEY = 'takeaway.web.session';

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
  refreshTokenExpiresInSeconds: number;
  user: AuthUser;
}

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly _session = signal<StoredSession | null>(this.hydrate());

  readonly session = this._session.asReadonly();
  readonly user = computed<AuthUser | null>(() => this._session()?.user ?? null);
  readonly isAuthenticated = computed(() => this._session() !== null);
  readonly accessToken = computed<string | null>(() => this._session()?.accessToken ?? null);

  set(session: AuthSession): void {
    const stored: StoredSession = {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      accessTokenExpiresInSeconds: session.accessTokenExpiresInSeconds,
      refreshTokenExpiresInSeconds: session.refreshTokenExpiresInSeconds,
      user: session.user,
    };
    this._session.set(stored);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }

  /**
   * Replace just the token pair (e.g. after a silent /auth/refresh) while
   * keeping the existing user. Returns false if there's no current session
   * to update — caller should treat that as "log out".
   */
  setTokens(tokens: AuthTokens): boolean {
    const current = this._session();
    if (!current) return false;
    const next: StoredSession = {
      ...current,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresInSeconds: tokens.accessTokenExpiresInSeconds,
      refreshTokenExpiresInSeconds: tokens.refreshTokenExpiresInSeconds,
    };
    this._session.set(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  }

  /** Refresh-and-retry needs to read the current refresh token without going through reactive sigs. */
  refreshToken(): string | null {
    return this._session()?.refreshToken ?? null;
  }

  clear(): void {
    this._session.set(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  private hydrate(): StoredSession | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredSession;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }
}
