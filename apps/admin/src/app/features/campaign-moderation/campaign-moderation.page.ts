import { Component, computed, effect, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocalDatePipe } from '@takeaway/i18n';

import { CampaignModerationApi, type ModerationView } from '../../core/campaigns/campaign-moderation.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { CAMPAIGN_ERROR_WORDING } from '../campaigns/campaign-errors';
import { type ModerationCampaign, campaignStatusTone } from '../campaigns/campaign.types';

/** A decision waiting in the dialog. */
interface Decision {
  campaign: ModerationCampaign;
  kind: 'approve' | 'reject';
}

/**
 * «Модерация рассылок» — every brand's campaigns waiting for the platform
 * team, oldest first. Each card shows the copy the way customers will see
 * it, the channel, the audience and how many people it reaches right now,
 * and when it is meant to go out. Approving sends it at once (or at its
 * time); rejecting asks for the reason the business is shown. The other
 * tabs list the latest decisions.
 */
@Component({
  selector: 'app-campaign-moderation',
  standalone: true,
  imports: [TranslatePipe, LocalDatePipe, ConfirmDialogComponent],
  template: `
    <section class="cm">
      <header>
        <h1>{{ 'admin.campaignModeration.title' | translate }}</h1>
        <p class="cm-sub">{{ 'admin.campaignModeration.subtitle' | translate }}</p>
      </header>

      <div class="cm-tabs" role="tablist">
        @for (t of tabs; track t) {
          <button
            type="button"
            role="tab"
            class="cm-tab"
            [class.cm-tab-active]="view() === t"
            [attr.aria-selected]="view() === t"
            (click)="view.set(t)"
          >
            {{ 'admin.campaignModeration.tabs.' + t | translate }}
            @if (t === 'PENDING_REVIEW' && pendingCount() > 0) {
              · {{ pendingCount() }}
            }
          </button>
        }
      </div>

      @if (loading()) {
        <p class="cm-muted">{{ 'common.loading' | translate }}</p>
      } @else if (items().length === 0) {
        <p class="cm-muted">{{ 'admin.campaignModeration.empty.' + view() | translate }}</p>
      } @else {
        <div class="cm-list">
          @for (c of items(); track c.id) {
            <article class="cm-card">
              <div class="cm-head">
                <div class="cm-brand">
                  @if (c.brand.logoUrl) {
                    <img [src]="c.brand.logoUrl" alt="" class="cm-logo" />
                  }
                  <div>
                    <strong>{{ c.brand.name }}</strong>
                    <span class="cm-muted">
                      @if (c.createdBy) {
                        {{ c.createdBy.name || c.createdBy.email }} ·
                      }
                      {{ 'admin.campaignModeration.submitted' | translate }}
                      {{ c.submittedAt ?? c.createdAt | localDate: 'dateTime' }}
                    </span>
                  </div>
                </div>
                <span class="cm-pill" [attr.data-tone]="tone(c)">{{
                  'admin.campaigns.status.' + c.status | translate
                }}</span>
              </div>

              <!-- The copy as a customer sees it -->
              <div class="cm-preview" [attr.aria-label]="'admin.campaignModeration.previewLabel' | translate">
                <span class="cm-preview-from">{{ c.brand.name }}</span>
                <strong class="cm-preview-title">{{ c.title }}</strong>
                <p class="cm-preview-body">{{ c.body }}</p>
              </div>

              <dl class="cm-facts">
                <div>
                  <dt>{{ 'admin.campaigns.fields.channel' | translate }}</dt>
                  <dd>{{ 'admin.campaigns.channels.' + c.channel | translate }}</dd>
                </div>
                <div>
                  <dt>{{ 'admin.campaigns.fields.audience' | translate }}</dt>
                  <dd>
                    @if (c.audience === 'INACTIVE') {
                      {{ 'admin.campaigns.audienceInactive' | translate: { days: c.inactiveDays ?? 14 } }}
                    } @else {
                      {{ 'admin.campaigns.audiences.' + c.audience | translate }}
                    }
                  </dd>
                </div>
                <div>
                  <dt>{{ 'admin.campaignModeration.when' | translate }}</dt>
                  <dd>
                    @if (c.scheduledAt) {
                      {{ c.scheduledAt | localDate: 'dateTime' }}
                    } @else {
                      {{ 'admin.campaignModeration.whenNow' | translate }}
                    }
                  </dd>
                </div>
                @if (c.reach; as r) {
                  <div>
                    <dt>{{ 'admin.campaignModeration.audienceSize' | translate }}</dt>
                    <dd>
                      {{ 'admin.campaigns.reach.summary' | translate: { reachable: r.reachable, total: r.total } }}
                    </dd>
                  </div>
                } @else if (c.startedAt) {
                  <div>
                    <dt>{{ 'admin.campaigns.col.delivered' | translate }}</dt>
                    <dd>
                      {{ 'admin.campaigns.result.sent' | translate: { sent: c.sentCount, target: c.targetCount } }}
                    </dd>
                  </div>
                }
              </dl>

              @if (c.status === 'REJECTED' && c.reviewNote) {
                <p class="cm-note">{{ 'admin.campaignModeration.reason' | translate }}: {{ c.reviewNote }}</p>
              }
              @if (c.reviewedAt && c.status !== 'PENDING_REVIEW') {
                <p class="cm-muted">
                  {{ 'admin.campaignModeration.decided' | translate }} {{ c.reviewedAt | localDate: 'dateTime' }}
                  @if (c.reviewedBy) {
                    · {{ c.reviewedBy.name || c.reviewedBy.email }}
                  }
                </p>
              }

              @if (c.status === 'PENDING_REVIEW') {
                <div class="cm-actions">
                  <button
                    type="button"
                    class="cm-approve"
                    [disabled]="actingOn() === c.id"
                    (click)="decision.set({ campaign: c, kind: 'approve' })"
                  >
                    {{ 'admin.campaignModeration.approve' | translate }}
                  </button>
                  <button
                    type="button"
                    class="cm-reject"
                    [disabled]="actingOn() === c.id"
                    (click)="decision.set({ campaign: c, kind: 'reject' })"
                  >
                    {{ 'admin.campaignModeration.reject' | translate }}
                  </button>
                </div>
              }
            </article>
          }
        </div>
      }

      @if (error(); as message) {
        <p role="alert" class="cm-error">{{ message }}</p>
      }

      @if (decision(); as d) {
        @if (d.kind === 'approve') {
          <app-confirm-dialog
            [title]="'admin.campaignModeration.dialog.approveTitle' | translate: { brand: d.campaign.brand.name }"
            [body]="
              (d.campaign.scheduledAt
                ? 'admin.campaignModeration.dialog.approveScheduled'
                : 'admin.campaignModeration.dialog.approveNow'
              ) | translate: { time: (d.campaign.scheduledAt | localDate: 'dateTime') }
            "
            [confirmLabel]="'admin.campaignModeration.approve' | translate"
            [cancelLabel]="'common.cancel' | translate"
            [busy]="actingOn() === d.campaign.id"
            (confirmed)="approve(d.campaign)"
            (cancelled)="decision.set(null)"
          />
        } @else {
          <app-confirm-dialog
            tone="danger"
            [title]="'admin.campaignModeration.dialog.rejectTitle' | translate: { brand: d.campaign.brand.name }"
            [body]="'admin.campaignModeration.dialog.rejectBody' | translate"
            [reasonLabel]="'admin.campaignModeration.dialog.reason' | translate"
            [reasonPlaceholder]="'admin.campaignModeration.dialog.reasonPlaceholder' | translate"
            [reasonRequiredText]="'admin.campaignModeration.dialog.reasonRequired' | translate"
            [confirmLabel]="'admin.campaignModeration.reject' | translate"
            [cancelLabel]="'common.cancel' | translate"
            [busy]="actingOn() === d.campaign.id"
            (confirmed)="reject(d.campaign, $event)"
            (cancelled)="decision.set(null)"
          />
        }
      }
    </section>
  `,
  styles: [
    `
      .cm {
        padding: clamp(16px, 3vw, 32px);
        max-width: 1000px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        font-family: var(--font-sans);
      }
      h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: 28px;
        color: var(--color-espresso);
      }
      .cm-sub,
      .cm-muted {
        margin: 4px 0 0;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .cm-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .cm-tab {
        padding: 8px 16px;
        border-radius: 999px;
        border: 1px solid var(--color-border);
        background: var(--color-foam);
        color: var(--color-text-secondary);
        font-size: 14px;
        cursor: pointer;
      }
      .cm-tab-active {
        background: var(--color-caramel);
        border-color: var(--color-caramel);
        color: white;
      }
      .cm-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .cm-card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 20px;
        border-radius: var(--radius-card);
        background: var(--color-foam);
        box-shadow: var(--shadow-soft);
      }
      .cm-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .cm-brand {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .cm-brand > div {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .cm-brand strong {
        font-size: 16px;
        color: var(--color-espresso);
      }
      .cm-logo {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        object-fit: cover;
        background: var(--color-cream);
      }
      .cm-pill {
        padding: 3px 10px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
        background: rgba(120, 120, 120, 0.15);
        color: var(--color-text-secondary);
      }
      .cm-pill[data-tone='ok'] {
        background: rgba(76, 175, 80, 0.15);
        color: var(--color-mint);
      }
      .cm-pill[data-tone='bad'] {
        background: rgba(244, 67, 54, 0.15);
        color: var(--color-berry);
      }
      .cm-pill[data-tone='busy'],
      .cm-pill[data-tone='wait'] {
        background: rgba(255, 152, 0, 0.15);
        color: var(--color-amber);
      }
      .cm-preview {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-width: 420px;
        padding: 12px 14px;
        border-radius: 16px;
        background: var(--color-cream);
        border: 1px solid var(--color-border-light);
      }
      .cm-preview-from {
        font-size: 11px;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: var(--color-text-tertiary);
      }
      .cm-preview-title {
        font-size: 15px;
        color: var(--color-text-primary);
        overflow-wrap: anywhere;
      }
      .cm-preview-body {
        margin: 0;
        font-size: 14px;
        color: var(--color-text-secondary);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .cm-facts {
        display: flex;
        flex-wrap: wrap;
        gap: 12px 24px;
        margin: 0;
        font-size: 13px;
      }
      .cm-facts dt {
        color: var(--color-text-tertiary);
      }
      .cm-facts dd {
        margin: 2px 0 0;
        color: var(--color-text-primary);
      }
      .cm-note {
        margin: 0;
        padding: 8px 12px;
        border-radius: 8px;
        background: var(--color-cream);
        font-size: 13px;
        color: var(--color-text-secondary);
        overflow-wrap: anywhere;
      }
      .cm-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .cm-approve,
      .cm-reject {
        padding: 8px 16px;
        border: 0;
        border-radius: var(--radius-button);
        color: white;
        font-weight: 600;
        cursor: pointer;
      }
      .cm-approve {
        background: var(--color-mint);
      }
      .cm-reject {
        background: var(--color-berry);
      }
      .cm-approve:disabled,
      .cm-reject:disabled {
        opacity: 0.5;
      }
      .cm-error {
        margin: 0;
        font-size: 13px;
        color: var(--color-berry);
      }
    `,
  ],
})
export class CampaignModerationPage {
  private readonly api = inject(CampaignModerationApi);
  private readonly translate = inject(TranslateService);

