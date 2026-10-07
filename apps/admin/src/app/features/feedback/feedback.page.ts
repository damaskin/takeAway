import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocalDatePipe } from '@takeaway/i18n';
import {
  type AdminFeedback,
  type AdminFeedbackPage,
  FEEDBACK_KINDS,
  type FeedbackKind,
  type FeedbackStatus,
} from '@takeaway/shared-types';

import { FeedbackApi } from '../../core/feedback/feedback.service';
import { apiErrorMessage } from '../../core/http/api-error';

/** Inbox = everything not archived. */
type Tab = 'inbox' | 'NEW' | 'ARCHIVED';

const PAGE_SIZE = 20;

/**
 * «Обратная связь» — reviews, suggestions and problem reports customers send
 * from their profile in the app, on the site and in the Mini App. The
 * platform team reads them here, newest first, and marks them read or
 * archives them. SUPER_ADMIN only.
 */
@Component({
  selector: 'app-admin-feedback',
  standalone: true,
  imports: [LocalDatePipe, TranslatePipe],
  template: `
    <section class="fb">
      <header>
        <h1>{{ 'admin.feedback.title' | translate }}</h1>
        <p class="fb-sub">{{ 'admin.feedback.subtitle' | translate }}</p>
      </header>

      <div class="fb-bar">
        <div class="fb-tabs">
          @for (t of tabs; track t) {
            <button type="button" class="fb-tab" [class.fb-tab-active]="tab() === t" (click)="setTab(t)">
              {{ 'admin.feedback.tabs.' + t | translate }}
              @if (t === 'NEW' && newCount() > 0) {
                · {{ newCount() }}
              }
            </button>
          }
        </div>
        <label class="fb-kind">
          <span>{{ 'admin.feedback.kindFilter' | translate }}</span>
          <select (change)="setKind($any($event.target).value)">
            <option value="" [selected]="!kind()">{{ 'admin.feedback.allKinds' | translate }}</option>
            @for (k of kinds; track k) {
              <option [value]="k" [selected]="kind() === k">{{ 'admin.feedback.kinds.' + k | translate }}</option>
            }
          </select>
        </label>
      </div>

      @if (error()) {
        <p class="fb-error" role="alert">{{ error() }}</p>
      }

      @if (!page()) {
        <p class="fb-muted">{{ 'common.loading' | translate }}</p>
      } @else if (page()!.items.length === 0) {
        <p class="fb-muted">{{ 'admin.feedback.empty' | translate }}</p>
      } @else {
        <div class="fb-list">
          @for (f of page()!.items; track f.id) {
            <article class="fb-card" [class.fb-card-new]="f.status === 'NEW'">
              <div class="fb-head">
                <span class="fb-pill" [attr.data-kind]="f.kind">{{
                  'admin.feedback.kinds.' + f.kind | translate
                }}</span>
                @if (f.status === 'NEW') {
                  <span class="fb-new">{{ 'admin.feedback.status.NEW' | translate }}</span>
                } @else if (f.status === 'ARCHIVED') {
                  <span class="fb-muted-pill">{{ 'admin.feedback.status.ARCHIVED' | translate }}</span>
                }
                <span class="fb-meta"
                  >{{ f.createdAt | localDate: 'dateTime' }} · {{ 'admin.feedback.sources.' + f.source | translate
                  }}{{ f.appVersion ? ' ' + f.appVersion : '' }}</span
                >
              </div>

              <p class="fb-message">{{ f.message }}</p>

              <dl class="fb-who">
                <div>
                  <dt>{{ author(f) }}</dt>
                  @if (contacts(f); as line) {
                    <dd>{{ line }}</dd>
                  }
                </div>
                @if (f.contact) {
                  <div>
                    <dt>{{ 'admin.feedback.contact' | translate }}</dt>
                    <dd class="fb-contact">{{ f.contact }}</dd>
                  </div>
                }
              </dl>

              <div class="fb-actions">
                @if (f.status === 'NEW') {
                  <button type="button" (click)="setStatus(f, 'READ')" [disabled]="busyId() === f.id">
                    {{ 'admin.feedback.markRead' | translate }}
                  </button>
                } @else if (f.status === 'READ') {
                  <button type="button" (click)="setStatus(f, 'NEW')" [disabled]="busyId() === f.id">
                    {{ 'admin.feedback.markUnread' | translate }}
                  </button>
                }
                @if (f.status === 'ARCHIVED') {
                  <button type="button" (click)="setStatus(f, 'READ')" [disabled]="busyId() === f.id">
                    {{ 'admin.feedback.unarchive' | translate }}
                  </button>
                } @else {
                  <button
                    type="button"
                    class="fb-archive"
                    (click)="setStatus(f, 'ARCHIVED')"
                    [disabled]="busyId() === f.id"
                  >
                    {{ 'admin.feedback.archive' | translate }}
                  </button>
                }
              </div>
            </article>
          }
        </div>

        @if (pages() > 1) {
          <nav class="fb-pager" [attr.aria-label]="'admin.feedback.pager' | translate">
            <button type="button" [disabled]="pageNo() <= 1" (click)="pageNo.set(pageNo() - 1)">←</button>
            <span>{{ 'admin.feedback.pageOf' | translate: { page: pageNo(), pages: pages() } }}</span>
            <button type="button" [disabled]="pageNo() >= pages()" (click)="pageNo.set(pageNo() + 1)">→</button>
          </nav>
        }
      }
    </section>
  `,
  styles: [
    `
      .fb {
        padding: clamp(16px, 4vw, 32px);
        max-width: 960px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        font-family: var(--font-sans);
      }
      h1 {
        font-family: var(--font-display);
        font-size: 28px;
        color: var(--color-espresso);
        margin: 0;
      }
      .fb-sub {
        font-size: 14px;
        color: var(--color-text-secondary);
        margin: 4px 0 0;
      }
      .fb-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .fb-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .fb-tab {
        padding: 8px 16px;
        border-radius: 999px;
        border: 1px solid var(--color-border);
        background: var(--color-foam);
        color: var(--color-text-secondary);
        font-size: 14px;
        cursor: pointer;
      }
      .fb-tab-active {
        background: var(--color-caramel);
        border-color: var(--color-caramel);
        color: white;
      }
      .fb-kind {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .fb-kind select {
        height: 36px;
        padding: 0 10px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        background: var(--color-foam);
        color: var(--color-text-primary);
        font-family: var(--font-sans);
        font-size: 14px;
      }
      .fb-muted {
        color: var(--color-text-secondary);
        margin: 0;
      }
      .fb-error {
        color: var(--color-berry);
        margin: 0;
      }
      .fb-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .fb-card {
        background: var(--color-foam);
        border-radius: var(--radius-card);
        padding: 18px 20px;
        box-shadow: var(--shadow-soft);
        border-left: 4px solid transparent;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .fb-card-new {
        border-left-color: var(--color-amber);
      }
      .fb-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .fb-pill,
      .fb-new,
      .fb-muted-pill {
        padding: 3px 10px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.4px;
        text-transform: uppercase;
      }
      .fb-pill {
        background: var(--color-caramel-light);
        color: var(--color-caramel);
      }
      .fb-pill[data-kind='REVIEW'] {
        background: var(--color-mint);
        color: white;
      }
      .fb-pill[data-kind='PROBLEM'] {
        background: var(--color-berry);
        color: white;
      }
      .fb-new {
        background: var(--color-amber);
        color: white;
      }
      .fb-muted-pill {
        background: var(--color-surface-variant);
        color: var(--color-text-secondary);
      }
      .fb-meta {
        margin-left: auto;
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .fb-message {
        margin: 0;
        font-size: 15px;
        line-height: 1.5;
        color: var(--color-text-primary);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .fb-who {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 32px;
        margin: 0;
        font-size: 13px;
      }
      .fb-who dt {
        color: var(--color-text-primary);
        font-weight: 600;
      }
      .fb-who dd {
        margin: 2px 0 0;
        color: var(--color-text-secondary);
        overflow-wrap: anywhere;
      }
      .fb-contact {
        user-select: all;
      }
      .fb-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .fb-actions button {
        padding: 6px 14px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-button);
        background: transparent;
        color: var(--color-caramel);
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .fb-actions .fb-archive {
        color: var(--color-text-secondary);
      }
      .fb-actions button:disabled {
        opacity: 0.5;
      }
      .fb-pager {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .fb-pager button {
        width: 36px;
        height: 32px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-button);
        background: var(--color-foam);
        cursor: pointer;
      }
      .fb-pager button:disabled {
        opacity: 0.4;
      }
    `,
  ],
})
export class CustomerFeedbackPage {
  private readonly api = inject(FeedbackApi);
  private readonly translate = inject(TranslateService);

