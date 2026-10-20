import { Injectable, computed, signal } from '@angular/core';
import type { AuthSession, AuthTokens, AuthUser } from '@takeaway/shared-types';

const STORAGE_KEY = 'takeaway.admin.session';

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
  refreshTokenExpiresInSeconds: number;
  user: AuthUser;
  mustChangePassword?: boolean;
  /** Kitchen PIN session: the store the board opened on. Alone on sessions saved before brand-wide PINs. */
  kdsStoreId?: string;
  /** Set for a kitchen PIN session: the brand of the tablet. */
  kdsBrandId?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly _session = signal<StoredSession | null>(this.hydrate());

  readonly session = this._session.asReadonly();
  readonly user = computed<AuthUser | null>(() => this._session()?.user ?? null);
  readonly isAuthenticated = computed(() => this._session() !== null);
  readonly accessToken = computed<string | null>(() => this._session()?.accessToken ?? null);
  readonly mustChangePassword = computed<boolean>(() => !!this._session()?.mustChangePassword);
  /**
   * The store a kitchen PIN session opened on, null for an email + password
   * one. The board may switch to the person's other stores of the brand.
   */
  readonly kdsStoreId = computed<string | null>(() => this._session()?.kdsStoreId ?? null);
  /**
   * Signed in with a kitchen PIN: the API lets such a session reach only
   * the kitchen board, the stop-list and the Telegram link of the person's
   * stores in the tablet's brand, so the cabinet shows nothing else.
   * Sessions saved before brand-wide PINs carry only the store.
   */
  readonly kitchenSession = computed<boolean>(() => {
    const session = this._session();
    return !!(session?.kdsBrandId || session?.kdsStoreId);
  });

  set(session: AuthSession): void {
    const stored: StoredSession = {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      accessTokenExpiresInSeconds: session.accessTokenExpiresInSeconds,
      refreshTokenExpiresInSeconds: session.refreshTokenExpiresInSeconds,
      user: session.user,
      mustChangePassword: session.mustChangePassword,
      kdsStoreId: session.kdsStoreId,
      kdsBrandId: session.kdsBrandId,
    };
    this._session.set(stored);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }

  clearMustChangePassword(): void {
    const current = this._session();
    if (!current) return;
    const next = { ...current, mustChangePassword: false };
    this._session.set(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  /** See web/auth.store.ts for context — silent-refresh token swap. */
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
