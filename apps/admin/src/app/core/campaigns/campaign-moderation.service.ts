import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { Observable } from 'rxjs';

import type { ModerationCampaign } from '../../features/campaigns/campaign.types';
import { API_CONFIG } from '../api/api.config';

/** Which part of the moderation history the page lists. */
export type ModerationView = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

/**
 * The platform team's review of business campaigns (`/admin/campaign-moderation`).
 * Holds the number waiting for the sidebar badge.
 */
@Injectable({ providedIn: 'root' })
export class CampaignModerationApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  private readonly _pendingCount = signal<number | null>(null);
  /** Campaigns waiting for a decision — the badge on «Модерация рассылок». Null until known. */
  readonly pendingCount = this._pendingCount.asReadonly();

  list(view: ModerationView): Observable<ModerationCampaign[]> {
    return this.http.get<ModerationCampaign[]>(`${this.api.baseUrl}/admin/campaign-moderation`, {
      params: new HttpParams().set('view', view),
    });
  }

  /** SUPER_ADMIN only. A failure keeps the last known count. */
  loadPendingCount(): void {
    this.http.get<{ count: number }>(`${this.api.baseUrl}/admin/campaign-moderation/pending-count`).subscribe({
      next: (res) => {
        if (typeof res?.count === 'number') this._pendingCount.set(res.count);
      },
      error: () => undefined,
    });
  }

  /** For the page, which holds the queue and knows the number already. */
  setPendingCount(count: number): void {
    this._pendingCount.set(count);
  }

  approve(id: string): Observable<ModerationCampaign> {
    return this.http.post<ModerationCampaign>(`${this.api.baseUrl}/admin/campaign-moderation/${id}/approve`, {});
  }

  reject(id: string, reason: string): Observable<ModerationCampaign> {
    return this.http.post<ModerationCampaign>(`${this.api.baseUrl}/admin/campaign-moderation/${id}/reject`, {
      reason,
    });
  }
}
