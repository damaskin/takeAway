import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { CustomersApi, type CustomerDetail, type FavouriteProduct } from '../../core/customers/customers.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';

/** A group of favourites under its heading: drinks, food, or neither. */
interface FavouriteGroup {
  title: string;
  kind: FavouriteProduct['kind'];
  items: FavouriteProduct[];
}

/**
 * One customer's history with the brand: totals, what they keep ordering
 * (5 units and more — drinks and food apart when the menu says which),
 * stores, and their latest orders.
 */
@Component({
  selector: 'app-customer-detail',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <section class="cd">
      <a routerLink="/customers" queryParamsHandling="preserve" class="dash-link"
        >← {{ 'admin.customers.back' | translate }}</a
      >

      @if (error(); as e) {
        <p class="dash-error" role="alert">{{ e }}</p>
      } @else if (!customer()) {
        <p class="dash-muted">{{ 'common.loading' | translate }}</p>
      } @else {
        @let c = customer()!;
        <header>
          <h1>{{ c.name || ('admin.customers.noName' | translate) }}</h1>
          <p class="dash-muted">
            {{ contacts(c) || ('admin.customers.noContacts' | translate) }}
          </p>
        </header>

        <div class="cd-tiles">
          <div class="cd-tile">
            <span>{{ 'admin.customers.cols.orders' | translate }}</span>
            <strong>{{ c.orders }}</strong>
            @if (c.cancelledOrders > 0) {
              <em>{{ 'admin.customers.cancelled' | translate: { count: c.cancelledOrders } }}</em>
            }
          </div>
          <div class="cd-tile">
            <span>{{ 'admin.customers.cols.total' | translate }}</span>
            <strong>{{ price(c.totalCents) }}</strong>
          </div>
          <div class="cd-tile">
            <span>{{ 'admin.customers.cols.avgCheck' | translate }}</span>
            <strong>{{ price(c.avgCheckCents) }}</strong>
          </div>
          <div class="cd-tile">
            <span>{{ 'admin.customers.cols.frequency' | translate }}</span>
            <strong>{{ frequency(c.avgDaysBetweenOrders) }}</strong>
          </div>
          <div class="cd-tile">
            <span>{{ 'admin.customers.cols.firstOrder' | translate }}</span>
            <strong class="cd-small">{{ fmt.date(c.firstOrderAt) }}</strong>
          </div>
          <div class="cd-tile">
            <span>{{ 'admin.customers.cols.lastOrder' | translate }}</span>
            <strong class="cd-small">{{ fmt.date(c.lastOrderAt) }}</strong>
            <em>{{ 'admin.churn.daysAgo' | translate: { days: c.daysSinceLastOrder } }}</em>
          </div>
        </div>

        @if (favouriteGroups().length > 0) {
          <article class="dash-card">
            @for (g of favouriteGroups(); track g.title) {
              <div class="cd-fav-group">
                <h2>{{ g.title | translate }}</h2>
                <ul class="cd-favs">
                  @for (f of g.items; track f.name) {
                    <li class="cd-fav" [attr.data-kind]="f.kind">
                      <span>{{ f.name }}</span>
                      <strong>{{ 'admin.customers.favourites.count' | translate: { count: f.quantity } }}</strong>
                    </li>
                  }
                </ul>
              </div>
            }
            <p class="dash-hint">{{ 'admin.customers.favourites.hint' | translate }}</p>
          </article>
        }

        <article class="dash-card">
          <header class="dash-card-head">
            <h2>{{ 'admin.customers.stores' | translate }}</h2>
          </header>
          <ul class="cd-list">
            @for (s of c.stores; track s.storeId) {
              <li>
                <span>{{ s.storeName }}</span>
                <span class="cd-note">{{
                  'admin.customers.storeLine' | translate: { orders: s.orders, amount: price(s.totalCents) }
                }}</span>
              </li>
            }
          </ul>
        </article>

        <article class="dash-card">
          <header class="dash-card-head">
            <h2>{{ 'admin.customers.history' | translate }}</h2>
          </header>
          <div class="cd-table-wrap">
            <table class="cd-table">
              <thead>
                <tr>
                  <th>{{ 'admin.customers.orderCols.code' | translate }}</th>
                  <th>{{ 'admin.customers.orderCols.date' | translate }}</th>
                  <th>{{ 'admin.customers.orderCols.store' | translate }}</th>
                  <th>{{ 'admin.customers.orderCols.status' | translate }}</th>
                  <th class="num">{{ 'admin.customers.orderCols.items' | translate }}</th>
                  <th class="num">{{ 'admin.customers.orderCols.total' | translate }}</th>
                </tr>
              </thead>
              <tbody>
                @for (o of c.recentOrders; track o.id) {
                  <tr [class.cd-dim]="o.status === 'CANCELLED' || o.status === 'EXPIRED'">
                    <td class="cd-code">{{ o.orderCode }}</td>
                    <td>{{ fmt.dateTime(o.createdAt) }}</td>
                    <td>{{ o.storeName }}</td>
                    <td>{{ 'admin.orders.status.' + o.status | translate }}</td>
                    <td class="num">{{ o.itemCount }}</td>
                    <td class="num">{{ fmt.money(o.totalCents, o.currency) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </article>
      }
    </section>
  `,
  styles: [
    DASH_CARD_STYLES,
    `
      .cd {
        padding: clamp(16px, 4vw, 32px);
        display: flex;
        flex-direction: column;
        gap: 16px;
        font-family: var(--font-sans);
      }
      h1 {
        margin: 0 0 4px;
        font-family: var(--font-display);
        font-size: 28px;
        color: var(--color-espresso);
      }
      .cd-tiles {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 12px;
      }
      .cd-tile {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 16px;
        border-radius: 16px;
        border: 1px solid var(--color-border-light);
        background: var(--color-foam);
      }
      .cd-tile span {
        font-size: 11px;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: var(--color-text-tertiary);
      }
      .cd-tile strong {
        font-family: var(--font-display);
        font-size: 22px;
        color: var(--color-espresso);
      }
      .cd-tile .cd-small {
        font-size: 16px;
      }
      .cd-tile em {
        font-style: normal;
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .cd-fav-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .cd-fav-group h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: 16px;
        color: var(--color-espresso);
      }
      .cd-favs {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .cd-fav {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 9999px;
        background: var(--color-surface-variant);
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 500;
      }
      .cd-fav strong {
        font-size: 12px;
        font-weight: 700;
        color: var(--color-text-secondary);
      }
      .cd-fav[data-kind='DRINK'] {
        background: var(--color-caramel-light);
      }
      .cd-fav[data-kind='DRINK'] strong {
        color: var(--color-caramel);
      }
      .cd-fav[data-kind='FOOD'] {
        background: color-mix(in srgb, var(--chart-customers) 16%, transparent);
      }
      .cd-fav[data-kind='FOOD'] strong {
        color: var(--color-positive);
      }
      .cd-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 14px;
      }
      .cd-list li {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 4px 12px;
      }
      .cd-note {
        color: var(--color-text-tertiary);
        font-size: 13px;
      }
      .cd-table-wrap {
        overflow-x: auto;
      }
      .cd-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .cd-table th {
        padding: 8px;
        text-align: left;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: var(--color-text-tertiary);
        border-bottom: 1px solid var(--color-border-light);
        white-space: nowrap;
      }
      .cd-table td {
        padding: 10px 8px;
        border-bottom: 1px solid var(--color-border-light);
        color: var(--color-text-primary);
        white-space: nowrap;
      }
      .cd-table .num {
        text-align: right;
      }
      .cd-code {
        font-family: var(--font-mono);
        font-weight: 700;
      }
      .cd-dim td {
        color: var(--color-text-tertiary);
      }
    `,
  ],
})
export class CustomerDetailPage {
  private readonly api = inject(CustomersApi);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly translate = inject(TranslateService);
  protected readonly fmt = inject(LocaleFormatService);

  /** The `:userId` route param, bound by `withComponentInputBinding`. */
  readonly userId = input<string>();

  readonly customer = signal<CustomerDetail | null>(null);
  readonly error = signal<string | null>(null);

  /** «Любимые напитки», «Любимые блюда», and «Любимое» for what the menu does not say. */
  readonly favouriteGroups = computed<FavouriteGroup[]>(() => {
    const favourites = this.customer()?.favourites ?? [];
    const groups: FavouriteGroup[] = [
      { title: 'admin.customers.favourites.drinks', kind: 'DRINK', items: [] },
      { title: 'admin.customers.favourites.food', kind: 'FOOD', items: [] },
      { title: 'admin.customers.favourites.other', kind: null, items: [] },
    ];
    for (const f of favourites) groups.find((g) => g.kind === f.kind)?.items.push(f);
    return groups.filter((g) => g.items.length > 0);
  });

  constructor() {
    effect(() => {
      const brandId = this.activeBrand.activeId();
      const userId = this.userId();
      if (!brandId || !userId) return;
      untracked(() => {
        this.error.set(null);
        this.customer.set(null);
        this.api.get(userId, brandId).subscribe({
          next: (c) => this.customer.set(c),
          error: (err) =>
            this.error.set(
              apiErrorMessage(err, this.translate, {
                network: 'common.networkError',
                statuses: { 404: 'admin.customers.notFound' },
              }),
            ),
        });
      });
    });
  }

  contacts(c: CustomerDetail): string {
    return [c.phone, c.email].filter((v): v is string => !!v).join(' · ');
  }

  price(cents: number): string {
    return this.fmt.money(cents, this.activeBrand.active()?.currency);
  }

  frequency(days: number | null): string {
    if (days === null) return '—';
    const value = new Intl.NumberFormat(this.fmt.lang(), { maximumFractionDigits: 1 }).format(days);
    return this.translate.instant('admin.customers.everyDays', { days: value });
  }
}
