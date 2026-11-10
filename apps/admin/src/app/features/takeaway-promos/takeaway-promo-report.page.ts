import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import type { TakeawayPromoReport } from '@takeaway/shared-types';

import { apiErrorMessage } from '../../core/http/api-error';
import { navLink } from '../../core/permissions/permissions';
import { TakeawayPromosApi } from '../../core/takeaway-promos/takeaway-promos.service';
import { KpiCardComponent } from '../../shared/charts/kpi-card.component';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';
import { OVERVIEW_STYLES } from '../../shared/overview/overview.styles';
import { TAKEAWAY_PROMO_STYLES } from './takeaway-promo.styles';

/**
 * «Отчёт» of one takeAway promo: orders and customers, the budget, what is
 * spent and left, and where the money went — by brand, by venue, by day.
 * Only counted orders (paid or accepted) are in the tables; `spentCents`
 * also holds the orders still waiting for their payment, so the tile says
 * how much of it that is.
 */
@Component({
  selector: 'app-takeaway-promo-report',
  standalone: true,
  imports: [RouterLink, TranslatePipe, KpiCardComponent],
  template: `
    <section class="ov" [attr.aria-busy]="loading()">
      <a [routerLink]="list" class="tpr-back">
        <span aria-hidden="true">←</span> {{ 'admin.takeawayPromos.title' | translate }}
      </a>

      @if (report(); as r) {
        <header class="tpr-head">
          <h1>
            {{ 'admin.takeawayPromos.report.title' | translate: { name: r.promo.name } }}
            @if (r.promo.isWelcome) {
              <span class="tp-badge">{{ 'admin.takeawayPromos.welcomeBadge' | translate }}</span>
            }
          </h1>
          <p class="tpr-sub">
            {{
              'admin.takeawayPromos.report.subtitle'
                | translate
                  : {
                      code: r.promo.code,
                      percent: r.promo.percent,
                      from: fmt.date(r.promo.startsAt),
                      to: fmt.date(r.promo.endsAt),
                      currency: r.promo.currency,
                    }
            }}
            <span class="tp-status" [attr.data-status]="r.promo.effectiveStatus">{{
              'admin.takeawayPromos.status.' + r.promo.effectiveStatus | translate
            }}</span>
          </p>
          <p class="dash-hint">{{ 'admin.takeawayPromos.report.hint' | translate }}</p>
        </header>

        <div class="tpr-kpis" data-testid="takeaway-promo-kpis">
          <app-kpi-card
            size="sm"
            [label]="'admin.takeawayPromos.report.kpi.orders' | translate"
            [value]="'' + r.orders"
            [footLeft]="'admin.takeawayPromos.report.foot.menuTotal' | translate: { value: money(r.menuTotalCents) }"
          />
          <app-kpi-card
            size="sm"
            [label]="'admin.takeawayPromos.report.kpi.customers' | translate"
            [value]="'' + r.customers"
          />
          <app-kpi-card
            size="sm"
            [label]="'admin.takeawayPromos.report.kpi.budget' | translate"
            [value]="money(r.promo.budgetCents)"
          />
          <app-kpi-card
            size="sm"
            [label]="'admin.takeawayPromos.report.kpi.spent' | translate"
            [value]="money(r.promo.spentCents)"
            [footLeft]="'admin.takeawayPromos.report.foot.compensation' | translate: { value: money(r.discountCents) }"
            [footRight]="held() ? ('admin.takeawayPromos.report.foot.held' | translate: { value: money(held()) }) : ''"
          />
          <app-kpi-card
            size="sm"
            [label]="'admin.takeawayPromos.report.kpi.left' | translate"
            [value]="money(r.promo.leftCents)"
          />
        </div>

        @if (r.orders === 0) {
          <article class="dash-card ov-state">
            <p class="dash-muted">{{ 'admin.takeawayPromos.report.empty' | translate }}</p>
          </article>
        } @else {
          <article class="dash-card">
            <header class="dash-card-head">
              <h2>{{ 'admin.takeawayPromos.report.byBrand' | translate }}</h2>
            </header>
            <div class="ov-table-wrap">
              <table class="ov-table tpr-table" data-testid="takeaway-promo-by-brand">
                <thead>
                  <tr>
                    <th scope="col">{{ 'admin.takeawayPromos.report.cols.brand' | translate }}</th>
                    <th scope="col">{{ 'admin.takeawayPromos.report.cols.orders' | translate }}</th>
                    <th scope="col">{{ 'admin.takeawayPromos.report.cols.menuTotal' | translate }}</th>
                    <th scope="col">{{ 'admin.takeawayPromos.report.cols.compensation' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (b of r.byBrand; track b.brandId) {
                    <tr>
                      <td class="ov-name">{{ b.brandName }}</td>
                      <td>{{ b.orders }}</td>
                      <td>{{ money(b.menuTotalCents) }}</td>
                      <td>{{ money(b.discountCents) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </article>

          <div class="ov-panels">
            <article class="dash-card">
              <header class="dash-card-head">
                <h2>{{ 'admin.takeawayPromos.report.byStore' | translate }}</h2>
              </header>
              <div class="ov-table-wrap">
                <table class="ov-table tpr-table" data-testid="takeaway-promo-by-store">
                  <thead>
                    <tr>
                      <th scope="col">{{ 'admin.takeawayPromos.report.cols.store' | translate }}</th>
                      <th scope="col">{{ 'admin.takeawayPromos.report.cols.orders' | translate }}</th>
                      <th scope="col">{{ 'admin.takeawayPromos.report.cols.menuTotal' | translate }}</th>
                      <th scope="col">{{ 'admin.takeawayPromos.report.cols.compensation' | translate }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (s of r.byStore; track s.storeId) {
                      <tr>
                        <td class="ov-name">
                          {{ s.storeName }}
                          <span class="ov-sub">{{ s.brandName }}</span>
                        </td>
                        <td>{{ s.orders }}</td>
                        <td>{{ money(s.menuTotalCents) }}</td>
                        <td>{{ money(s.discountCents) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </article>
            <article class="dash-card">
              <header class="dash-card-head">
                <h2>{{ 'admin.takeawayPromos.report.byDay' | translate }}</h2>
              </header>
              <div class="ov-table-wrap">
                <table class="ov-table tpr-table" data-testid="takeaway-promo-by-day">
                  <thead>
                    <tr>
                      <th scope="col">{{ 'admin.takeawayPromos.report.cols.date' | translate }}</th>
                      <th scope="col">{{ 'admin.takeawayPromos.report.cols.orders' | translate }}</th>
                      <th scope="col">{{ 'admin.takeawayPromos.report.cols.compensation' | translate }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (d of r.byDay; track d.date) {
                      <tr>
                        <td>{{ day(d.date) }}</td>
                        <td>{{ d.orders }}</td>
                        <td>{{ money(d.discountCents) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        }
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
      .tpr-back {
        width: fit-content;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-secondary);
        text-decoration: none;
      }
      .tpr-head h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: 26px;
        color: var(--color-espresso);
      }
      .tpr-sub {
        margin: 6px 0 4px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .tpr-kpis {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }
      .tpr-table tbody tr {
        cursor: default;
      }
    `,
  ],
})
export class TakeawayPromoReportPage {
  private readonly api = inject(TakeawayPromosApi);
  private readonly translate = inject(TranslateService);
  readonly fmt = inject(LocaleFormatService);

  /** The `:promoId` route param. */
  readonly promoId = input.required<string>();

  readonly list = navLink('takeawayPromos');
  readonly report = signal<TakeawayPromoReport | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Discounts held by orders still waiting for their payment: spent, not counted yet. */
  readonly held = computed(() => {
    const r = this.report();
    return r ? Math.max(0, r.promo.spentCents - r.discountCents) : 0;
  });

  constructor() {
    effect(() => {
      const id = this.promoId();
      untracked(() => this.load(id));
    });
  }

  money(cents: number): string {
    return this.fmt.money(cents, this.report()?.promo.currency);
  }

  /** A UTC calendar day, `YYYY-MM-DD`. */
  day(value: string): string {
    return this.fmt.date(`${value}T00:00:00Z`, 'UTC');
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.report(id).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(
          apiErrorMessage(err, this.translate, {
            network: 'common.networkError',
            statuses: { 404: 'admin.takeawayPromos.report.loadFailed' },
          }),
        );
      },
    });
  }
}
