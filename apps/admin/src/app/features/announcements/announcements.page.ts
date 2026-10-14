import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocalDatePipe } from '@takeaway/i18n';
import type { Observable } from 'rxjs';

import { API_CONFIG } from '../../core/api/api.config';
import { apiErrorMessage } from '../../core/http/api-error';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { ANNOUNCEMENT_ERROR_WORDING } from './announcement-errors';
import { ANNOUNCEMENT_TRANSPORTS, type AnnouncementRow, announcementStatusTone } from './announcement.types';

/** How often the list re-reads itself while an announcement is going out. */
const POLL_MS = 3000;

/**
 * Platform announcements — the takeAway team writing to every customer who
 * allows promotional notifications, e.g. about a new partner. A draft is
 * sent at once or at its time; each recipient finds it in «Уведомления» of
 * the app and the site, and gets a push titled «takeAway: …» (the Telegram
 * bot for those without app or web push). The list polls while one is going
 * out and shows how the pushes went. SUPER_ADMIN only.
 */
@Component({
  selector: 'app-admin-announcements',
  standalone: true,
  imports: [RouterLink, TranslatePipe, LocalDatePipe, ConfirmDialogComponent],
  template: `
    <section style="padding: 24px; max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px">
      <header class="flex items-start justify-between flex-wrap" style="gap: 12px">
        <div style="display: flex; flex-direction: column; gap: 4px">
          <h1 style="font-family: var(--font-display); font-size: 24px; color: var(--color-espresso); margin: 0">
            {{ 'admin.announcements.title' | translate }}
          </h1>
          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.announcements.subtitle' | translate }}
          </p>
        </div>
        <a
          routerLink="/announcements/new"
          class="flex items-center"
          style="height: 36px; padding: 0 16px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; text-decoration: none; white-space: nowrap"
        >
          {{ 'admin.announcements.createTitle' | translate }}
        </a>
      </header>

      <div
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px; overflow: hidden; overflow-x: auto"
      >
        <table style="width: 100%; border-collapse: collapse; font-family: var(--font-sans); font-size: 13px">
          <thead style="background: var(--color-cream)">
            <tr>
              <th style="text-align: left; padding: 10px 14px">{{ 'admin.announcements.col.title' | translate }}</th>
              <th style="text-align: left; padding: 10px 14px">{{ 'admin.announcements.col.status' | translate }}</th>
              <th style="text-align: left; padding: 10px 14px">{{ 'admin.announcements.col.result' | translate }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (a of rows(); track a.id) {
              <tr style="border-top: 1px solid var(--color-border-light); vertical-align: top">
                <td style="padding: 10px 14px">
                  <div class="cell-title">{{ a.title }}</div>
                  <div class="cell-body">{{ a.body }}</div>
                  @if (a.link; as link) {
                    <div class="cell-meta">
                      {{
                        (link.kind === 'STORE' ? 'admin.announcements.linkStore' : 'admin.announcements.linkBrand')
                          | translate: { name: link.name, brand: link.brandName ?? '' }
                      }}
                    </div>
                  }
                  @if (a.scheduledAt && !a.startedAt) {
                    <div class="cell-meta">
                      {{
                        'admin.announcements.scheduledFor'
                          | translate: { time: (a.scheduledAt | localDate: 'dateTime') }
                      }}
                    </div>
                  }
                  @if (a.sentAt) {
                    <div class="cell-meta">
                      {{ 'admin.announcements.sentAt' | translate: { time: (a.sentAt | localDate: 'dateTime') } }}
                    </div>
                  }
                </td>
                <td style="padding: 10px 14px">
                  <span class="status-pill" [attr.data-tone]="tone(a)">{{
                    'admin.announcements.status.' + a.status | translate
                  }}</span>
                </td>
                <td style="padding: 10px 14px; min-width: 220px">
                  @if (a.status === 'DRAFT' || a.status === 'SCHEDULED') {
                    <span style="color: var(--color-text-secondary)">—</span>
                  } @else {
                    <div style="font-weight: 600; color: var(--color-espresso)">
                      {{ 'admin.announcements.result.inbox' | translate: { count: a.targetCount } }}
                    </div>
                    <div
                      class="flex flex-wrap"
                      style="gap: 2px 10px; font-size: 12px; color: var(--color-text-secondary)"
                    >
                      <span>{{ 'admin.announcements.result.pushed' | translate: { count: a.sentCount } }}</span>
                      @if (a.failedCount > 0) {
                        <span style="color: var(--color-berry)">{{
                          'admin.announcements.result.failed' | translate: { count: a.failedCount }
                        }}</span>
                      }
                      @if (a.noChannelCount > 0) {
                        <span>{{
                          'admin.announcements.result.inboxOnly' | translate: { count: a.noChannelCount }
                        }}</span>
                      }
                    </div>
                    @if (viaSummary(a); as via) {
                      <div style="font-size: 12px; color: var(--color-text-secondary)">
                        {{ 'admin.campaigns.result.via' | translate: { list: via } }}
                      </div>
                    }
                    @if (a.errors.length > 0) {
                      <div class="cell-errors">
                        <div style="font-weight: 600">{{ 'admin.campaigns.result.errorsTitle' | translate }}</div>
                        <ul style="margin: 2px 0 0; padding-left: 16px">
                          @for (e of a.errors; track e.error) {
                            <li [attr.title]="e.error">
                              {{ 'admin.campaigns.result.errorItem' | translate: { error: e.error, count: e.count } }}
                            </li>
                          }
                        </ul>
                      </div>
                    } @else if (a.lastError) {
                      <div class="cell-errors" [attr.title]="a.lastError">
                        {{ 'admin.campaigns.result.lastError' | translate: { error: a.lastError } }}
                      </div>
                    }
                  }
                </td>
                <td style="padding: 10px 14px; text-align: right">
                  <div class="row-actions">
                    @if (a.editable) {
                      <button type="button" class="act-primary" (click)="send(a)" [disabled]="busy() === a.id">
                        {{
                          (busy() === a.id
                            ? 'admin.announcements.sending'
                            : a.scheduledAt
                              ? 'admin.announcements.schedule'
                              : 'admin.announcements.send'
                          ) | translate
                        }}
                      </button>
                      <a class="act-link" [routerLink]="['/announcements', a.id]">{{
                        'admin.announcements.edit' | translate
                      }}</a>
                    }
                    @if (a.cancellable) {
                      <button type="button" class="act-link" (click)="cancel(a)" [disabled]="busy() === a.id">
                        {{ 'admin.announcements.cancelSchedule' | translate }}
                      </button>
                    }
                    @if (a.retryable) {
                      <button type="button" class="act-primary" (click)="retry(a)" [disabled]="busy() === a.id">
                        {{
                          (busy() === a.id ? 'admin.announcements.sending' : 'admin.announcements.retry') | translate
                        }}
                      </button>
                    }
                    @if (a.deletable) {
                      <button type="button" class="act-danger" (click)="askRemove(a)" [disabled]="busy() === a.id">
                        {{ 'admin.announcements.delete' | translate }}
                      </button>
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="4" style="padding: 24px; text-align: center; color: var(--color-text-secondary)">
                  {{ 'admin.announcements.empty' | translate }}
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

      @if (confirming(); as c) {
        <app-confirm-dialog
          [tone]="c.action === 'delete' ? 'danger' : 'primary'"
          [title]="
            (c.action === 'delete' ? 'admin.announcements.deleteDialog.title' : 'admin.announcements.sendDialog.title')
              | translate: { title: c.row.title }
          "
          [body]="
            (c.action === 'delete'
              ? 'admin.announcements.deleteDialog.body'
              : c.row.scheduledAt
                ? 'admin.announcements.sendDialog.scheduled'
                : 'admin.announcements.sendDialog.now'
            ) | translate: { time: c.row.scheduledAt ? (c.row.scheduledAt | localDate: 'dateTime') : '' }
          "
          [confirmLabel]="
            (c.action === 'delete'
              ? 'admin.announcements.delete'
              : c.row.scheduledAt
                ? 'admin.announcements.schedule'
                : 'admin.announcements.send'
            ) | translate
          "
          [cancelLabel]="'common.cancel' | translate"
          [busy]="busy() === c.row.id"
          (confirmed)="confirm(c)"
          (cancelled)="confirming.set(null)"
        />
      }
    </section>
  `,
  styles: [
    `
      .cell-title {
        font-weight: 600;
        color: var(--color-espresso);
        margin-bottom: 2px;
        max-width: 360px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cell-body {
        color: var(--color-text-secondary);
        font-size: 12px;
        max-width: 360px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cell-meta {
        margin-top: 4px;
        font-size: 12px;
        color: var(--color-text-secondary);
      }
      .cell-errors {
        margin-top: 4px;
        font-size: 12px;
        color: var(--color-berry);
        max-width: 360px;
        overflow-wrap: anywhere;
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
        background: transparent;
        padding: 0;
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
export class AdminAnnouncementsPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly translate = inject(TranslateService);

  readonly rows = signal<AnnouncementRow[]>([]);
  /** The announcement an action is in flight for. */
  readonly busy = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  /** A send reaches every customer, a delete cannot be undone: both ask first. */
  readonly confirming = signal<{ action: 'send' | 'delete'; row: AnnouncementRow } | null>(null);

  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopPolling());
  }

  ngOnInit(): void {
    this.refresh();
  }

  tone(a: AnnouncementRow): string {
    return announcementStatusTone(a.status);
  }

  send(a: AnnouncementRow): void {
    this.confirming.set({ action: 'send', row: a });
  }

  askRemove(a: AnnouncementRow): void {
    this.confirming.set({ action: 'delete', row: a });
  }

  confirm(c: { action: 'send' | 'delete'; row: AnnouncementRow }): void {
    if (c.action === 'delete') this.remove(c.row);
    else
      this.act(
        c.row,
        this.http.post<AnnouncementRow>(`${this.api.baseUrl}/admin/announcements/${c.row.id}/send`, {}),
        (row) =>
          row.status === 'SCHEDULED' ? 'admin.announcements.scheduledNotice' : 'admin.announcements.sendingNotice',
      );
  }

  /** «Повторить»: a failed or stuck run, or the pushes that failed. Nobody gets a second inbox item. */
  retry(a: AnnouncementRow): void {
    this.act(
      a,
      this.http.post<AnnouncementRow>(`${this.api.baseUrl}/admin/announcements/${a.id}/send`, {}),
      () => null,
    );
  }

  /** «Отменить отправку»: a scheduled announcement goes back to a draft. */
  cancel(a: AnnouncementRow): void {
    this.act(
      a,
      this.http.post<AnnouncementRow>(`${this.api.baseUrl}/admin/announcements/${a.id}/cancel`, {}),
      () => 'admin.announcements.cancelledNotice',
    );
  }

  remove(a: AnnouncementRow): void {
    this.busy.set(a.id);
    this.error.set(null);
    this.notice.set(null);
    this.http.delete(`${this.api.baseUrl}/admin/announcements/${a.id}`).subscribe({
      next: () => {
        this.busy.set(null);
        this.confirming.set(null);
        this.rows.update((rs) => rs.filter((r) => r.id !== a.id));
      },
      error: (err) => {
        this.busy.set(null);
        this.confirming.set(null);
        this.error.set(apiErrorMessage(err, this.translate, ANNOUNCEMENT_ERROR_WORDING));
      },
    });
  }

  /** "iPhone app (Apple) 3 · Telegram 1" — the transports that reached people. */
  viaSummary(a: AnnouncementRow): string | null {
    const parts = ANNOUNCEMENT_TRANSPORTS.filter((t) => a.via[t] > 0).map(
      (t) => `${this.translate.instant(`admin.campaigns.test.via.${t}`)} ${a.via[t]}`,
    );
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  private act(
    a: AnnouncementRow,
    request: Observable<AnnouncementRow>,
    noticeFor: (row: AnnouncementRow) => string | null,
  ): void {
    this.busy.set(a.id);
    this.error.set(null);
    this.notice.set(null);
    request.subscribe({
      next: (row) => {
        this.busy.set(null);
        this.confirming.set(null);
        this.rows.update((rs) => rs.map((r) => (r.id === a.id ? row : r)));
        const key = noticeFor(row);
        if (key) this.notice.set(this.translate.instant(key));
        this.schedulePoll();
      },
      error: (err) => {
        this.busy.set(null);
        this.confirming.set(null);
        this.error.set(apiErrorMessage(err, this.translate, ANNOUNCEMENT_ERROR_WORDING));
      },
    });
  }

  private refresh(): void {
    this.http.get<AnnouncementRow[]>(`${this.api.baseUrl}/admin/announcements`).subscribe({
      next: (rs) => {
        this.rows.set(rs);
        this.schedulePoll();
      },
      error: (err) => this.error.set(apiErrorMessage(err, this.translate, ANNOUNCEMENT_ERROR_WORDING)),
    });
  }

  /** Keeps re-reading the list while anything is going out, or is scheduled and due; stops once all settle. */
  private schedulePoll(): void {
    this.stopPolling();
    const now = Date.now();
    const moving = this.rows().some(
      (r) =>
        r.status === 'SENDING' ||
        (r.status === 'SCHEDULED' && !!r.scheduledAt && new Date(r.scheduledAt).getTime() <= now),
    );
    if (!moving) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.refresh();
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
}
