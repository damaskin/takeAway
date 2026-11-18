import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import type { Subscription } from 'rxjs';

import { AnalyticsApi, type AnalyticsPeriod, type InactiveNow } from '../../core/analytics/analytics.service';
import { AuthStore } from '../../core/auth/auth.store';
import { DEFAULT_INACTIVE_DAYS, INACTIVE_MIN_ORDERS, customersLink } from '../../core/customers/inactive-segment';
import { type AdminRole, canAccess } from '../../core/permissions/permissions';
import { PlanAccess } from '../../core/plans/plan-access.service';
import { InactiveDaysComponent } from '../../shared/inactive-days.component';
import { PlanLockComponent } from '../../shared/plan-lock.component';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';

/**
 * «Неактивные клиенты» on the business home, right under the KPIs: regulars
 * (3+ orders) who have not ordered for N days right now. N is 14 unless
 * picked here — 7 / 14 / 30 / 90 or «Свой…», the same picker as on
 * «Возврат клиентов» and in «Клиенты» (owner, 2026-11-18: one threshold
 * everywhere). With the same N and store the count and the people are those
 * of «Клиенты → Неактивные» and of «Сейчас неактивны» on the win-back tab:
 * one API query behind all three. The dashboard's store and currency apply;
 * its period does not change who is inactive now.
 *
 * The money comes first — what each would have brought by today coming at
 * their usual pace, days away ÷ usual interval × average check — then how
 * many they are. Every plan sees both; PRO also sees the top three, «Все
 * неактивные» (the customers list on the same N and store) and «Возврат
 * клиентов» (the win-back tab on this N, the dashboard's period and store).
 */
