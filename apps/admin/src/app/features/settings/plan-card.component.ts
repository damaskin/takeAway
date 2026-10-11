import { Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocalDatePipe } from '@takeaway/i18n';
import {
  ALL_PLAN_FEATURES,
  type BrandPlan,
  DEFAULT_COMMISSION_BPS,
  PLAN_FEATURES,
  planHasFeature,
} from '@takeaway/shared-types';

import { apiErrorMessage } from '../../core/http/api-error';
import { SettingsService } from '../../core/settings/settings.service';

/**
 * The brand's business plan in /settings: the commission, what the plan
 * includes and, on BASIC, what PRO would add. Changing it is the
 * platform's call (there is no payment flow), so the owner presses
 * «Перейти на PRO» — the takeAway team gets the request and calls back —
 * or writes to support; a platform admin gets a link to the brands page.
 */
@Component({
  selector: 'app-plan-card',
  standalone: true,
  imports: [RouterLink, TranslatePipe, LocalDatePipe],
  template: `
    <section id="plan" class="plan">
      <header class="plan-head">
        <div>
          <span class="plan-caption">{{ 'admin.plans.settings.title' | translate }}</span>
          <h2>{{ 'admin.plans.names.' + plan() | translate }}</h2>
        </div>
        <div class="plan-rate">
          <strong>{{ percent() }} %</strong>
          <span>{{ 'admin.plans.settings.commission' | translate }}</span>
        </div>
      </header>
      @if (customRate()) {
        <p class="plan-note">{{ 'admin.plans.settings.customRate' | translate: { percent: defaultPercent() } }}</p>
      }
      <ul class="plan-features">
        @for (f of features; track f) {
          <li [class.plan-off]="!included(f)">
            <span class="plan-mark" aria-hidden="true">{{ included(f) ? '✓' : '·' }}</span>
            <span class="plan-feature">
              <strong>{{ 'admin.plans.features.' + f + '.title' | translate }}</strong>
              @if (!included(f)) {
                <em>{{ 'admin.plans.proBadge' | translate }}</em>
              }
            </span>
          </li>
        }
      </ul>
      @if (plan() === 'BASIC') {
        <div class="plan-upgrade">
          <strong>{{ 'admin.plans.settings.upgradeTitle' | translate: { percent: proPercent } }}</strong>
          @if (requestedAt(); as at) {
            <span class="plan-requested" role="status">{{
              'admin.plans.request.sent' | translate: { date: (at | localDate: 'dateTime') }
            }}</span>
          } @else if (platformAdmin()) {
            <span>{{ 'admin.plans.upsell.how' | translate }}</span>
          } @else {
            <span>{{ 'admin.plans.request.hint' | translate }}</span>
            <div class="plan-actions">
              <button type="button" class="plan-request" [disabled]="requesting()" (click)="requestPro()">
                {{ (requesting() ? 'admin.plans.request.sending' : 'admin.plans.request.cta') | translate }}
              </button>
              <button type="button" class="plan-support" (click)="support.emit()">
                {{ 'admin.support.entry' | translate }}
              </button>
            </div>
          }
          @if (requestError(); as message) {
            <span role="alert" class="plan-error">{{ message }}</span>
          }
        </div>
      }
      @if (platformAdmin()) {
        <a routerLink="/brands" class="plan-link">{{ 'admin.plans.settings.manage' | translate }}</a>
      }
    </section>
  `,
  styles: [
    `
      .plan {
        margin-top: 24px;
        padding: 24px;
        border-radius: var(--radius-card);
        background: var(--color-foam);
        box-shadow: var(--shadow-soft);
        font-family: var(--font-sans);
        display: flex;
        flex-direction: column;
        gap: 16px;
        scroll-margin-top: 16px;
      }
      .plan-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
      }
      .plan-caption {
        font-size: 12px;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: var(--color-text-tertiary);
      }
      h2 {
        margin: 2px 0 0;
        font-family: var(--font-display);
        font-size: 24px;
        color: var(--color-espresso);
      }
      .plan-rate {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
      }
      .plan-rate strong {
        font-family: var(--font-display);
        font-size: 24px;
        color: var(--color-caramel);
      }
      .plan-rate span,
      .plan-note {
        margin: 0;
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .plan-features {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
        gap: 8px 16px;
        font-size: 14px;
      }
      .plan-features li {
        display: flex;
        gap: 8px;
      }
      .plan-mark {
        width: 14px;
        font-weight: 700;
        color: var(--color-mint);
      }
      .plan-feature {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
      }
      .plan-feature strong {
        font-weight: 500;
        color: var(--color-text-primary);
      }
      .plan-off .plan-feature strong,
      .plan-off .plan-mark {
        color: var(--color-text-tertiary);
      }
      .plan-feature em {
        padding: 1px 6px;
        border-radius: 9999px;
        border: 1px solid var(--color-border);
        font-style: normal;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.5px;
        color: var(--color-text-tertiary);
      }
      .plan-upgrade {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 14px 16px;
        border-radius: 14px;
        background: var(--color-caramel-light);
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .plan-upgrade strong {
        font-size: 14px;
        color: var(--color-espresso);
      }
      .plan-link {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-caramel);
      }
      .plan-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 6px;
      }
      .plan-request,
      .plan-support {
        height: 36px;
        padding: 0 16px;
        border-radius: var(--radius-button);
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .plan-request {
        border: 0;
        background: var(--color-espresso);
        color: white;
      }
      .plan-request:disabled {
        opacity: 0.6;
      }
      .plan-support {
        border: 1px solid var(--color-border);
        background: transparent;
        color: var(--color-espresso);
      }
      .plan-requested {
        color: var(--color-text-primary);
        font-weight: 600;
      }
      .plan-error {
        color: var(--color-berry);
      }
    `,
  ],
})
export class PlanCardComponent {
  private readonly settings = inject(SettingsService);
  private readonly translate = inject(TranslateService);

