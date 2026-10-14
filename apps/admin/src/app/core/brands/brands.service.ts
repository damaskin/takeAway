import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import type { BrandPlan } from '@takeaway/shared-types';

import { API_CONFIG } from '../api/api.config';

export type BrandModerationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AdminBrand {
  id: string;
  slug: string;
  name: string;
  moderationStatus: BrandModerationStatus;
  moderationNote: string | null;
  submittedAt: string;
  moderatedAt: string | null;
  createdAt: string;
  plan: BrandPlan;
  /** Platform commission in basis points (1000 = 10 %). */
  commissionBps: number;
  /** The number to call the business on, E.164; null on brands from before it was asked for. */
  contactPhone: string | null;
  /** The plan the owner asked for with «Перейти на PRO»; null when nothing is asked. */
  requestedPlan: BrandPlan | null;
  planRequestedAt: string | null;
  /** Where the brand stands on «Запуск бренда». Returned by the list; absent after a single-brand update. */
  onboarding?: BrandOnboardingProgress | null;
  owner: { id: string; email: string | null; name: string | null; phone: string | null } | null;
  _count: { stores: number; products: number };
}

/** The launch checklist of one brand, as the platform admin sees it. */
export interface BrandOnboardingProgress {
  brandProfile: boolean;
  store: boolean;
  menu: boolean;
  approved: boolean;
  /** Steps done of `total` (5); payments always count. */
  done: number;
  total: number;
  /** Launched: every step done and the brand approved. */
  complete: boolean;
}

export interface SetBrandModerationRequest {
  status: BrandModerationStatus;
  /** Required by the API when rejecting: it is the reason the owner is emailed. */
  note?: string;
}

export interface SetBrandPlanRequest {
  plan: BrandPlan;
  /** Basis points; left out, the plan's default applies. */
  commissionBps?: number;
}

export interface CreateBrandRequest {
  slug: string;
  name: string;
  currency?: string;
  locale?: 'EN' | 'RU';
  /** Any common format; the API stores E.164. */
  contactPhone?: string;
}

@Injectable({ providedIn: 'root' })
export class BrandsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  private readonly _pendingCount = signal<number | null>(null);
  /** Brands waiting for review — on the badge of «Бренды». Null until known. */
  readonly pendingCount = this._pendingCount.asReadonly();

  private readonly _planRequests = signal<number | null>(null);
  /** Owners waiting for an answer about their plan — on the same badge. Null until known. */
  readonly planRequests = this._planRequests.asReadonly();

  list(status?: BrandModerationStatus): Observable<AdminBrand[]> {
    const url = status ? `${this.api.baseUrl}/admin/brands?status=${status}` : `${this.api.baseUrl}/admin/brands`;
    return this.http.get<AdminBrand[]>(url);
  }

  /** SUPER_ADMIN only. A failure keeps the last known counts. */
  loadPendingCount(): void {
    this.http
      .get<{ count: number; planRequests?: number }>(`${this.api.baseUrl}/admin/brands/pending-count`)
      .subscribe({
        next: (res) => {
          if (typeof res?.count === 'number') this._pendingCount.set(res.count);
          if (typeof res?.planRequests === 'number') this._planRequests.set(res.planRequests);
        },
        error: () => undefined,
      });
  }

  /** For the brands page, which holds the whole list and knows the numbers already. */
  setPendingCount(count: number, planRequests?: number): void {
    this._pendingCount.set(count);
    if (planRequests !== undefined) this._planRequests.set(planRequests);
  }

  /** SUPER_ADMIN only: closes the owner's «Перейти на PRO» request without changing the plan. */
  dismissPlanRequest(id: string): Observable<AdminBrand> {
    return this.http.delete<AdminBrand>(`${this.api.baseUrl}/admin/brands/${id}/plan-request`);
  }

  setModeration(id: string, body: SetBrandModerationRequest): Observable<AdminBrand> {
    return this.http.patch<AdminBrand>(`${this.api.baseUrl}/admin/brands/${id}/moderation`, body);
  }

  /** SUPER_ADMIN only: moves a brand to another plan or commission. */
  setPlan(id: string, body: SetBrandPlanRequest): Observable<AdminBrand> {
    return this.http.patch<AdminBrand>(`${this.api.baseUrl}/admin/brands/${id}/plan`, body);
  }

  /**
   * Creates a brand directly, without going through self-serve sign-up.
   * This is how a fresh install gets its first brand — without one, stores
   * and menu have no context to be created in.
   */
  create(body: CreateBrandRequest): Observable<AdminBrand & { currency: string; locale: 'EN' | 'RU' }> {
    return this.http.post<AdminBrand & { currency: string; locale: 'EN' | 'RU' }>(
      `${this.api.baseUrl}/admin/brands`,
      body,
    );
  }
}
