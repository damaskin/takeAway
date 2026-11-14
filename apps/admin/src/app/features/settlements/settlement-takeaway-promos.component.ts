import { Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import type { BrandTakeawayPromoOrder, BrandTakeawayPromoReport, SettlementReport } from '@takeaway/shared-types';
import type { Subscription } from 'rxjs';

import { apiErrorMessage } from '../../core/http/api-error';
import { SettlementsApi } from '../../core/settlements/settlements.service';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';
import { OVERVIEW_STYLES } from '../../shared/overview/overview.styles';

/**
 * «Акции takeAway» on the settlements page: the brand's promo orders of the
 * period on screen and what takeAway owes for them (docs/takeaway-promos.md
 * §4.2). The summary and the list follow the page's brand, currency and
 * period; «Долг takeAway по акциям» is always now — the figure the
 * platform's debt report shows for this brand.
 *
 * An order's compensation is «начислена» until a settlement takes it in,
 * «во взаиморасчёте» while that settlement waits, and «погашена» once the
 * brand confirmed the settlement «Получено». It reads the report the page
 * loaded, so a settlement fixed, paid or confirmed on the page (a new report)
 * re-reads the statuses too.
 */
@Component({
  selector: 'app-settlement-takeaway-promos',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <article class="dash-card" data-testid="settlement-takeaway-promos" [attr.aria-busy]="loading()">
      <header class="dash-card-head">
        <h2>{{ 'admin.settlements.promos.title' | translate }}</h2>
      </header>
      <p class="dash-hint">{{ 'admin.settlements.promos.hint' | translate }}</p>

      @if (data(); as d) {
        <dl class="stp-summary">
          <div>
            <dt>{{ 'admin.settlements.promos.summary.orders' | translate }}</dt>
            <dd data-testid="stp-orders">{{ d.orders }}</dd>
          </div>
          <div>
            <dt>{{ 'admin.settlements.promos.summary.menuTotal' | translate }}</dt>
            <dd>{{ money(d.menuTotalCents) }}</dd>
          </div>
          <div>
            <dt>{{ 'admin.settlements.promos.summary.paidByGuest' | translate }}</dt>
            <dd>{{ money(d.paidByGuestCents) }}</dd>
          </div>
          <div>
            <dt>{{ 'admin.settlements.promos.summary.accrued' | translate }}</dt>
            <dd data-testid="stp-accrued">{{ money(d.compensationAccruedCents) }}</dd>
          </div>
          <div>
            <dt>{{ 'admin.settlements.promos.summary.repaid' | translate }}</dt>
            <dd>{{ money(d.compensationRepaidCents) }}</dd>
          </div>
          <div class="stp-debt">
            <dt>{{ 'admin.settlements.promos.summary.debt' | translate }}</dt>
            <dd data-testid="stp-debt">{{ money(d.currentDebtCents) }}</dd>
            <span>{{ 'admin.settlements.promos.summary.debtHint' | translate }}</span>
          </div>
        </dl>

        @if (d.items.length === 0) {
          <p class="dash-muted" data-testid="stp-empty">{{ 'admin.settlements.promos.empty' | translate }}</p>
        } @else {
          <div class="ov-table-wrap">
            <table class="ov-table stp-table" data-testid="stp-orders-table">
              <thead>
                <tr>
                  <th scope="col">{{ 'admin.settlements.promos.cols.date' | translate }}</th>
                  <th scope="col">{{ 'admin.settlements.promos.cols.order' | translate }}</th>
                  <th scope="col" class="stp-promo">{{ 'admin.settlements.promos.cols.promo' | translate }}</th>
                  <th scope="col">{{ 'admin.settlements.promos.cols.menuTotal' | translate }}</th>
                  <th scope="col">{{ 'admin.settlements.promos.cols.paidByGuest' | translate }}</th>
                  <th scope="col">{{ 'admin.settlements.promos.cols.compensation' | translate }}</th>
                  <th scope="col">{{ 'admin.settlements.promos.cols.status' | translate }}</th>
                </tr>
              </thead>
              <tbody>
                @for (o of d.items; track o.orderId) {
                  <tr>
                    <td>{{ when(o.settledAt) }}</td>
                    <td class="stp-code">{{ o.orderCode }}</td>
                    <td class="stp-promo">
                      {{ 'admin.settlements.promos.promoName' | translate: { name: o.promoName, percent: o.percent } }}
                    </td>
                    <td>{{ money(o.menuTotalCents) }}</td>
                    <td>{{ money(o.paidByGuestCents) }}</td>
                    <td>{{ money(o.compensationCents) }}</td>
                    <td>
                      <span class="stp-status" [attr.data-status]="o.status">{{ status(o) }}</span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      } @else if (error(); as e) {
        <p class="dash-error">{{ e }}</p>
      } @else {
        <p class="dash-muted">{{ 'admin.settlements.promos.loading' | translate }}</p>
      }
    </article>
  `,
  styles: [
    DASH_CARD_STYLES,
    OVERVIEW_STYLES,
    `
      .stp-summary {
        margin: 0;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px;
      }
      .stp-summary > div {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px 14px;
        border-radius: 14px;
        background: var(--color-cream);
      }
      .stp-summary dt {
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .stp-summary dd {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        color: var(--color-espresso);
        font-variant-numeric: tabular-nums;
      }
      .stp-summary .stp-debt {
        background: var(--color-caramel-light);
      }
      .stp-debt span {
        font-size: 11px;
        color: var(--color-text-secondary);
      }
      .stp-table tbody tr {
        cursor: default;
      }
      .stp-code {
        font-family: var(--font-mono);
      }
      .stp-promo {
        text-align: left !important;
      }
      .stp-status {
        padding: 2px 8px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 700;
        background: color-mix(in srgb, var(--chart-warning) 18%, transparent);
        color: var(--chart-warning);
      }
      .stp-status[data-status='IN_PAYOUT'] {
        background: var(--color-caramel-light);
        color: var(--color-caramel);
      }
      .stp-status[data-status='REPAID'] {
        background: color-mix(in srgb, var(--chart-customers) 18%, transparent);
        color: var(--color-positive);
      }
    `,
  ],
})
export class SettlementTakeawayPromosComponent {
  private readonly api = inject(SettlementsApi);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);

  /** The settlement on screen: its brand, currency and period. */
  readonly report = input.required<SettlementReport>();

  readonly data = signal<BrandTakeawayPromoReport | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private request: Subscription | null = null;

  constructor() {
    effect(() => {
      const report = this.report();
      untracked(() => this.load(report));
    });
    inject(DestroyRef).onDestroy(() => this.request?.unsubscribe());
  }

  money(cents: number): string {
    return this.fmt.money(cents, this.data()?.currency ?? this.report().currency);
  }

  /** «30.10 12:04» on the brand's clock. */
  when(iso: string): string {
    const tz = this.data()?.period.timeZone ?? this.report().period.timeZone;
    return `${this.fmt.shortDay(iso, tz)} ${this.fmt.time(iso, tz)}`;
  }

  /** «начислена», «во взаиморасчёте», «погашена 27.10» (the day the brand confirmed the settlement). */
  status(order: BrandTakeawayPromoOrder): string {
    if (order.status === 'REPAID' && order.repaidAt) {
      const tz = this.data()?.period.timeZone ?? this.report().period.timeZone;
      return this.translate.instant('admin.settlements.promos.status.repaidOn', {
        date: this.fmt.shortDay(order.repaidAt, tz),
      });
    }
    return this.translate.instant(`admin.settlements.promos.status.${order.status}`);
  }

  private load(report: SettlementReport): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    const query = {
      brandId: report.brand.id,
      currency: report.currency,
      from: report.period.from,
      to: report.period.to,
    };
    this.request = this.api.takeawayPromos(query).subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.data.set(null);
        this.error.set(
          apiErrorMessage(err, this.translate, {
            network: 'common.networkError',
            statuses: { 404: 'admin.settlements.promos.loadError', 500: 'admin.settlements.promos.loadError' },
          }),
        );
      },
    });
  }
}
