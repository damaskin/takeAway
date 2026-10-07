import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, OnInit, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CAMPAIGN_TRANSPORTS } from '@takeaway/shared-types';

import { API_CONFIG } from '../../core/api/api.config';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { CAMPAIGN_ERROR_WORDING } from './campaign-errors';
import type { CampaignRow } from './campaign.types';

/** How often the list re-reads itself while a campaign is going out. */
const POLL_MS = 3000;

/**
 * Brand-admin marketing campaigns. Compose a title + body, pick a
 * channel and audience, save the draft, then click Send. Sending runs in
 * the background: the row flips to SENDING at once and the list polls
 * until it settles on SENT or FAILED, showing who got it and through what
 * (iPhone app, app via Firebase, browser, Telegram), who could not be
 * reached and the most common errors. A failed, stuck or partly failed
 * campaign can be sent again — only the people it missed get it.
 *
 * Works on the brand picked in the top bar (SUPER_ADMIN picks any).
 */
@Component({
  selector: 'app-admin-campaigns',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
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
                </td>
                <td style="padding: 10px 14px">{{ 'admin.campaigns.channels.' + c.channel | translate }}</td>
                <td style="padding: 10px 14px">{{ 'admin.campaigns.audiences.' + c.audience | translate }}</td>
                <td style="padding: 10px 14px">
                  <span
                    style="padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; white-space: nowrap"
                    [style.background]="statusBg(c.status)"
                    [style.color]="statusColor(c.status)"
                    >{{ 'admin.campaigns.status.' + c.status | translate }}</span
                  >
                </td>
                <td style="padding: 10px 14px; min-width: 200px">
                  @if (c.status === 'DRAFT') {
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
                <td style="padding: 10px 14px; text-align: right; white-space: nowrap">
                  @if (c.sendable) {
                    <button
                      (click)="send(c)"
                      [disabled]="sending() === c.id"
                      style="background: var(--color-caramel); color: white; padding: 4px 12px; border-radius: 6px; font-weight: 600"
                    >
                      {{
                        (sending() === c.id
                          ? 'admin.campaigns.sending'
                          : c.status === 'DRAFT'
                            ? 'admin.campaigns.send'
                            : 'admin.campaigns.retry'
                        ) | translate
                      }}
                    </button>
                  }
                  @if (c.status === 'DRAFT') {
                    <button
                      (click)="remove(c)"
                      style="margin-left: 8px; background: transparent; color: var(--color-berry); padding: 4px 8px"
                    >
                      {{ 'admin.giftCards.cancel' | translate }}
                    </button>
                  }
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

      @if (error(); as message) {
        <p role="alert" style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0">
          {{ message }}
        </p>
      }
    </section>
  `,
})
export class AdminCampaignsPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly translate = inject(TranslateService);
  readonly activeBrand = inject(ActiveBrandService);

  readonly rows = signal<CampaignRow[]>([]);
  readonly sending = signal<string | null>(null);
  readonly error = signal<string | null>(null);

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

  send(c: CampaignRow): void {
    this.sending.set(c.id);
    this.error.set(null);
    this.http.post<CampaignRow>(`${this.api.baseUrl}/admin/campaigns/${c.id}/send`, {}).subscribe({
      next: (row) => {
        this.sending.set(null);
        this.rows.update((rs) => rs.map((r) => (r.id === c.id ? row : r)));
        this.schedulePoll();
      },
      error: (err) => {
        this.sending.set(null);
        this.error.set(apiErrorMessage(err, this.translate, CAMPAIGN_ERROR_WORDING));
      },
    });
  }

  remove(c: CampaignRow): void {
    this.http.delete(`${this.api.baseUrl}/admin/campaigns/${c.id}`).subscribe({
      next: () => this.rows.update((rs) => rs.filter((r) => r.id !== c.id)),
      error: (err) => this.error.set(apiErrorMessage(err, this.translate, CAMPAIGN_ERROR_WORDING)),
    });
  }

  /** "iPhone app (Apple) 3 · Telegram 1" — the transports that reached people, or null before anything went out. */
  viaSummary(c: CampaignRow): string | null {
    const parts = CAMPAIGN_TRANSPORTS.filter((t) => c.via[t] > 0).map(
      (t) => `${this.translate.instant(`admin.campaigns.test.via.${t}`)} ${c.via[t]}`,
    );
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  statusBg(status: CampaignRow['status']): string {
    if (status === 'SENT') return 'rgba(76, 175, 80, 0.15)';
    if (status === 'FAILED') return 'rgba(244, 67, 54, 0.15)';
    if (status === 'SENDING') return 'rgba(255, 152, 0, 0.15)';
    return 'rgba(120, 120, 120, 0.15)';
  }

  statusColor(status: CampaignRow['status']): string {
    if (status === 'SENT') return 'var(--color-mint)';
    if (status === 'FAILED') return 'var(--color-berry)';
    if (status === 'SENDING') return 'var(--color-amber)';
    return 'var(--color-text-secondary)';
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

  /** Keeps re-reading the list while anything is SENDING; stops once all settle. */
  private schedulePoll(): void {
    this.stopPolling();
    if (!this.rows().some((r) => r.status === 'SENDING')) return;
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
