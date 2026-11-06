import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocalDatePipe, LocaleFormatService } from '@takeaway/i18n';
import { ORDER_REVIEW_RATINGS, type AdminOrderReview, type AdminOrderReviewPage } from '@takeaway/shared-types';
import { formatPhone } from '@takeaway/utils';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { AdminOrderReviewsApi } from '../../core/order-reviews/order-reviews.service';
import { OrderDetailPanelComponent } from '../orders/order-detail-panel.component';

const PAGE_SIZE = 20;

/** The period filter: everything, or the last N days counted from the start of today. */
export const REVIEW_PERIODS = ['all', 'd7', 'd30', 'd90'] as const;
export type ReviewPeriod = (typeof REVIEW_PERIODS)[number];

const PERIOD_DAYS: Record<Exclude<ReviewPeriod, 'all'>, number> = { d7: 7, d30: 30, d90: 90 };

/** Stars from five down, the way the rating chips read. */
const RATINGS_DESC = [...ORDER_REVIEW_RATINGS].reverse();

/**
 * «Отзывы» — what customers say about their orders once handed over (stars
 * and a comment from the order page on the site, in the Mini App and in the
 * app). The platform team reads them here to improve the product; brands
 * never see them. SUPER_ADMIN only.
 *
 * Newest first, filtered by brand, rating and period, with the average and
 * the count of the brand and period on top. The brand filter starts on every
 * brand and follows the brand picked in the top bar while the page is open.
 * The order number opens the order's detail panel.
 */
