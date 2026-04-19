import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export interface RiderRosterEntryDto {
  userId: string;
  phone: string | null;
  name: string | null;
  blocked: boolean;
  addedAt: string;
}

export interface AddRiderInput {
  phone: string;
  name?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminRidersApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  list(storeId: string): Observable<RiderRosterEntryDto[]> {
    return this.http.get<RiderRosterEntryDto[]>(`${this.api.baseUrl}/admin/stores/${storeId}/riders`);
  }

  add(storeId: string, input: AddRiderInput): Observable<RiderRosterEntryDto> {
    return this.http.post<RiderRosterEntryDto>(`${this.api.baseUrl}/admin/stores/${storeId}/riders`, input);
  }

  remove(storeId: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/stores/${storeId}/riders/${userId}`);
  }
}
