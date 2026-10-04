import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import { Subject, debounceTime } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { CustomersApi, type CustomerPage, type CustomerSort } from '../../core/customers/customers.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';

const SORTS: readonly CustomerSort[] = [
  'lastOrderAt',
  'totalCents',
  'orders',
  'avgCheckCents',
  'frequency',
  'firstOrderAt',
];
const PAGE_SIZE = 25;

/**
 * The brand's customers (PRO): everyone with an order in its stores, with
 * what they spent, how often they come and where. A row opens the
 * customer's history. Deleted accounts are not listed.
 */
@Component({
  selector: 'app-customers',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <section class="cu">
      <header class="cu-head">
        <div>
          <h1>{{ 'admin.customers.title' | translate }}</h1>
          <p class="dash-muted">{{ 'admin.customers.subtitle' | translate }}</p>
        </div>
      </header>

      <div class="cu-filters">
        <input
          type="search"
          class="cu-input"
          [value]="search()"
          [placeholder]="'admin.customers.search' | translate"
          [attr.aria-label]="'admin.customers.search' | translate"
          (input)="onSearch($any($event.target).value)"
        />
        <select
          class="cu-input cu-select"
          [attr.aria-label]="'admin.customers.sortLabel' | translate"
          (change)="setSort($any($event.target).value)"
        >
          @for (s of sorts; track s) {
            <option [value]="s" [selected]="sort() === s">{{ 'admin.customers.sort.' + s | translate }}</option>
          }
        </select>
      </div>

      @if (error(); as e) {
        <p class="dash-error" role="alert">{{ e }}</p>
      }

      <article class="dash-card">
        <header class="dash-card-head">
          <h2>{{ 'admin.customers.count' | translate: { count: page()?.total ?? 0 } }}</h2>
        </header>
        @if (!page()) {
          <p class="dash-muted">{{ 'common.loading' | translate }}</p>
        } @else if (page()!.items.length === 0) {
          <p class="dash-muted">{{ (search() ? 'admin.customers.noMatch' : 'admin.customers.empty') | translate }}</p>
        } @else {
          <div class="cu-table-wrap">
            <table class="cu-table">
              <thead>
                <tr>
                  <th>{{ 'admin.customers.cols.customer' | translate }}</th>
                  <th class="num">{{ 'admin.customers.cols.orders' | translate }}</th>
                  <th class="num">{{ 'admin.customers.cols.total' | translate }}</th>
                  <th class="num">{{ 'admin.customers.cols.avgCheck' | translate }}</th>
                  <th class="num">{{ 'admin.customers.cols.frequency' | translate }}</th>
                  <th class="num">{{ 'admin.customers.cols.firstOrder' | translate }}</th>
                  <th class="num">{{ 'admin.customers.cols.lastOrder' | translate }}</th>
                  <th>{{ 'admin.customers.cols.favouriteStore' | translate }}</th>
                </tr>
              </thead>
              <tbody>
                @for (c of page()!.items; track c.userId) {
                  <tr>
                    <td>
                      <a class="cu-name" [routerLink]="[c.userId]">{{
                        c.name || ('admin.customers.noName' | translate)
                      }}</a>
                      @if (c.phone) {
                        <div class="cu-note">{{ c.phone }}</div>
                      }
                    </td>
                    <td class="num">{{ c.orders }}</td>
                    <td class="num">{{ price(c.totalCents) }}</td>
                    <td class="num">{{ price(c.avgCheckCents) }}</td>
                    <td class="num">{{ frequency(c.avgDaysBetweenOrders) }}</td>
                    <td class="num">{{ fmt.date(c.firstOrderAt) }}</td>
                    <td class="num">
                      {{ fmt.date(c.lastOrderAt) }}
                      <div class="cu-note">{{ 'admin.churn.daysAgo' | translate: { days: c.daysSinceLastOrder } }}</div>
                    </td>
                    <td>{{ c.favouriteStoreName ?? '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- Phones get cards instead of a wide table. -->
          <ul class="cu-cards">
            @for (c of page()!.items; track c.userId) {
              <li>
                <a [routerLink]="[c.userId]" class="cu-card">
                  <div class="cu-card-top">
                    <span class="cu-name">{{ c.name || c.phone || ('admin.customers.noName' | translate) }}</span>
                    <span class="cu-card-total">{{ price(c.totalCents) }}</span>
                  </div>
                  <span class="cu-note">{{
                    'admin.customers.cardLine'
                      | translate
                        : {
                            orders: c.orders,
                            check: price(c.avgCheckCents),
                            days: c.daysSinceLastOrder,
                          }
                  }}</span>
                  @if (c.favouriteStoreName) {
                    <span class="cu-note">{{ c.favouriteStoreName }}</span>
                  }
                </a>
              </li>
            }
          </ul>

          @if (pages() > 1) {
            <nav class="cu-pager" [attr.aria-label]="'admin.customers.pager' | translate">
              <button type="button" [disabled]="pageNo() <= 1" (click)="pageNo.set(pageNo() - 1)">←</button>
              <span>{{ 'admin.customers.pageOf' | translate: { page: pageNo(), pages: pages() } }}</span>
              <button type="button" [disabled]="pageNo() >= pages()" (click)="pageNo.set(pageNo() + 1)">→</button>
            </nav>
          }
        }
      </article>
    </section>
  `,
  styles: [
    DASH_CARD_STYLES,
    `
      .cu {
        padding: clamp(16px, 4vw, 32px);
        display: flex;
        flex-direction: column;
        gap: 16px;
        font-family: var(--font-sans);
      }
      .cu-head h1 {
        margin: 0 0 4px;
        font-family: var(--font-display);
        font-size: 28px;
        color: var(--color-espresso);
      }
      .cu-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .cu-input {
        height: 40px;
        padding: 0 12px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        background: var(--color-foam);
        font-family: var(--font-sans);
        font-size: 14px;
        color: var(--color-text-primary);
        flex: 1 1 240px;
        min-width: 0;
      }
      .cu-select {
        flex: 0 1 240px;
      }
      .cu-table-wrap {
        overflow-x: auto;
      }
      .cu-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .cu-table th {
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
      .cu-table td {
        padding: 10px 8px;
        border-bottom: 1px solid var(--color-border-light);
        color: var(--color-text-primary);
        vertical-align: top;
      }
      .cu-table .num {
        text-align: right;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .cu-name {
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .cu-note {
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .cu-cards {
        display: none;
        list-style: none;
        margin: 0;
        padding: 0;
        flex-direction: column;
        gap: 8px;
      }
      .cu-card {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px 14px;
        border: 1px solid var(--color-border-light);
        border-radius: 14px;
        text-decoration: none;
      }
      .cu-card-top {
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }
      .cu-card-total {
        font-weight: 700;
        color: var(--color-caramel);
        white-space: nowrap;
      }
      .cu-pager {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .cu-pager button {
        width: 36px;
        height: 32px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-button);
        background: var(--color-foam);
        cursor: pointer;
      }
      .cu-pager button:disabled {
        opacity: 0.4;
        cursor: default;
      }
      @media (max-width: 720px) {
        .cu-table-wrap {
          display: none;
        }
        .cu-cards {
          display: flex;
        }
      }
    `,
  ],
})
export class CustomersPage {
  private readonly api = inject(CustomersApi);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly translate = inject(TranslateService);
  protected readonly fmt = inject(LocaleFormatService);

  readonly sorts = SORTS;
  readonly search = signal('');
  readonly sort = signal<CustomerSort>('lastOrderAt');
  readonly pageNo = signal(1);
  readonly page = signal<CustomerPage | null>(null);
  readonly error = signal<string | null>(null);
  readonly pages = computed(() => Math.max(1, Math.ceil((this.page()?.total ?? 0) / PAGE_SIZE)));

  private readonly typed = new Subject<string>();

  constructor() {
    this.typed.pipe(debounceTime(300), takeUntilDestroyed()).subscribe((value) => {
      this.pageNo.set(1);
      this.search.set(value.trim());
    });
    effect(() => {
      const brandId = this.activeBrand.activeId();
      const search = this.search();
      const sort = this.sort();
      const page = this.pageNo();
      if (!brandId) return;
      untracked(() => {
        this.error.set(null);
        this.api.list({ brandId, search, sort, page, pageSize: PAGE_SIZE }).subscribe({
          next: (result) => this.page.set(result),
          error: (err) => {
            this.page.set({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE });
            this.error.set(apiErrorMessage(err, this.translate, { network: 'common.networkError' }));
          },
        });
      });
    });
  }

  onSearch(value: string): void {
    this.typed.next(value);
  }

  setSort(value: string): void {
    if (!SORTS.includes(value as CustomerSort)) return;
    this.pageNo.set(1);
    this.sort.set(value as CustomerSort);
  }

  price(cents: number): string {
    return this.fmt.money(cents, this.activeBrand.active()?.currency, { round: true });
  }

  /** «раз в 9,5 дн.»; a dash for a single order. */
  frequency(days: number | null): string {
    if (days === null) return '—';
    const value = new Intl.NumberFormat(this.fmt.lang(), { maximumFractionDigits: 1 }).format(days);
    return this.translate.instant('admin.customers.everyDays', { days: value });
  }
}
