import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocalDatePipe } from '@takeaway/i18n';
import { CAMPAIGN_TRANSPORTS } from '@takeaway/shared-types';
import type { Observable } from 'rxjs';

import { API_CONFIG } from '../../core/api/api.config';
import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { CAMPAIGN_ERROR_WORDING } from './campaign-errors';
import { type CampaignRow, campaignStatusTone } from './campaign.types';

/** How often the list re-reads itself while a campaign is going out. */
const POLL_MS = 3000;

/**
 * Brand-admin marketing campaigns. Compose a title + body, pick a channel,
 * an audience and, if wanted, a time; save the draft, then submit it for
 * review. Nothing goes out until the takeAway team approves it — at once,
 * or at the time picked. A rejected campaign shows the moderator's reason
 * and can be edited and submitted again. A platform admin's own campaign
 * needs no review: their «Отправить» approves it.
 *
 * Sending runs in the background: the row flips to SENDING and the list
 * polls until it settles on SENT or FAILED, showing who got it and through
 * what, who could not be reached and the most common errors. A failed,
 * stuck or partly failed campaign can be retried — only the people it
 * missed get it.
 *
 * Works on the brand picked in the top bar (SUPER_ADMIN picks any).
 */
@Component({
  selector: 'app-admin-campaigns',
  standalone: true,
  imports: [RouterLink, TranslatePipe, LocalDatePipe],
  template: `
    <section style="padding: 24px; max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px">
      <header class="flex items-start justify-between flex-wrap" style="gap: 12px">
        <div style="display: flex; flex-direction: column; gap: 4px">
          <h1 style="font-family: var(--font-display); font-size: 24px; color: var(--color-espresso); margin: 0">
            {{ 'admin.campaigns.title' | translate }}
          </h1>
          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.campaigns.subtitle' | translate }}
          </p>
        </div>
        @if (activeBrand.activeId()) {
          <a
            routerLink="/campaigns/new"
            class="flex items-center"
            style="height: 36px; padding: 0 16px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; text-decoration: none; white-space: nowrap"
          >
            {{ 'admin.campaigns.createTitle' | translate }}
          </a>
        }
      </header>

      @if (!isPlatformAdmin()) {
        <p class="moderation-note">{{ 'admin.campaigns.moderation.note' | translate }}</p>
      }

      @if (!activeBrand.activeId() && activeBrand.loaded()) {
        <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
          {{ activeBrand.loadError() ?? ('admin.campaigns.noBrand' | translate) }}
        </p>
      }

      <!-- List -->
      <div
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px; overflow: hidden; overflow-x: auto"
      >
        <table style="width: 100%; border-collapse: collapse; font-family: var(--font-sans); font-size: 13px">
          <thead style="background: var(--color-cream)">
            <tr>
              <th style="text-align: left; padding: 10px 14px">{{ 'admin.campaigns.col.title' | translate }}</th>
              <th style="text-align: left; padding: 10px 14px">{{ 'admin.campaigns.col.channel' | translate }}</th>
              <th style="text-align: left; padding: 10px 14px">{{ 'admin.campaigns.col.audience' | translate }}</th>
              <th style="text-align: left; padding: 10px 14px">{{ 'admin.campaigns.col.status' | translate }}</th>
              <th style="text-align: left; padding: 10px 14px">{{ 'admin.campaigns.col.delivered' | translate }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (c of rows(); track c.id) {
              <tr style="border-top: 1px solid var(--color-border-light); vertical-align: top">
                <td style="padding: 10px 14px">
                  <div
                    style="font-weight: 600; color: var(--color-espresso); margin-bottom: 2px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
                  >
                    {{ c.title }}
                  </div>
                  <div
                    style="color: var(--color-text-secondary); font-size: 12px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
                  >
                    {{ c.body }}
                  </div>
                  @if (c.scheduledAt && !c.startedAt) {
                    <div style="margin-top: 4px; font-size: 12px; color: var(--color-text-secondary)">
                      {{
                        'admin.campaigns.scheduledFor' | translate: { time: (c.scheduledAt | localDate: 'dateTime') }
                      }}
                    </div>
                  }
                </td>
                <td style="padding: 10px 14px">{{ 'admin.campaigns.channels.' + c.channel | translate }}</td>
                <td style="padding: 10px 14px">
                  @if (c.audience === 'INACTIVE') {
                    {{ 'admin.campaigns.audienceInactive' | translate: { days: c.inactiveDays ?? 14 } }}
                  } @else {
                    {{ 'admin.campaigns.audiences.' + c.audience | translate }}
                  }
                </td>
                <td style="padding: 10px 14px">
                  <span class="status-pill" [attr.data-tone]="tone(c)">{{
                    'admin.campaigns.status.' + c.status | translate
                  }}</span>
                </td>
                <td style="padding: 10px 14px; min-width: 200px">
                  @if (c.status === 'REJECTED') {
                    <div class="review-note" role="note">
                      <strong>{{ 'admin.campaigns.moderation.rejectedTitle' | translate }}</strong>
                      <span>{{ c.reviewNote || ('admin.campaigns.moderation.noReason' | translate) }}</span>
                      <span class="review-hint">{{ 'admin.campaigns.moderation.fixHint' | translate }}</span>
                    </div>
                  } @else if (c.status === 'PENDING_REVIEW') {
                    <span style="color: var(--color-text-secondary)">{{
                      'admin.campaigns.moderation.pendingHint' | translate
                    }}</span>
                  } @else if (c.status === 'APPROVED') {
                    <span style="color: var(--color-text-secondary)">{{
                      (c.scheduledAt
                        ? 'admin.campaigns.moderation.approvedScheduled'
                        : 'admin.campaigns.moderation.approvedNow'
                      ) | translate
                    }}</span>
                  } @else if (c.status === 'DRAFT') {
                    <span style="color: var(--color-text-secondary)">—</span>
                  } @else {
                    <div style="font-weight: 600; color: var(--color-espresso)">
                      {{ 'admin.campaigns.result.sent' | translate: { sent: c.sentCount, target: c.targetCount } }}
                    </div>
                    <div
                      class="flex flex-wrap"
                      style="gap: 2px 10px; font-size: 12px; color: var(--color-text-secondary)"
                    >
                      @if (c.failedCount > 0) {
                        <span style="color: var(--color-berry)">{{
                          'admin.campaigns.result.failed' | translate: { count: c.failedCount }
                        }}</span>
                      }
                      @if (c.noChannelCount > 0) {
                        <span>{{ 'admin.campaigns.result.noChannel' | translate: { count: c.noChannelCount } }}</span>
                      }
                      @if (c.optedOutCount > 0) {
                        <span>{{ 'admin.campaigns.result.optedOut' | translate: { count: c.optedOutCount } }}</span>
                      }
                    </div>
                    @if (viaSummary(c); as via) {
                      <div style="font-size: 12px; color: var(--color-text-secondary)">
                        {{ 'admin.campaigns.result.via' | translate: { list: via } }}
                      </div>
                    }
                    @if (c.errors.length > 0) {
                      <div
                        style="margin-top: 4px; font-size: 12px; color: var(--color-berry); max-width: 360px; overflow-wrap: anywhere"
                      >
                        <div style="font-weight: 600">{{ 'admin.campaigns.result.errorsTitle' | translate }}</div>
                        <ul style="margin: 2px 0 0; padding-left: 16px">
                          @for (e of c.errors; track e.error) {
                            <li [attr.title]="e.error">
                              {{ 'admin.campaigns.result.errorItem' | translate: { error: e.error, count: e.count } }}
                            </li>
                          }
                        </ul>
                      </div>
                    } @else if (c.lastError) {
                      <div
                        style="margin-top: 4px; font-size: 12px; color: var(--color-berry); max-width: 320px; overflow-wrap: anywhere"
                        [attr.title]="c.lastError"
                      >
                        {{ 'admin.campaigns.result.lastError' | translate: { error: c.lastError } }}
                      </div>
                    }
                  }
                </td>
                <td style="padding: 10px 14px; text-align: right">
                  <div class="row-actions">
                    @if (c.editable) {
                      <button type="button" class="act-primary" (click)="submit(c)" [disabled]="busy() === c.id">
                        {{
                          (busy() === c.id
                            ? 'admin.campaigns.sending'
                            : isPlatformAdmin()
                              ? 'admin.campaigns.send'
                              : 'admin.campaigns.moderation.submit'
                          ) | translate
                        }}
                      </button>
                      <a class="act-link" [routerLink]="['/campaigns', c.id]">{{
                        'admin.campaigns.edit' | translate
                      }}</a>
                    }
                    @if (c.sendable) {
                      <button type="button" class="act-primary" (click)="retry(c)" [disabled]="busy() === c.id">
                        {{ (busy() === c.id ? 'admin.campaigns.sending' : 'admin.campaigns.retry') | translate }}
                      </button>
                    }
                    @if (c.deletable) {
                      <button type="button" class="act-danger" (click)="remove(c)" [disabled]="busy() === c.id">
                        {{ 'admin.campaigns.delete' | translate }}
                      </button>
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" style="padding: 24px; text-align: center; color: var(--color-text-secondary)">
                  {{ 'admin.campaigns.empty' | translate }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      @if (notice(); as message) {
        <p role="status" style="font-family: var(--font-sans); font-size: 13px; color: var(--color-mint); margin: 0">
          {{ message }}
        </p>
      }
      @if (error(); as message) {
        <p role="alert" style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0">
          {{ message }}
        </p>
      }
    </section>
  `,
  styles: [
    `
      .moderation-note {
        margin: 0;
        padding: 10px 14px;
        border-radius: 12px;
        background: var(--color-caramel-light);
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-primary);
      }
      .status-pill {
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
        background: rgba(120, 120, 120, 0.15);
        color: var(--color-text-secondary);
      }
      .status-pill[data-tone='ok'] {
        background: rgba(76, 175, 80, 0.15);
        color: var(--color-mint);
      }
      .status-pill[data-tone='bad'] {
        background: rgba(244, 67, 54, 0.15);
        color: var(--color-berry);
      }
      .status-pill[data-tone='busy'],
      .status-pill[data-tone='wait'] {
        background: rgba(255, 152, 0, 0.15);
        color: var(--color-amber);
      }
      .review-note {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-width: 360px;
        font-size: 12px;
        color: var(--color-berry);
        overflow-wrap: anywhere;
      }
      .review-hint {
        color: var(--color-text-secondary);
      }
      .row-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        align-items: center;
        gap: 6px 10px;
      }
      .act-primary {
        background: var(--color-caramel);
        color: white;
        padding: 4px 12px;
        border-radius: 6px;
        font-weight: 600;
        white-space: nowrap;
      }
      .act-primary:disabled {
        opacity: 0.6;
      }
      .act-link {
        color: var(--color-caramel);
        font-weight: 600;
        white-space: nowrap;
      }
      .act-danger {
        background: transparent;
        color: var(--color-berry);
        padding: 4px 4px;
        white-space: nowrap;
      }
    `,
  ],
})
export class AdminCampaignsPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthStore);
  readonly activeBrand = inject(ActiveBrandService);

  readonly rows = signal<CampaignRow[]>([]);
  /** The campaign an action is in flight for. */
  readonly busy = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  /** A platform admin's campaign needs no review: their submit is the approval. */
  readonly isPlatformAdmin = computed(() => this.auth.user()?.role === 'SUPER_ADMIN');

  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Re-list whenever the active brand changes.
    effect(() => {
      const brandId = this.activeBrand.activeId();
      this.rows.set([]);
      if (brandId) this.refresh(brandId);
    });
    inject(DestroyRef).onDestroy(() => this.stopPolling());
  }

  ngOnInit(): void {
    if (!this.activeBrand.loaded()) this.activeBrand.refresh();
  }

  tone(c: CampaignRow): string {
    return campaignStatusTone(c.status);
  }

  /** «Отправить на модерацию»; for a platform admin, «Отправить» — approved on the spot. */
  submit(c: CampaignRow): void {
    this.act(c, this.http.post<CampaignRow>(`${this.api.baseUrl}/admin/campaigns/${c.id}/submit`, {}), (row) =>
      row.status === 'PENDING_REVIEW' ? 'admin.campaigns.moderation.submitted' : null,
    );
  }

  /** Retries an approved campaign: a failed or stuck run, or the people it missed. */
  retry(c: CampaignRow): void {
    this.act(c, this.http.post<CampaignRow>(`${this.api.baseUrl}/admin/campaigns/${c.id}/send`, {}), () => null);
  }

  remove(c: CampaignRow): void {
    this.busy.set(c.id);
    this.error.set(null);
    this.notice.set(null);
    this.http.delete(`${this.api.baseUrl}/admin/campaigns/${c.id}`).subscribe({
      next: () => {
        this.busy.set(null);
        this.rows.update((rs) => rs.filter((r) => r.id !== c.id));
      },
      error: (err) => {
        this.busy.set(null);
        this.error.set(apiErrorMessage(err, this.translate, CAMPAIGN_ERROR_WORDING));
      },
    });
  }

  /** "iPhone app (Apple) 3 · Telegram 1" — the transports that reached people, or null before anything went out. */
  viaSummary(c: CampaignRow): string | null {
    const parts = CAMPAIGN_TRANSPORTS.filter((t) => c.via[t] > 0).map(
      (t) => `${this.translate.instant(`admin.campaigns.test.via.${t}`)} ${c.via[t]}`,
    );
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  private act(c: CampaignRow, request: Observable<CampaignRow>, noticeFor: (row: CampaignRow) => string | null): void {
    this.busy.set(c.id);
    this.error.set(null);
    this.notice.set(null);
    request.subscribe({
      next: (row) => {
        this.busy.set(null);
        this.rows.update((rs) => rs.map((r) => (r.id === c.id ? row : r)));
        const key = noticeFor(row);
        if (key) this.notice.set(this.translate.instant(key));
        this.schedulePoll();
      },
      error: (err) => {
        this.busy.set(null);
        this.error.set(apiErrorMessage(err, this.translate, CAMPAIGN_ERROR_WORDING));
      },
    });
  }

  private refresh(brandId: string): void {
    this.http.get<CampaignRow[]>(`${this.api.baseUrl}/admin/campaigns`, { params: { brandId } }).subscribe({
      next: (rs) => {
        // The brand may have changed while the request was in flight.
        if (this.activeBrand.activeId() !== brandId) return;
        this.rows.set(rs);
        this.schedulePoll();
      },
      error: (err) => this.error.set(apiErrorMessage(err, this.translate, CAMPAIGN_ERROR_WORDING)),
    });
  }

  /**
   * Keeps re-reading the list while anything is going out, or is approved
   * and about to; stops once all settle.
   */
  private schedulePoll(): void {
    this.stopPolling();
    const now = Date.now();
    const moving = this.rows().some(
      (r) =>
        r.status === 'SENDING' ||
        (r.status === 'APPROVED' && (!r.scheduledAt || new Date(r.scheduledAt).getTime() <= now)),
    );
    if (!moving) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      const brandId = this.activeBrand.activeId();
      if (brandId) this.refresh(brandId);
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
}
