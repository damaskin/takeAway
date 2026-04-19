import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export type StaffRole = 'STORE_MANAGER' | 'STAFF';

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

  remove(storeId: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/stores/${storeId}/staff/${userId}`);
  }
}
