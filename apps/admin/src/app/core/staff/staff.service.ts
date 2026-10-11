import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  InviteStaffRequest,
  KitchenDeviceSummary,
  KitchenPairingCode,
  SetStaffStoresRequest,
  StaffInviteResult,
  StaffMember,
  StaffRoleName,
} from '@takeaway/shared-types';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export type { InviteStaffRequest, StaffInviteResult, StaffMember } from '@takeaway/shared-types';

export type StaffRole = StaffRoleName;

export interface StaffRoster {
  userId: string;
  email: string | null;
  name: string | null;
  role: StaffRole;
  blocked: boolean;
  addedAt: string;
  /** Has a kitchen-tablet PIN for this store. */
  hasKdsPin?: boolean;
}

export interface BrandOwner {
  id: string;
  email: string | null;
  name: string | null;
}

export interface SetOwnerRequest {
  email: string;
  name?: string;
  tempPassword?: string;
}

@Injectable({ providedIn: 'root' })
export class StaffService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  // ── People: one row per person, the stores they work at on the person ──

  /** Everyone working at the brand's stores the caller manages. */
  listMembers(brandId: string | null): Observable<StaffMember[]> {
    return this.http.get<StaffMember[]>(`${this.api.baseUrl}/admin/staff`, { params: this.brandParams(brandId) });
  }

  getMember(userId: string, brandId: string | null): Observable<StaffMember> {
    return this.http.get<StaffMember>(`${this.api.baseUrl}/admin/staff/${userId}`, {
      params: this.brandParams(brandId),
    });
  }

  /** Invites someone to one or more stores at once; the answer says whether the invite email went out. */
  invite(body: InviteStaffRequest, brandId: string | null): Observable<StaffInviteResult> {
    return this.http.post<StaffInviteResult>(`${this.api.baseUrl}/admin/staff`, body, {
      params: this.brandParams(brandId),
    });
  }

  // ── The brand's kitchen tablets ──

  kitchenDevices(brandId: string): Observable<KitchenDeviceSummary[]> {
    return this.http.get<KitchenDeviceSummary[]>(`${this.api.baseUrl}/admin/kitchen-devices`, { params: { brandId } });
  }

  /** A one-time code for a tablet link, `/login/pin?pair=<code>`; it works once, for 24 hours. */
  kitchenPairingCode(brandId: string): Observable<KitchenPairingCode> {
    return this.http.post<KitchenPairingCode>(
      `${this.api.baseUrl}/admin/kitchen-devices/pairing-code`,
      {},
      {
        params: { brandId },
      },
    );
  }

  unbindKitchenDevice(brandId: string, deviceId: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/kitchen-devices/${deviceId}`, { params: { brandId } });
  }

  /**
   * The stores the person works at, among the caller's. An empty list takes
   * the person off the team.
   */
  setStores(userId: string, storeIds: string[], brandId: string | null): Observable<StaffMember> {
    const body: SetStaffStoresRequest = { storeIds };
    return this.http.put<StaffMember>(`${this.api.baseUrl}/admin/staff/${userId}/stores`, body, {
      params: this.brandParams(brandId),
    });
  }

  setRole(userId: string, role: StaffRole, brandId: string | null): Observable<StaffMember> {
    return this.http.patch<StaffMember>(
      `${this.api.baseUrl}/admin/staff/${userId}/role`,
      { role },
      { params: this.brandParams(brandId) },
    );
  }

  private brandParams(brandId: string | null): Record<string, string> {
    return brandId ? { brandId } : {};
  }

  // ── One store's roster (store editor, kitchen PINs) ──

  list(storeId: string): Observable<StaffRoster[]> {
    return this.http.get<StaffRoster[]>(`${this.api.baseUrl}/admin/stores/${storeId}/staff`);
  }

  /** Sets or rotates the 6-digit PIN a staff member unlocks this store's kitchen tablet with. */
  setKdsPin(storeId: string, userId: string, pin: string): Observable<void> {
    return this.http.put<void>(`${this.api.baseUrl}/admin/stores/${storeId}/staff/${userId}/kds-pin`, { pin });
  }

  clearKdsPin(storeId: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/stores/${storeId}/staff/${userId}/kds-pin`);
  }

  getOwner(brandId: string): Observable<BrandOwner | null> {
    return this.http.get<BrandOwner | null>(`${this.api.baseUrl}/admin/brands/${brandId}/owner`);
  }

  setOwner(brandId: string, body: SetOwnerRequest): Observable<BrandOwner> {
    return this.http.patch<BrandOwner>(`${this.api.baseUrl}/admin/brands/${brandId}/owner`, body);
  }
}
