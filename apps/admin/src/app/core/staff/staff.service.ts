import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AddStaffSignInRequest,
  InviteStaffRequest,
  KitchenDeviceSummary,
  KitchenPairingCode,
  SetStaffPinRequest,
  SetStaffStoresRequest,
  StaffInviteResult,
  StaffMember,
  StaffPasswordReset,
  StaffRoleName,
} from '@takeaway/shared-types';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export type { InviteStaffRequest, StaffInviteResult, StaffMember, StaffPasswordReset } from '@takeaway/shared-types';

export type StaffRole = StaffRoleName;

export interface StaffRoster {
  userId: string;
  email: string | null;
  /** Sign-in name of someone without an email. */
  login: string | null;
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

  /**
   * «Сбросить пароль»: the person's sessions end and they get a generated
   * temporary password — in the answer, once. Owners and platform admins only.
   */
  resetPassword(userId: string, brandId: string | null): Observable<StaffPasswordReset> {
    return this.http.post<StaffPasswordReset>(
      `${this.api.baseUrl}/admin/staff/${userId}/reset-password`,
      {},
      { params: this.brandParams(brandId) },
    );
  }

  /**
   * The person's kitchen PIN: one for every store they work at in the brand.
   * Replaces the PIN they had and ends their tablet sessions.
   */
  setMemberPin(userId: string, pin: string, brandId: string | null): Observable<StaffMember> {
    const body: SetStaffPinRequest = { pin };
    return this.http.put<StaffMember>(`${this.api.baseUrl}/admin/staff/${userId}/kds-pin`, body, {
      params: this.brandParams(brandId),
    });
  }

  clearMemberPin(userId: string, brandId: string | null): Observable<StaffMember> {
    return this.http.delete<StaffMember>(`${this.api.baseUrl}/admin/staff/${userId}/kds-pin`, {
      params: this.brandParams(brandId),
    });
  }

  /** A way into the cabinet for someone invited with a PIN only: an email or a login and a temporary password. */
  addSignIn(userId: string, body: AddStaffSignInRequest, brandId: string | null): Observable<StaffInviteResult> {
    return this.http.put<StaffInviteResult>(`${this.api.baseUrl}/admin/staff/${userId}/sign-in`, body, {
      params: this.brandParams(brandId),
    });
  }

  /** «Сбросить пароль» of the brand owner — the platform team only. */
  resetOwnerPassword(brandId: string): Observable<StaffPasswordReset> {
    return this.http.post<StaffPasswordReset>(`${this.api.baseUrl}/admin/brands/${brandId}/owner/reset-password`, {});
  }

  private brandParams(brandId: string | null): Record<string, string> {
    return brandId ? { brandId } : {};
  }

  // ── One store's roster (store editor, kitchen PINs) ──

  list(storeId: string): Observable<StaffRoster[]> {
    return this.http.get<StaffRoster[]>(`${this.api.baseUrl}/admin/stores/${storeId}/staff`);
  }

  getOwner(brandId: string): Observable<BrandOwner | null> {
    return this.http.get<BrandOwner | null>(`${this.api.baseUrl}/admin/brands/${brandId}/owner`);
  }

  setOwner(brandId: string, body: SetOwnerRequest): Observable<BrandOwner> {
    return this.http.patch<BrandOwner>(`${this.api.baseUrl}/admin/brands/${brandId}/owner`, body);
  }
}