  readonly plan = input.required<BrandPlan>();
  readonly commissionBps = input<number | null | undefined>(null);
  readonly platformAdmin = input(false);
  /** When the owner asked for PRO, if the request still stands. */
  readonly planRequestedAt = input<string | null | undefined>(null);
  /** «Написать в поддержку» from the card: the page opens the dialog. */
  readonly support = output<void>();

  /** The request sent from this card, until the page reloads the brand. */
  private readonly sentAt = signal<string | null>(null);
  readonly requestedAt = computed(() => this.sentAt() ?? this.planRequestedAt() ?? null);
  readonly requesting = signal(false);
  readonly requestError = signal<string | null>(null);

  /** «Перейти на PRO»: the takeAway team gets the request and calls back. */
  requestPro(): void {
    this.requesting.set(true);
    this.requestError.set(null);
    this.settings.requestPlan('PRO').subscribe({
      next: (res) => {
        this.requesting.set(false);
        this.sentAt.set(res.planRequestedAt);
      },
      error: (err) => {
        this.requesting.set(false);
        this.requestError.set(
          apiErrorMessage(err, this.translate, {
            codes: {
              FEEDBACK_TOO_MANY: 'admin.support.tooMany',
              PLAN_ALREADY_ACTIVE: 'admin.plans.request.alreadyActive',
            },
            network: 'common.networkError',
          }),
        );
      },
    });
  }

  readonly features = ALL_PLAN_FEATURES;
  readonly proPercent = DEFAULT_COMMISSION_BPS.PRO / 100;
  readonly defaultPercent = computed(() => DEFAULT_COMMISSION_BPS[this.plan()] / 100);
  readonly percent = computed(() => (this.commissionBps() ?? DEFAULT_COMMISSION_BPS[this.plan()]) / 100);
  readonly customRate = computed(() => this.percent() !== this.defaultPercent());

  included(feature: (typeof PLAN_FEATURES.PRO)[number]): boolean {
    return planHasFeature(this.plan(), feature);
  }
}