  readonly tabs: readonly ModerationView[] = ['PENDING_REVIEW', 'APPROVED', 'REJECTED'];
  readonly view = signal<ModerationView>('PENDING_REVIEW');
  readonly items = signal<ModerationCampaign[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly actingOn = signal<string | null>(null);
  readonly decision = signal<Decision | null>(null);
  readonly pendingCount = computed(() => this.api.pendingCount() ?? 0);

  constructor() {
    effect(() => this.load(this.view()));
  }

  tone(c: ModerationCampaign): string {
    return campaignStatusTone(c.status);
  }

  approve(campaign: ModerationCampaign): void {
    this.decide(campaign, this.api.approve(campaign.id));
  }

  reject(campaign: ModerationCampaign, reason: string): void {
    this.decide(campaign, this.api.reject(campaign.id, reason));
  }

  private decide(campaign: ModerationCampaign, request: ReturnType<CampaignModerationApi['approve']>): void {
    this.actingOn.set(campaign.id);
    this.error.set(null);
    request.subscribe({
      next: () => {
        this.actingOn.set(null);
        this.decision.set(null);
        // Decided: it leaves the queue and moves to a history tab.
        this.items.update((list) => list.filter((c) => c.id !== campaign.id));
        if (this.view() === 'PENDING_REVIEW') this.api.setPendingCount(this.items().length);
      },
      error: (err) => {
        this.actingOn.set(null);
        this.decision.set(null);
        this.error.set(apiErrorMessage(err, this.translate, CAMPAIGN_ERROR_WORDING));
        this.load(this.view());
      },
    });
  }

  private load(view: ModerationView): void {
    this.loading.set(true);
    this.api.list(view).subscribe({
      next: (list) => {
        if (this.view() !== view) return;
        this.items.set(list);
        if (view === 'PENDING_REVIEW') this.api.setPendingCount(list.length);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(apiErrorMessage(err, this.translate, CAMPAIGN_ERROR_WORDING));
      },
    });
  }
}