@Component({
  selector: 'app-churn-widget',
  standalone: true,
  imports: [RouterLink, TranslatePipe, PlanLockComponent, InactiveDaysComponent],
  template: `
    <article class="dash-card churn">
      <header class="dash-card-head churn-head">
        <h2>{{ 'admin.churn.title' | translate }}</h2>
        <app-inactive-days [(days)]="days" [showLabel]="false" />
      </header>
      <p class="dash-muted">{{ 'admin.churn.definition' | translate: { min: minOrders, days: days() } }}</p>

      <div class="churn-body">
        <div class="churn-figures">
          <div
            class="churn-money"
            [attr.title]="
              ('admin.churn.lostRevenueHint' | translate) + ' ' + ('admin.churn.lostRevenueOneVisit' | translate)
            "
          >
            <span class="churn-label">{{ 'admin.churn.lostRevenue' | translate }}</span>
            <span class="churn-value">{{ stats() ? money(stats()!.lostRevenueCents) : '—' }}</span>
            <span class="churn-note">{{ 'admin.churn.lostRevenueHint' | translate }}</span>
          </div>
          <div>
            <span class="churn-label">{{ 'admin.churn.now' | translate }}</span>
            <span class="churn-value" data-testid="churn-count">{{ stats()?.count ?? '—' }}</span>
          </div>
        </div>

        @if (stats()?.customers; as customers) {
          <div class="churn-side">
            @if (customers.length > 0) {
              <ul class="churn-list">
                @for (c of customers.slice(0, 3); track c.userId) {
                  <li>
                    @if (canSeeCustomers()) {
                      <a [routerLink]="['/customers', c.userId]">{{
                        c.name || c.phone || ('admin.customers.noName' | translate)
                      }}</a>
                    } @else {
                      <span class="churn-name">{{ c.name || c.phone || ('admin.customers.noName' | translate) }}</span>
                    }
                    <span
                      >≈ {{ money(c.lostRevenueCents) }} ·
                      {{ 'admin.churn.daysAgo' | translate: { days: c.daysSinceLastOrder } }}</span
                    >
                  </li>
                }
              </ul>
            }
            <div class="churn-links">
              @if (canSeeAnalytics()) {
                <a routerLink="/analytics" [queryParams]="retentionQuery()" class="churn-cta">{{
                  'admin.churn.toRetention' | translate
                }}</a>
              }
              @if (canSeeCustomers() && plans.has('customers')) {
                <a
                  class="churn-all"
                  [routerLink]="customersQuery().commands"
                  [queryParams]="customersQuery().queryParams"
                  >{{ 'admin.churn.toCustomers' | translate }}</a
                >
              }
            </div>
          </div>
        } @else if (stats() && !plans.has('churnList')) {
          <app-plan-lock feature="churnList" [compact]="true" />
        }
      </div>
      @if (stats()?.activeElsewhere; as elsewhere) {
        @if (elsewhere.count > 0) {
          <p class="churn-elsewhere" role="note" data-testid="churn-active-elsewhere">
            {{ 'admin.churn.activeElsewhere' | translate: { count: elsewhere.count } }}
            {{ 'admin.churn.activeElsewhereStores' | translate }}
            @for (s of elsewhere.stores; track s.storeId; let last = $last) {
              @if (canSeeAnalytics() && plans.has('winBack')) {
                <a routerLink="/analytics" [queryParams]="storeRetentionQuery(s.storeId)" class="churn-store-link">{{
                  'admin.churn.activeElsewhereStore' | translate: { store: s.storeName, count: s.count }
                }}</a>
              } @else {
                <span>{{
                  'admin.churn.activeElsewhereStore' | translate: { store: s.storeName, count: s.count }
                }}</span>
              }
              @if (!last) {
                ·
              }
            }
          </p>
        }
      }
    </article>
  `,
  styles: [
    DASH_CARD_STYLES,
    `
      :host {
        display: block;
      }
      .churn-body {
        display: grid;
        grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
        gap: 16px;
        align-items: start;
      }
      .churn-figures {
        display: grid;
        grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
        gap: 12px;
      }
      .churn-figures > div {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
        padding: 12px 14px;
        border-radius: 14px;
        background: var(--color-cream);
      }
      /* The revenue walking away is the figure to see first. */
      .churn-figures > .churn-money {
        background: color-mix(in srgb, var(--chart-warning) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--chart-warning) 35%, transparent);
      }
      .churn-label {
        font-family: var(--font-sans);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: var(--color-text-tertiary);
      }
      .churn-money .churn-label {
        color: var(--chart-warning);
      }
      .churn-value {
        font-family: var(--font-display);
        font-size: 24px;
        font-weight: 700;
        color: var(--color-espresso);
        /* A large sum with its currency breaks onto a second line rather than
           pushing the tile past the card. */
        overflow-wrap: anywhere;
      }
      .churn-money .churn-value {
        font-size: 30px;
        color: var(--chart-warning);
      }
      .churn-note {
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .churn-head {
        flex-wrap: wrap;
        gap: 8px 12px;
      }
      .churn-side {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
      }
      .churn-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-family: var(--font-sans);
        font-size: 13px;
      }
      .churn-list li {
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }
      .churn-list a,
      .churn-name {
        color: var(--color-text-primary);
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .churn-list span:last-child {
        color: var(--color-text-tertiary);
        white-space: nowrap;
      }
      .churn-links {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 14px;
      }
      .churn-all {
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        color: var(--color-caramel);
      }
      .churn-cta {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        height: 36px;
        padding: 0 16px;
        border-radius: var(--radius-button);
        background: var(--color-caramel);
        color: white;
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        text-decoration: none;
      }
      .churn-elsewhere {
        margin: 12px 0 0;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--color-cream);
        font-family: var(--font-sans);
        font-size: 12px;
        line-height: 1.5;
        color: var(--color-text-secondary);
      }
      .churn-store-link {
        font-weight: 600;
        color: var(--color-caramel);
      }
      @media (max-width: 900px) {
        .churn-body {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 480px) {
        .churn-figures {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class ChurnWidgetComponent {
  private readonly api = inject(AnalyticsApi);
  private readonly fmt = inject(LocaleFormatService);
  private readonly auth = inject(AuthStore);
  readonly plans = inject(PlanAccess);

  readonly brandId = input.required<string>();
  readonly period = input.required<AnalyticsPeriod>();
  readonly currency = input<string | null | undefined>(null);

  readonly minOrders = INACTIVE_MIN_ORDERS;
  /** Days without an order that make a regular inactive: 14 until picked here. */
  readonly days = signal(DEFAULT_INACTIVE_DAYS);
  readonly stats = signal<InactiveNow | null>(null);

  private readonly role = computed(() => this.auth.user()?.role as AdminRole | undefined);
  // The dashboard is open to store managers; analytics and customers are not.
  readonly canSeeAnalytics = computed(() => canAccess(this.role(), 'analytics'));
  readonly canSeeCustomers = computed(() => canAccess(this.role(), 'customers'));

  /** The store and currency of the dashboard; a new period alone does not ask again. */
  private readonly scope = computed(
    () => ({ storeId: this.period().storeId ?? null, currency: this.period().currency ?? null }),
    { equal: (a, b) => a.storeId === b.storeId && a.currency === b.currency },
  );

  /** «Клиенты → Неактивные» on the same days and store: the same people. */
  readonly customersQuery = computed(() => customersLink({ days: this.days(), storeId: this.scope().storeId }));

  /** The win-back tab on this threshold and the dashboard's period and store. */
  readonly retentionQuery = computed(() => {
    const p = this.period();
    return {
      tab: 'retention',
      inactiveDays: this.days(),
      ...(p.from || p.to ? { from: p.from, to: p.to } : { days: p.days }),
      storeId: p.storeId ?? undefined,
    };
  });

  /** The win-back tab on one store: where the regulars who left it show up. */
  storeRetentionQuery(storeId: string) {
    return { ...this.retentionQuery(), storeId };
  }

  private request: Subscription | null = null;

  constructor() {
    effect(() => {
      const brandId = this.brandId();
      const scope = this.scope();
      const days = this.days();
      untracked(() => {
        // A slower answer for the previous choice must not overwrite this one.
        this.request?.unsubscribe();
        this.request = this.api.inactive(brandId, scope, days, 3).subscribe({
          next: (s) => this.stats.set(s),
          error: () => this.stats.set(null),
        });
      });
    });
    inject(DestroyRef).onDestroy(() => this.request?.unsubscribe());
  }

  money(cents: number): string {
    return this.fmt.money(cents, this.currency());
  }
}
