import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CreateFeedbackRequest, FeedbackReceipt } from '@takeaway/shared-types';
import type { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/** «Обратная связь» — a signed-in customer's review, suggestion or problem report. */
@Injectable({ providedIn: 'root' })
export class FeedbackService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  /** 429 with `code: FEEDBACK_TOO_MANY` past five messages an hour. */
  send(body: CreateFeedbackRequest): Observable<FeedbackReceipt> {
    return this.http.post<FeedbackReceipt>(`${this.api.baseUrl}/feedback`, body);
  }
}