@Component({
  selector: 'app-admin-order-reviews',
  standalone: true,
  imports: [LocalDatePipe, TranslatePipe, OrderDetailPanelComponent],
  template: `
    <section class="rv">
      <header>
        <h1>{{ 'admin.reviews.title' | translate }}</h1>
        <p class="rv-sub">{{ 'admin.reviews.subtitle' | translate }}</p>
      </header>

      <div class="rv-bar">
        <label class="rv-select">
          <span>{{ 'admin.reviews.brandFilter' | translate }}</span>
          <select data-testid="reviews-brand" (change)="setBrand($any($event.target).value)">
            <option value="" [selected]="!brandId()">{{ 'admin.reviews.allBrands' | translate }}</option>
            @for (b of brands(); track b.id) {
              <option [value]="b.id" [selected]="brandId() === b.id">{{ b.name }}</option>
            }
          </select>
        </label>
        <label class="rv-select">
          <span>{{ 'admin.reviews.periodFilter' | translate }}</span>
          <select data-testid="reviews-period" (change)="setPeriod($any($event.target).value)">
            @for (p of periods; track p) {
              <option [value]="p" [selected]="period() === p">{{ 'admin.reviews.periods.' + p | translate }}</option>
            }
          </select>
        </label>
      </div>

      @if (page(); as pg) {
        <div class="rv-summary" data-testid="reviews-summary">
          <div class="rv-average">
            @if (pg.averageRating !== null) {
              <span class="rv-average-num" data-testid="reviews-average">{{ average(pg.averageRating) }}</span>
              <span class="rv-average-star" aria-hidden="true">★</span>
            } @else {
              <span class="rv-muted">{{ 'admin.reviews.noRatings' | translate }}</span>
            }
          </div>
          <div class="rv-average-text">
            <span>{{ 'admin.reviews.average' | translate }}</span>
            <span data-testid="reviews-count">{{ 'admin.reviews.count' | translate: { count: pg.count } }}</span>
          </div>
        </div>

        <div class="rv-chips" role="group" [attr.aria-label]="'admin.reviews.ratingFilter' | translate">
          <button
            type="button"
            class="rv-chip"
            [class.rv-chip-on]="rating() === null"
            [attr.aria-pressed]="rating() === null"
            (click)="setRating(null)"
          >
            {{ 'admin.reviews.allRatings' | translate }}
          </button>
          @for (r of ratingsDesc; track r) {
            <button
              type="button"
              class="rv-chip"
              [attr.data-testid]="'reviews-rating-' + r"
              [class.rv-chip-on]="rating() === r"
              [attr.aria-pressed]="rating() === r"
              (click)="setRating(r)"
            >
              {{ 'admin.reviews.ratingChip' | translate: { rating: r, count: countFor(pg, r) } }}
            </button>
          }
        </div>
      }

      @if (error()) {
        <p class="rv-error" role="alert">{{ error() }}</p>
      }

      @if (!page()) {
        <p class="rv-muted">{{ 'common.loading' | translate }}</p>
      } @else if (page()!.items.length === 0) {
        <p class="rv-muted" data-testid="reviews-empty">
          {{ (filtered() ? 'admin.reviews.emptyFiltered' : 'admin.reviews.empty') | translate }}
        </p>
      } @else {
        <div class="rv-list">
          @for (r of page()!.items; track r.id) {
            <article class="rv-card" data-testid="review" [attr.data-rating]="r.rating">
              <div class="rv-head">
                <span
                  class="rv-stars"
                  role="img"
                  [attr.aria-label]="'admin.reviews.stars' | translate: { rating: r.rating }"
                >
                  @for (s of stars; track s) {
                    <span aria-hidden="true" [class.rv-star-off]="s > r.rating">★</span>
                  }
                </span>
                <span class="rv-meta">{{ r.createdAt | localDate: 'dateTime' }} · {{ r.brand.name }} · {{ r.store.name }}</span>
              </div>

              @if (r.comment) {
                <p class="rv-comment">{{ r.comment }}</p>
              } @else {
                <p class="rv-comment rv-muted">{{ 'admin.reviews.noComment' | translate }}</p>
              }

              <div class="rv-foot">
                <button
                  type="button"
                  class="rv-order"
                  [attr.data-testid]="'review-order-' + r.orderCode"
                  [attr.aria-label]="'admin.reviews.openOrderLabel' | translate: { code: r.orderCode }"
                  (click)="openOrderId.set(r.orderId)"
                >
                  {{ 'admin.reviews.openOrder' | translate: { code: r.orderCode } }}
                </button>
                <span class="rv-who">
                  <span class="rv-who-name">{{ customer(r) }}</span>
                  @if (contacts(r); as line) {
                    <span class="rv-who-contacts">{{ line }}</span>
                  }
                </span>
              </div>
            </article>
          }
        </div>

        @if (pages() > 1) {
          <nav class="rv-pager" [attr.aria-label]="'admin.reviews.pager' | translate">
            <button type="button" [disabled]="pageNo() <= 1" (click)="pageNo.set(pageNo() - 1)">←</button>
            <span>{{ 'admin.reviews.pageOf' | translate: { page: pageNo(), pages: pages() } }}</span>
            <button type="button" [disabled]="pageNo() >= pages()" (click)="pageNo.set(pageNo() + 1)">→</button>
          </nav>
        }
      }
    </section>

    @if (openOrderId(); as id) {
      <app-order-detail-panel [orderId]="id" (closed)="openOrderId.set(null)" />
    }
  `,
  styles: [
    `
      .rv {
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
      .rv-sub {
        font-size: 14px;
        color: var(--color-text-secondary);
        margin: 4px 0 0;
      }
      .rv-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }
      .rv-select {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .rv-select select {
        height: 36px;
        padding: 0 10px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        background: var(--color-foam);
        color: var(--color-text-primary);
        font-family: var(--font-sans);
        font-size: 14px;
        max-width: 240px;
      }
      .rv-summary {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 16px 20px;
        background: var(--color-foam);
        border-radius: var(--radius-card);
        box-shadow: var(--shadow-soft);
      }
      .rv-average {
        display: flex;
        align-items: baseline;
        gap: 4px;
      }
      .rv-average-num {
        font-family: var(--font-display);
        font-size: 40px;
        font-weight: 700;
        line-height: 1;
        color: var(--color-espresso);
      }
      .rv-average-star {
        font-size: 28px;
        color: var(--color-caramel);
      }
      .rv-average-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .rv-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .rv-chip {
        padding: 6px 14px;
        border-radius: 999px;
        border: 1px solid var(--color-border);
        background: var(--color-foam);
        color: var(--color-text-secondary);
        font-size: 13px;
        cursor: pointer;
      }
      .rv-chip-on {
        background: var(--color-caramel);
        border-color: var(--color-caramel);
        color: white;
      }
      .rv-muted {
        color: var(--color-text-secondary);
        margin: 0;
      }
      .rv-error {
        color: var(--color-berry);
        margin: 0;
      }
      .rv-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .rv-card {
        background: var(--color-foam);
        border-radius: var(--radius-card);
        padding: 18px 20px;
        box-shadow: var(--shadow-soft);
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .rv-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 12px;
      }
      .rv-stars {
        font-size: 18px;
        letter-spacing: 1px;
        color: var(--color-caramel);
      }
      .rv-star-off {
        color: var(--color-border);
      }
      .rv-meta {
        margin-left: auto;
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .rv-comment {
        margin: 0;
        font-size: 15px;
        line-height: 1.5;
        color: var(--color-text-primary);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .rv-comment.rv-muted {
        font-size: 13px;
        color: var(--color-text-tertiary);
      }
      .rv-foot {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 16px;
        font-size: 13px;
      }
      .rv-order {
        padding: 4px 12px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-button);
        background: transparent;
        color: var(--color-caramel);
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .rv-who {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 8px;
        min-width: 0;
      }
      .rv-who-name {
        color: var(--color-text-primary);
        font-weight: 600;
      }
      .rv-who-contacts {
        color: var(--color-text-secondary);
        overflow-wrap: anywhere;
        user-select: all;
      }
      .rv-pager {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .rv-pager button {
        width: 36px;
        height: 32px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-button);
        background: var(--color-foam);
        cursor: pointer;
      }
      .rv-pager button:disabled {
        opacity: 0.4;
      }
    `,
  ],
})
export class OrderReviewsPage {
  private readonly api = inject(AdminOrderReviewsApi);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);
  private readonly activeBrand = inject(ActiveBrandService);

  readonly periods = REVIEW_PERIODS;
  readonly stars = ORDER_REVIEW_RATINGS;
  readonly ratingsDesc = RATINGS_DESC;

  readonly brands = this.activeBrand.brands;
  /** Null: every brand. */
  readonly brandId = signal<string | null>(null);
  readonly rating = signal<number | null>(null);
  readonly period = signal<ReviewPeriod>('all');
  readonly pageNo = signal(1);
  readonly page = signal<AdminOrderReviewPage | null>(null);
  readonly error = signal<string | null>(null);
  /** The order whose detail panel is open. */
  readonly openOrderId = signal<string | null>(null);

  readonly pages = computed(() => Math.max(1, Math.ceil((this.page()?.total ?? 0) / PAGE_SIZE)));
  readonly filtered = computed(() => this.brandId() !== null || this.rating() !== null || this.period() !== 'all');

  /** The top bar's brand once the brand list is in; undefined until then. */
  private followedBrand: string | null | undefined = undefined;

  constructor() {
    effect(() => {
      const brandId = this.brandId();
      const rating = this.rating();
      const period = this.period();
      const page = this.pageNo();
      untracked(() => this.load(brandId, rating, period, page));
    });

    // Picking a brand in the top bar while the page is open narrows the list
    // to it. The brand the bar shows when the page opens does not: the page
    // starts on every brand.
    effect(() => {
      const loaded = this.activeBrand.loaded();
      const active = this.activeBrand.activeId();
      if (!loaded) return;
      if (this.followedBrand === undefined) {
        this.followedBrand = active;
        return;
      }
      if (active === this.followedBrand) return;
      this.followedBrand = active;
      untracked(() => this.setBrand(active ?? ''));
    });
  }

  setBrand(value: string): void {
    const brandId = value || null;
    if (brandId === this.brandId()) return;
    this.pageNo.set(1);
    this.brandId.set(brandId);
  }

  setPeriod(value: string): void {
    const period = REVIEW_PERIODS.find((p) => p === value) ?? 'all';
    this.pageNo.set(1);
    this.period.set(period);
  }

  setRating(rating: number | null): void {
    if (rating === this.rating()) return;
    this.pageNo.set(1);
    this.rating.set(rating);
  }

  /** «4,6» — one decimal in the UI language. */
  average(value: number): string {
    return new Intl.NumberFormat(this.fmt.lang(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
      value,
    );
  }

  countFor(page: AdminOrderReviewPage, rating: number): number {
    return page.ratingCounts[String(rating) as keyof AdminOrderReviewPage['ratingCounts']] ?? 0;
  }

  /** The customer's name, «аккаунт удалён» after account deletion. */
  customer(r: AdminOrderReview): string {
    const name = r.customer.name || this.translate.instant('admin.reviews.noName');
    return r.customer.deleted ? `${name} (${this.translate.instant('admin.reviews.deletedAccount')})` : name;
  }

  /** The account's ways to reach the customer — gone after account deletion. */
  contacts(r: AdminOrderReview): string {
    const c = r.customer;
    const telegram = c.telegramUserId
      ? this.translate.instant('admin.reviews.telegramId', { id: c.telegramUserId })
      : null;
    return [c.email, c.phone ? formatPhone(c.phone) : null, telegram].filter(Boolean).join(' · ');
  }

  private load(brandId: string | null, rating: number | null, period: ReviewPeriod, page: number): void {
    this.error.set(null);
    this.api
      .list({
        brandId: brandId ?? undefined,
        rating: rating ?? undefined,
        from: periodStart(period),
        page,
        pageSize: PAGE_SIZE,
      })
      .subscribe({
        next: (result) => this.page.set(result),
        error: (err: unknown) => {
          this.page.set({
            items: [],
            total: 0,
            page: 1,
            pageSize: PAGE_SIZE,
            count: 0,
            averageRating: null,
            ratingCounts: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
          });
          this.error.set(apiErrorMessage(err, this.translate, { network: 'common.networkError' }));
        },
      });
  }
}

/** The start of the period: local midnight N − 1 days ago, as an ISO instant; nothing for «all». */
export function periodStart(period: ReviewPeriod, now = new Date()): string | undefined {
  if (period === 'all') return undefined;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (PERIOD_DAYS[period] - 1));
  return start.toISOString();
}
