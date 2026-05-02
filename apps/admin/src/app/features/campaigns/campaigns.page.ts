import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { API_CONFIG } from '../../core/api/api.config';

interface CampaignRow {
  id: string;
  brandId: string;
  title: string;
  body: string;
  channel: 'PUSH' | 'TELEGRAM' | 'EMAIL';
  audience: 'ALL' | 'HAS_ORDERED' | 'INACTIVE_30D';
  status: 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'FAILED';
  targetCount: number;
  sentCount: number;
  failedCount: number;
  sentAt: string | null;
  createdAt: string;
}

const CHANNELS: Array<CampaignRow['channel']> = ['PUSH', 'TELEGRAM', 'EMAIL'];
const AUDIENCES: Array<CampaignRow['audience']> = ['ALL', 'HAS_ORDERED', 'INACTIVE_30D'];

/**
 * Brand-admin marketing campaigns. Compose a title + body, pick a
 * channel and audience, save the draft, then click Send to fan it out.
 * Send is synchronous in v1 — the row's status flips to SENDING then
 * to SENT/FAILED with counters once the broadcast finishes.
 */
@Component({
  selector: 'app-admin-campaigns',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  template: `
    <section style="padding: 24px; max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px">
      <header style="display: flex; flex-direction: column; gap: 4px">
        <h1 style="font-family: var(--font-display); font-size: 24px; color: var(--color-espresso); margin: 0">
          {{ 'admin.campaigns.title' | translate }}
        </h1>
        <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
          {{ 'admin.campaigns.subtitle' | translate }}
        </p>
      </header>

      <!-- Compose -->
      <form
        [formGroup]="form"
        (ngSubmit)="create()"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px; padding: 18px; display: grid; gap: 12px; grid-template-columns: repeat(2, 1fr)"
      >
        <label style="grid-column: span 2; display: flex; flex-direction: column; gap: 4px">
          <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
            'admin.campaigns.fields.title' | translate
          }}</span>
          <input
            type="text"
            formControlName="title"
            maxlength="120"
            style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
          />
        </label>
        <label style="grid-column: span 2; display: flex; flex-direction: column; gap: 4px">
          <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
            'admin.campaigns.fields.body' | translate
          }}</span>
          <textarea
            formControlName="body"
            rows="3"
            maxlength="2000"
            style="padding: 8px 10px; border: 1px solid var(--color-border); border-radius: 8px; resize: vertical"
          ></textarea>
        </label>
        <label style="display: flex; flex-direction: column; gap: 4px">
          <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
            'admin.campaigns.fields.channel' | translate
          }}</span>
          <select
            formControlName="channel"
            style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
          >
            @for (c of channels; track c) {
              <option [value]="c">{{ 'admin.campaigns.channels.' + c | translate }}</option>
            }
          </select>
        </label>
        <label style="display: flex; flex-direction: column; gap: 4px">
          <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
            'admin.campaigns.fields.audience' | translate
          }}</span>
          <select
            formControlName="audience"
            style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
          >
            @for (a of audiences; track a) {
              <option [value]="a">{{ 'admin.campaigns.audiences.' + a | translate }}</option>
            }
          </select>
        </label>
        <button
          type="submit"
          [disabled]="form.invalid || creating()"
          style="grid-column: span 2; justify-self: end; height: 36px; padding: 0 18px; background: var(--color-caramel); color: white; border-radius: 8px; font-family: var(--font-sans); font-weight: 600"
        >
          {{ (creating() ? 'common.loading' : 'admin.campaigns.saveDraft') | translate }}
        </button>
        @if (error()) {
          <p
            style="grid-column: span 2; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0"
          >
            {{ error() }}
          </p>
        }
      </form>

      <!-- List -->
      <div
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px; overflow: hidden"
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
    </section>
  `,
})
export class AdminCampaignsPage {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly translate = inject(TranslateService);

  readonly channels = CHANNELS;
  readonly audiences = AUDIENCES;
  readonly rows = signal<CampaignRow[]>([]);
  readonly creating = signal(false);
  readonly sending = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    title: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
    body: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
    channel: new FormControl<CampaignRow['channel']>('PUSH', { nonNullable: true }),
    audience: new FormControl<CampaignRow['audience']>('HAS_ORDERED', { nonNullable: true }),
  });

  constructor() {
    this.refresh();
  }

  create(): void {
    const v = this.form.getRawValue();
    this.creating.set(true);
    this.error.set(null);
    this.http.post<CampaignRow>(`${this.api.baseUrl}/admin/campaigns`, v).subscribe({
      next: (row) => {
        this.creating.set(false);
        this.rows.update((rs) => [row, ...rs]);
        this.form.reset({ title: '', body: '', channel: 'PUSH', audience: 'HAS_ORDERED' });
      },
      error: (err) => {
        this.creating.set(false);
        this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
      },
    });
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

function extractMessage(err: unknown): string | null {
  const maybe = err as { error?: { message?: unknown }; message?: unknown };
  if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
  if (typeof maybe.message === 'string') return maybe.message;
  return null;
}
