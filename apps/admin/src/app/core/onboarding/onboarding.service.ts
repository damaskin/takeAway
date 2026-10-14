import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/** GET /my-brand/onboarding — what a new brand still has to do before its first order. */
export interface BrandOnboarding {
  brandId: string;
  moderationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  moderationNote: string | null;
  /** Recommended, not required: a logo is uploaded. */
  brandProfile: boolean;
  /** A store with an address and opening hours exists. */
  store: boolean;
  /** A product customers can see exists (with a photo or not). */
  menu: boolean;
  /** Recommended, not required: a product has a photo. Missing from older APIs. */
  photos?: boolean;
  /** Card payments are on for the platform; otherwise customers pay on pickup. */
  cardPayments: boolean;
  /** The brand has an order that was not cancelled or expired. Missing from older APIs. */
  hasOrders?: boolean;
  /** Launched: the steps are done and the brand is approved — or it has sold already. */
  complete: boolean;
}

/**
 * The owner's path from sign-up to the storefront. Both calls name the
 * brand explicitly — the one in the header — because an owner may have
 * more than one.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  checklist(brandId: string): Observable<BrandOnboarding> {
    return this.http.get<BrandOnboarding>(`${this.api.baseUrl}/my-brand/onboarding`, {
      params: new HttpParams().set('brandId', brandId),
    });
  }

  /** REJECTED → PENDING. The platform team is told on the server side. */
  resubmit(brandId: string): Observable<unknown> {
    return this.http.post(`${this.api.baseUrl}/my-brand/resubmit`, null, {
      params: new HttpParams().set('brandId', brandId),
    });
  }
}
