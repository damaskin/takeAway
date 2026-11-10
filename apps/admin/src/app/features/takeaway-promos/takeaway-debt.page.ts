import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import type { TakeawayDebtReport, TakeawayDebtRow } from '@takeaway/shared-types';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { navLink } from '../../core/permissions/permissions';
import { TakeawayPromosApi } from '../../core/takeaway-promos/takeaway-promos.service';
import { KpiCardComponent } from '../../shared/charts/kpi-card.component';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';
import { OVERVIEW_STYLES } from '../../shared/overview/overview.styles';
import { TAKEAWAY_PROMO_STYLES } from './takeaway-promo.styles';

/**
 * «Долг takeAway»: what takeAway owes every brand for its promo orders,
 * now — accrued, already in a fixed payout, repaid — and the total per
 * currency, the money to have ready for the coming payouts. A brand's row
 * leads to its settlements, where the payout that repays it is fixed.
 */
@Component({
  selector: 'app-takeaway-debt',
  standalone: true,
  imports: [TranslatePipe, KpiCardComponent],
  template: `
    <section class="ov" [attr.aria-busy]="loading()">
      @if (debt(); as d) {
        @if (d.totals.length > 0) {
          <div class="tpd-kpis" data-testid="takeaway-debt-totals">
            @for (t of d.totals; track t.currency) {
              <app-kpi-card
                [label]="'admin.takeawayPromos.debt.kpi' | translate: { currency: t.currency }"
                [value]="money(t.debtCents, t.currency)"
                [footLeft]="
                  'admin.takeawayPromos.debt.accrued' | translate: { value: money(t.accruedCents, t.currency) }
                "
                [footRight]="
                  'admin.takeawayPromos.debt.repaid' | translate: { value: money(t.repaidCents, t.currency) }
                "
              />
            }
          </div>
        }

        <article class="dash-card">
          <header class="dash-card-head">
            <h2>{{ 'admin.takeawayPromos.debt.title' | translate }}</h2>
          </header>
          <p class="dash-hint">{{ 'admin.takeawayPromos.debt.hint' | translate }}</p>
          @if (d.rows.length === 0) {
            <p class="dash-muted">{{ 'admin.takeawayPromos.debt.empty' | translate }}</p>
          } @else {
            <div class="ov-table-wrap">
              <table class="ov-table tpd-table" data-testid="takeaway-debt-table">
                <thead>
                  <tr>
                    <th scope="col">{{ 'admin.takeawayPromos.debt.cols.brand' | translate }}</th>
                    <th scope="col">{{ 'admin.takeawayPromos.debt.cols.currency' | translate }}</th>
                    <th scope="col">{{ 'admin.takeawayPromos.debt.cols.accrued' | translate }}</th>
                    <th scope="col">{{ 'admin.takeawayPromos.debt.cols.inPayout' | translate }}</th>
                    <th scope="col">{{ 'admin.takeawayPromos.debt.cols.repaid' | translate }}</th>
                    <th scope="col">{{ 'admin.takeawayPromos.debt.cols.debt' | translate }}</th>
                    <th scope="col">
                      <span class="tpd-sr">{{ 'admin.takeawayPromos.debt.open' | translate }}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of d.rows; track row.brandId + row.currency) {
                    <tr>
                      <td class="ov-name">{{ row.brandName }}</td>
                      <td>{{ row.currency }}</td>
                      <td>{{ money(row.accruedCents, row.currency) }}</td>
                      <td>{{ money(row.inPayoutCents, row.currency) }}</td>
                      <td>{{ money(row.repaidCents, row.currency) }}</td>
                      <td class="tpd-debt">{{ money(row.debtCents, row.currency) }}</td>
                      <td>
                        <button
                          type="button"
                          class="tp-action"
                          [attr.aria-label]="'admin.takeawayPromos.debt.openHint' | translate: { brand: row.brandName }"
                          (click)="openSettlements(row)"
                        >
                          {{ 'admin.takeawayPromos.debt.open' | translate }}
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  @for (t of d.totals; track t.currency) {
                    <tr>
                      <th scope="row">{{ 'admin.takeawayPromos.debt.total' | translate: { currency: t.currency } }}</th>
                      <td>{{ t.currency }}</td>
                      <td>{{ money(t.accruedCents, t.currency) }}</td>
                      <td>{{ money(t.inPayoutCents, t.currency) }}</td>
                      <td>{{ money(t.repaidCents, t.currency) }}</td>
                      <td>{{ money(t.debtCents, t.currency) }}</td>
                      <td></td>
                    </tr>
                  }
                </tfoot>
              </table>
            </div>
          }
        </article>
      } @else if (error(); as e) {
        <article class="dash-card ov-state">
          <p class="dash-error" role="alert">{{ e }}</p>
        </article>
      } @else {
        <article class="dash-card ov-state">
          <p class="dash-muted">{{ 'common.loading' | translate }}</p>
        </article>
      }
    </section>
  `,
  styles: [
    DASH_CARD_STYLES,
    OVERVIEW_STYLES,
    TAKEAWAY_PROMO_STYLES,
    `
      .tpd-kpis {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
      }
      .tpd-table tbody tr {
        cursor: default;
      }
      .tpd-table tfoot th,
      .tpd-table tfoot td {
        padding: 10px;
        font-weight: 700;
        text-align: right;
        white-space: nowrap;
      }
      .tpd-table tfoot th {
        text-align: left;
      }
      .tpd-debt {
        font-weight: 700;
      }
      .tpd-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
    `,
  ],
})
export class TakeawayDebtPage {
  private readonly api = inject(TakeawayPromosApi);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly router = inject(Router);

  readonly debt = signal<TakeawayDebtReport | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    this.loading.set(true);
    this.api.debt().subscribe({
      next: (debt) => {
        this.debt.set(debt);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(
          apiErrorMessage(err, this.translate, {
            network: 'common.networkError',
            statuses: { 500: 'admin.takeawayPromos.debt.loadFailed' },
          }),
        );
      },
    });
  }

  money(cents: number, currency: string): string {
    return this.fmt.money(cents, currency);
  }

  /** The brand's «Расчёты»: the header's brand switches to it, as «Открыть кабинет» does. */
  openSettlements(row: TakeawayDebtRow): void {
    this.activeBrand.select(row.brandId);
    void this.router.navigate([navLink('settlements')]);
  }
}
