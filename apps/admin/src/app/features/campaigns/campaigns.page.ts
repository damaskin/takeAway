import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { API_CONFIG } from '../../core/api/api.config';
import { extractMessage } from '../../core/http/extract-message';
import type { CampaignRow } from './campaign.types';

/**
 * Brand-admin marketing campaigns. Compose a title + body, pick a
 * channel and audience, save the draft, then click Send to fan it out.
 * Send is synchronous in v1 — the row's status flips to SENDING then
 * to SENT/FAILED with counters once the broadcast finishes.
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
        <a
          routerLink="/campaigns/new"
          class="flex items-center"
          style="height: 36px; padding: 0 16px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; text-decoration: none; white-space: nowrap"
        >
          {{ 'admin.campaigns.createTitle' | translate }}
        </a>
      </header>

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
              <th style="text-align: right; padding: 10px 14px">{{ 'admin.campaigns.col.delivered' | translate }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (c of rows(); track c.id) {
              <tr style="border-top: 1px solid var(--color-border-light); vertical-align: top">
                <td style="padding: 10px 14px">
                  <div
                    style="font-weight: 600; color: var(--color-espresso); margin-bottom: 2px; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
                  >
                    {{ c.title }}
                  </div>
                  <div
                    style="color: var(--color-text-secondary); font-size: 12px; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
                  >
                    {{ c.body }}
                  </div>
                </td>
                <td style="padding: 10px 14px">{{ 'admin.campaigns.channels.' + c.channel | translate }}</td>
                <td style="padding: 10px 14px">{{ 'admin.campaigns.audiences.' + c.audience | translate }}</td>
                <td style="padding: 10px 14px">
                  <span
                    style="padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600"
                    [style.background]="statusBg(c.status)"
                    [style.color]="statusColor(c.status)"
                    >{{ 'admin.campaigns.status.' + c.status | translate }}</span
                  >
                </td>
                <td style="padding: 10px 14px; text-align: right">{{ c.sentCount }} / {{ c.targetCount }}</td>
                <td style="padding: 10px 14px; text-align: right">
                  @if (c.status === 'DRAFT') {
                    <button
                      (click)="send(c)"
                      [disabled]="sending() === c.id"
                      style="background: var(--color-caramel); color: white; padding: 4px 12px; border-radius: 6px; font-weight: 600"
                    >
                      {{ (sending() === c.id ? 'admin.campaigns.sending' : 'admin.campaigns.send') | translate }}
                    </button>
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
export class AdminCampaignsPage {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly translate = inject(TranslateService);

  readonly rows = signal<CampaignRow[]>([]);
  readonly sending = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    this.refresh();
  }

  send(c: CampaignRow): void {
    this.sending.set(c.id);
    this.http.post<CampaignRow>(`${this.api.baseUrl}/admin/campaigns/${c.id}/send`, {}).subscribe({
      next: (row) => {
        this.sending.set(null);
        this.rows.update((rs) => rs.map((r) => (r.id === c.id ? row : r)));
      },
      error: (err) => {
        this.sending.set(null);
        this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
      },
    });
  }

  remove(c: CampaignRow): void {
    this.http.delete(`${this.api.baseUrl}/admin/campaigns/${c.id}`).subscribe({
      next: () => this.rows.update((rs) => rs.filter((r) => r.id !== c.id)),
    });
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

  private refresh(): void {
    this.http.get<CampaignRow[]>(`${this.api.baseUrl}/admin/campaigns`).subscribe({
      next: (rs) => this.rows.set(rs),
      error: (err) => this.error.set(extractMessage(err)),
    });
  }
}
