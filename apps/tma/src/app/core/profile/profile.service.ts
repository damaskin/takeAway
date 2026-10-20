import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AuthUser, LoyaltyAccount } from '@takeaway/shared-types';
import { type Observable, tap } from 'rxjs';

import { API_CONFIG } from '../api/api.config';
import { TmaAuthStore } from '../auth/tma-auth.store';

/** What the customer may change about themselves (`PATCH /auth/me`). */
export interface ProfilePatch {
  name?: string;
  email?: string;
  /** E.164, e.g. +37369123456. */
  phone?: string;
  /** YYYY-MM-DD. */
  dateOfBirth?: string;
  /** The language of the bot's messages. */
  locale?: 'EN' | 'RU';
}

/** `GET/PATCH /auth/me/notifications`: what the bot writes to the customer about. */
export interface NotificationPrefs {
  notifyOrderUpdates: boolean;
  notifyPromotions: boolean;
}

/** A gift card the customer applied to one of their orders (`GET /me/gift-cards`). */
export interface GiftRedemption {
  orderId: string;
  orderCode: string;
  code: string;
  amountCents: number;
  currency: string;
  brandName: string;
  createdAt: string;
}

/** The customer's own profile screens: personal data, notifications, gift cards, points. */
@Injectable({ providedIn: 'root' })
export class ProfileApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly store = inject(TmaAuthStore);

  /** Saves the change and keeps the session's copy of the customer in step. */
  updateMe(patch: ProfilePatch): Observable<AuthUser> {
    return this.http
      .patch<AuthUser>(`${this.api.baseUrl}/auth/me`, patch)
      .pipe(tap((user) => this.store.setUser(user)));
  }

  notifications(): Observable<NotificationPrefs> {
    return this.http.get<NotificationPrefs>(`${this.api.baseUrl}/auth/me/notifications`);
  }

  updateNotifications(patch: Partial<NotificationPrefs>): Observable<NotificationPrefs> {
    return this.http.patch<NotificationPrefs>(`${this.api.baseUrl}/auth/me/notifications`, patch);
  }

  giftCards(): Observable<GiftRedemption[]> {
    return this.http.get<GiftRedemption[]>(`${this.api.baseUrl}/me/gift-cards`);
  }

  /** Points, level and how far the next one is — the same account the website shows. */
  loyalty(): Observable<LoyaltyAccount> {
    return this.http.get<LoyaltyAccount>(`${this.api.baseUrl}/loyalty/me`);
  }
}
