import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export type StaffRole = 'STORE_MANAGER' | 'STAFF' | 'MENU_EDITOR';

export interface StaffRoster {
  userId: string;
  email: string | null;
  name: string | null;
  role: StaffRole;
  blocked: boolean;
  addedAt: string;
}

export interface AddStaffRequest {
  email: string;
  role: StaffRole;
  name?: string;
  tempPassword: string;
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

  list(storeId: string): Observable<StaffRoster[]> {
    return this.http.get<StaffRoster[]>(`${this.api.baseUrl}/admin/stores/${storeId}/staff`);
  }

  add(storeId: string, body: AddStaffRequest): Observable<StaffRoster> {
    return this.http.post<StaffRoster>(`${this.api.baseUrl}/admin/stores/${storeId}/staff`, body);
  }

  changeRole(storeId: string, userId: string, role: StaffRole): Observable<StaffRoster> {
    return this.http.patch<StaffRoster>(`${this.api.baseUrl}/admin/stores/${storeId}/staff/${userId}/role`, { role });
  }

  remove(storeId: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/stores/${storeId}/staff/${userId}`);
  }

  getOwner(brandId: string): Observable<BrandOwner | null> {
    return this.http.get<BrandOwner | null>(`${this.api.baseUrl}/admin/brands/${brandId}/owner`);
  }

  setOwner(brandId: string, body: SetOwnerRequest): Observable<BrandOwner> {
    return this.http.patch<BrandOwner>(`${this.api.baseUrl}/admin/brands/${brandId}/owner`, body);
  }
}
