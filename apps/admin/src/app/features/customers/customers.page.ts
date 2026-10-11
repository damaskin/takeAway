import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import { Subject, debounceTime } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import {
  CustomersApi,
  type CustomerPage,
  type CustomerSegment,
  type CustomerSort,
} from '../../core/customers/customers.service';
import {
  DEFAULT_INACTIVE_DAYS,
  INACTIVE_DAYS,
  type InactiveDays,
  campaignLink,
  parseInactiveDays,
} from '../../core/customers/inactive-segment';
import { apiErrorMessage } from '../../core/http/api-error';
import { PlanAccess } from '../../core/plans/plan-access.service';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';

const SEGMENTS: readonly CustomerSegment[] = ['all', 'regular', 'inactive'];

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
 * what they spent, how often they come, where, and what they keep ordering.
 * A row opens the customer's history. Deleted accounts are not listed.
 *
 * Segments — all, regulars (3+ orders), inactive (3+ orders, none for 3, 7
 * or 14 days) — and the store are in the address (`?segment=inactive&days=7
 * &storeId=`): the win-back tab and the dashboard link here, and the way
 * back from a customer keeps the filter.
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

      <div class="cu-segments" role="group" [attr.aria-label]="'admin.customers.segmentLabel' | translate">
        @for (s of segments; track s) {
          <button
            type="button"
            class="cu-pill"
            [class.cu-pill-on]="segment() === s"
            [attr.aria-pressed]="segment() === s"
            (click)="setFilter({ segment: s })"
          >
            {{ 'admin.customers.segments.' + s | translate }}
          </button>
        }
        @if (segment() === 'inactive') {
          <span class="cu-days-label">{{ 'admin.customers.inactiveDays' | translate }}</span>
          @for (d of inactiveDays; track d) {
            <button
              type="button"
              class="cu-pill cu-pill-small"
              [class.cu-pill-on]="days() === d"
              [attr.aria-pressed]="days() === d"
              (click)="setFilter({ days: d })"
            >
              {{ 'admin.churn.window' | translate: { days: d } }}
            </button>
          }
        }
      </div>
      @if (segment() !== 'all') {
        <p class="cu-segment-hint">
          {{ 'admin.customers.segmentHint.' + segment() | translate: { days: days() } }}
          @if (segment() === 'inactive' && plans.has('campaigns')) {
            <a [routerLink]="broadcast().commands" [queryParams]="broadcast().queryParams">{{
              'admin.customers.toBroadcast' | translate
            }}</a>
          }
        </p>
      }

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
        @if (stores().length > 1) {
          <select
            class="cu-input cu-select"
            [attr.aria-label]="'admin.customers.storeFilter' | translate"
            (change)="setFilter({ storeId: $any($event.target).value || null })"
          >
            <option value="" [selected]="!storeId()">{{ 'admin.customers.allStores' | translate }}</option>
            @for (s of stores(); track s.id) {
              <option [value]="s.id" [selected]="storeId() === s.id">{{ s.name }}</option>
            }
          </select>
        }
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
          <p class="dash-muted">
            @if (search()) {
              {{ 'admin.customers.noMatch' | translate }}
            } @else if (segment() === 'inactive') {
              {{ 'admin.customers.emptyInactive' | translate: { days: days() } }}
            } @else if (segment() !== 'all') {
              {{ 'admin.customers.noMatch' | translate }}
            } @else {
              {{ 'admin.customers.empty' | translate }}
            }
          </p>
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
                      <a class="cu-name" [routerLink]="[c.userId]" queryParamsHandling="preserve">{{
                        c.name || ('admin.customers.noName' | translate)
                      }}</a>
                      @if (c.phone) {
                        <div class="cu-note">{{ c.phone }}</div>
                      }
                      @if (c.favouriteProduct; as fav) {
                        <span
                          class="cu-fav"
                          [attr.data-kind]="fav.kind"
                          [title]="'admin.customers.favouriteTitle' | translate: { count: fav.quantity }"
                          >{{ 'admin.customers.favouriteBadge' | translate: { name: fav.name } }}</span
                        >
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
                <a [routerLink]="[c.userId]" queryParamsHandling="preserve" class="cu-card">
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
                  @if (c.favouriteProduct; as fav) {
                    <span class="cu-fav" [attr.data-kind]="fav.kind">{{
                      'admin.customers.favouriteBadge' | translate: { name: fav.name }
                    }}</span>
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
      .cu-segments {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
      }
      .cu-pill {
        height: 32px;
        padding: 0 14px;
        border-radius: 9999px;
        border: 1px solid var(--color-border-light);
        background: var(--color-foam);
        color: var(--color-text-secondary);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .cu-pill-small {
        height: 28px;
        padding: 0 10px;
        font-size: 12px;
      }
      .cu-pill-on {
        background: var(--color-espresso);
        border-color: transparent;
        color: white;
      }
      .cu-days-label {
        margin-left: 8px;
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .cu-segment-hint {
        margin: -6px 0 0;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .cu-segment-hint a {
        margin-left: 8px;
        font-weight: 600;
        color: var(--color-caramel);
      }
      .cu-fav {
        display: inline-block;
        margin-top: 4px;
        padding: 1px 8px;
        border-radius: 9999px;
        background: var(--color-surface-variant);
        color: var(--color-text-secondary);
        font-size: 11px;
        font-weight: 600;
        width: fit-content;
      }
      .cu-fav[data-kind='DRINK'] {
        background: var(--color-caramel-light);
        color: var(--color-caramel);
      }
      .cu-fav[data-kind='FOOD'] {
        background: color-mix(in srgb, var(--chart-customers) 16%, transparent);
        color: var(--color-positive);
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
  private readonly catalog = inject(AdminCatalogApi);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  readonly plans = inject(PlanAccess);
  protected readonly fmt = inject(LocaleFormatService);

  readonly sorts = SORTS;
  readonly segments = SEGMENTS;
  readonly inactiveDays = INACTIVE_DAYS;
  readonly stores = signal<StoreAdminDto[]>([]);

  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap, { requireSync: true });
  readonly segment = computed<CustomerSegment>(() => {
    const raw = this.params().get('segment') as CustomerSegment | null;
    return raw && SEGMENTS.includes(raw) ? raw : 'all';
  });
  readonly days = computed<InactiveDays>(() => parseInactiveDays(this.params().get('days')) ?? DEFAULT_INACTIVE_DAYS);
  readonly storeId = computed(() => this.params().get('storeId'));
  /** The campaign composer on exactly this list. */
  readonly broadcast = computed(() => campaignLink({ days: this.days(), storeId: this.storeId() }));
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
    // Stores for the filter follow the brand picked in the header; another
    // brand's store would only answer 403, so switching brands drops it.
    let previousBrand: string | null = null;
    effect(() => {
      const brandId = this.activeBrand.activeId();
      if (!brandId) return;
      untracked(() => {
        if (previousBrand !== null && previousBrand !== brandId && this.storeId()) this.setFilter({ storeId: null });
        previousBrand = brandId;
        this.catalog.listStores(brandId).subscribe({ next: (list) => this.stores.set(list) });
      });
    });
    effect(() => {
      const brandId = this.activeBrand.activeId();
      const search = this.search();
      const sort = this.sort();
      const page = this.pageNo();
      const segment = this.segment();
      const inactiveDays = this.days();
      const storeId = this.storeId();
      if (!brandId) return;
      untracked(() => {
        this.error.set(null);
        const query = {
          brandId,
          storeId,
          search,
          sort,
          page,
          pageSize: PAGE_SIZE,
          segment,
          inactiveDays: segment === 'inactive' ? inactiveDays : undefined,
        };
        this.api.list(query).subscribe({
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

  /** Segment, days and store live in the address, so links and the way back keep them. */
  setFilter(change: { segment?: CustomerSegment; days?: InactiveDays; storeId?: string | null }): void {
    this.pageNo.set(1);
    const segment = change.segment ?? this.segment();
    void this.router.navigate([], {
      queryParams: {
        segment: segment === 'all' ? null : segment,
        days: segment === 'inactive' ? (change.days ?? this.days()) : null,
        storeId: change.storeId === undefined ? this.storeId() : change.storeId,
      },
      replaceUrl: true,
    });
  }

  setSort(value: string): void {
    if (!SORTS.includes(value as CustomerSort)) return;
    this.pageNo.set(1);
    this.sort.set(value as CustomerSort);
  }

  price(cents: number): string {
    return this.fmt.money(cents, this.activeBrand.active()?.currency);
  }

  /** «раз в 9,5 дн.»; a dash for a single order. */
  frequency(days: number | null): string {
    if (days === null) return '—';
    const value = new Intl.NumberFormat(this.fmt.lang(), { maximumFractionDigits: 1 }).format(days);
    return this.translate.instant('admin.customers.everyDays', { days: value });
  }
}