  readonly tabs: readonly Tab[] = ['inbox', 'NEW', 'ARCHIVED'];
  readonly kinds = FEEDBACK_KINDS;
  readonly tab = signal<Tab>('inbox');
  readonly kind = signal<FeedbackKind | null>(null);
  readonly pageNo = signal(1);
  readonly page = signal<AdminFeedbackPage | null>(null);
  readonly error = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);

  readonly newCount = computed(() => this.api.newCount() ?? 0);
  readonly pages = computed(() => Math.max(1, Math.ceil((this.page()?.total ?? 0) / PAGE_SIZE)));

  constructor() {
    effect(() => {
      const tab = this.tab();
      const kind = this.kind();
      const page = this.pageNo();
      untracked(() => this.load(tab, kind, page));
    });
  }

  setTab(tab: Tab): void {
    if (tab === this.tab()) return;
    this.pageNo.set(1);
    this.tab.set(tab);
  }

  setKind(value: string): void {
    const kind = FEEDBACK_KINDS.find((k) => k === value) ?? null;
    this.pageNo.set(1);
    this.kind.set(kind);
  }

  author(f: AdminFeedback): string {
    if (!f.author) return this.translate.instant('admin.feedback.noAuthor');
    const name = f.author.name || '—';
    return f.author.deleted ? `${name} (${this.translate.instant('admin.feedback.deletedAccount')})` : name;
  }

  /** The account's own ways to reach the customer. */
  contacts(f: AdminFeedback): string {
    const a = f.author;
    if (!a) return '';
    const telegram = a.telegramUserId
      ? this.translate.instant('admin.feedback.telegramId', { id: a.telegramUserId })
      : null;
    return [a.email, a.phone, telegram].filter(Boolean).join(' · ');
  }

  setStatus(f: AdminFeedback, status: FeedbackStatus): void {
    if (this.busyId()) return;
    this.busyId.set(f.id);
    this.error.set(null);
    this.api.setStatus(f.id, status).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.applyUpdate(f, updated);
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        this.error.set(apiErrorMessage(err, this.translate, { network: 'common.networkError' }));
      },
    });
  }

  private load(tab: Tab, kind: FeedbackKind | null, page: number): void {
    this.error.set(null);
    this.api
      .list({
        status: tab === 'inbox' ? undefined : tab,
        kind: kind ?? undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      .subscribe({
        next: (result) => {
          this.page.set(result);
          this.api.setNewCount(result.newCount);
        },
        error: (err: unknown) => {
          this.page.set({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE, newCount: this.newCount() });
          this.error.set(apiErrorMessage(err, this.translate, { network: 'common.networkError' }));
        },
      });
  }

  /**
   * Swaps the card in place, or drops it when it no longer belongs on this
   * tab (archived from the inbox, read on «Непрочитанные»…), and keeps the
   * sidebar badge in step.
   */
  private applyUpdate(before: AdminFeedback, updated: AdminFeedback): void {
    const delta = (updated.status === 'NEW' ? 1 : 0) - (before.status === 'NEW' ? 1 : 0);
    if (delta !== 0) this.api.setNewCount(Math.max(0, this.newCount() + delta));

    const tab = this.tab();
    const stays = tab === 'inbox' ? updated.status !== 'ARCHIVED' : updated.status === tab;
    this.page.update((page) => {
      if (!page) return page;
      if (stays) return { ...page, items: page.items.map((i) => (i.id === updated.id ? updated : i)) };
      return { ...page, items: page.items.filter((i) => i.id !== updated.id), total: Math.max(0, page.total - 1) };
    });
  }
}
