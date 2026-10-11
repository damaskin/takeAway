import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type {
  AdminFeedback,
  AdminFeedbackPage,
  CreateSupportRequest,
  FeedbackKind,
  FeedbackReceipt,
  FeedbackSource,
  FeedbackStatus,
} from '@takeaway/shared-types';
import type { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export interface FeedbackQuery {
  /** Left out: everything that is not archived. */
  status?: FeedbackStatus;
  kind?: FeedbackKind;
  /** BUSINESS: only what businesses wrote from the admin. */
  source?: FeedbackSource;
  page?: number;
  pageSize?: number;
}

/**
 * `/admin/feedback` — what customers write from their profile and businesses
 * from the admin; the inbox is SUPER_ADMIN only. Also «Написать в поддержку»
 * (`/admin/support`), from a brand's staff.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  private readonly _newCount = signal<number | null>(null);
  /** Unread feedback — the badge on «Обратная связь». Null until known. */
  readonly newCount = this._newCount.asReadonly();

  list(query: FeedbackQuery = {}): Observable<AdminFeedbackPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<AdminFeedbackPage>(`${this.api.baseUrl}/admin/feedback`, { params });
  }

  setStatus(id: string, status: FeedbackStatus): Observable<AdminFeedback> {
    return this.http.patch<AdminFeedback>(`${this.api.baseUrl}/admin/feedback/${encodeURIComponent(id)}`, { status });
  }

  /** A failure keeps the last known count. */
  loadNewCount(): void {
    this.http.get<{ count: number }>(`${this.api.baseUrl}/admin/feedback/new-count`).subscribe({
      next: (res) => {
        if (typeof res?.count === 'number') this._newCount.set(res.count);
      },
      error: () => undefined,
    });
  }

  /** For the feedback page, which gets the number with every list. */
  setNewCount(count: number): void {
    this._newCount.set(count);
  }

  /** «Написать в поддержку» — about the brand picked in the header. */
  sendSupport(body: CreateSupportRequest, brandId: string | null): Observable<FeedbackReceipt> {
    const params = brandId ? new HttpParams().set('brandId', brandId) : new HttpParams();
    return this.http.post<FeedbackReceipt>(`${this.api.baseUrl}/admin/support`, body, { params });
  }
}
