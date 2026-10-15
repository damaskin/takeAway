import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { InboxItem, InboxLink, InboxPage, InboxUnreadCount } from '@takeaway/shared-types';
import { type Observable, tap } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/**
 * «Уведомления» — brand campaigns and takeAway announcements of the
 * signed-in customer. Holds the unread count the header and the profile
 * show as a badge.
 */
@Injectable({ providedIn: 'root' })
export class InboxService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  private readonly _unread = signal(0);
  readonly unreadCount = this._unread.asReadonly();

  list(cursor?: string): Observable<InboxPage> {
    return this.http
      .get<InboxPage>(`${this.api.baseUrl}/inbox`, { params: cursor ? { cursor } : {} })
      .pipe(tap((page) => this._unread.set(page.unreadCount)));
  }

  get(id: string): Observable<InboxItem> {
    return this.http.get<InboxItem>(`${this.api.baseUrl}/inbox/${encodeURIComponent(id)}`);
  }

  /** Signed in only. A failure keeps the last known count. */
  refreshUnread(): void {
    this.http.get<InboxUnreadCount>(`${this.api.baseUrl}/inbox/unread-count`).subscribe({
      next: (res) => {
        if (typeof res?.count === 'number') this._unread.set(res.count);
      },
      error: () => undefined,
    });
  }

  /** Signed out: no badge. */
  reset(): void {
    this._unread.set(0);
  }

  markRead(item: InboxItem): Observable<void> {
    if (!item.readAt) this._unread.update((n) => Math.max(0, n - 1));
    return this.http.post<void>(`${this.api.baseUrl}/inbox/${encodeURIComponent(item.id)}/read`, {});
  }

  markAllRead(): Observable<void> {
    this._unread.set(0);
    return this.http.post<void>(`${this.api.baseUrl}/inbox/read-all`, {});
  }
}

/**
 * Where a message's link leads on the site: a store's page is its menu; a
 * brand with several stores (no single `storeSlug`) opens the list of places.
 */
export function inboxLinkRoute(link: InboxLink): string {
  const store = link.storeSlug ?? link.storeId;
  return store ? `/stores/${store}` : '/stores';
}
