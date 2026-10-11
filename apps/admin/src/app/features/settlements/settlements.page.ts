import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import type { SettlementPayout, SettlementReport, SettlementTotals } from '@takeaway/shared-types';
import type { Subscription } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { SettlementsApi } from '../../core/settlements/settlements.service';
import { KpiCardComponent } from '../../shared/charts/kpi-card.component';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';
import { OVERVIEW_STYLES } from '../../shared/overview/overview.styles';
import { settlementCsv } from './settlement-csv';
import { type DayRange, SETTLEMENT_PRESETS, type SettlementPreset, presetRange, todayIn } from './settlement-periods';
import { SettlementRatesComponent } from './settlement-rates.component';

/** Columns of the daily table, in order; the first is the day. */
const DAY_COLUMNS: ReadonlyArray<keyof SettlementTotals> = [
  'orders',
  'salesCents',
  'promoDiscountCents',
  'pointsDiscountCents',
  'giftCardCents',
  'deliveryFeeCents',
  'capturedCents',
  'refundedCents',
  'commissionBaseCents',
  'commissionCents',
  'payableCents',
];

const ERROR_CODES = {
  PAYOUT_PERIOD_OPEN: 'admin.settlements.errors.PAYOUT_PERIOD_OPEN',
  PAYOUT_OVERLAP: 'admin.settlements.errors.PAYOUT_OVERLAP',
  PAYOUT_NOTHING_DUE: 'admin.settlements.errors.PAYOUT_NOTHING_DUE',
  PAYOUT_ALREADY_PAID: 'admin.settlements.errors.PAYOUT_ALREADY_PAID',
  PAYOUT_PAID: 'admin.settlements.errors.PAYOUT_PAID',
  PAYOUT_NOT_LATEST: 'admin.settlements.errors.PAYOUT_NOT_LATEST',
};

/**
 * «Расчёты с брендами» for the platform admin, «Расчёты» for a brand owner.
 *
 * One brand, one currency, a closed period: what its guests paid by card
 * through the platform, the commission, what the platform owes the brand,
 * what has been paid out and what is left. The platform admin fixes a payout
 * for the period and marks it paid once the transfer went out; the owner
 * sees the same figures for their brand only. Definitions: docs/settlements.md.
 */
@Component({
  selector: 'app-settlements',
  standalone: true,
  imports: [TranslatePipe, KpiCardComponent, SettlementRatesComponent],
  template: `
    <section class="ov" [attr.aria-busy]="loading()">
      <header class="st-head">
        <div class="st-titles">
          <h1>{{ (isPlatformAdmin() ? 'admin.settlements.title' : 'admin.settlements.titleOwn') | translate }}</h1>
          <p class="st-sub">
            {{ (isPlatformAdmin() ? 'admin.settlements.subtitle' : 'admin.settlements.subtitleOwn') | translate }}
          </p>
          @if (report(); as r) {
            <p class="st-sub" aria-live="polite">
              {{
                'admin.settlements.periodLine'
                  | translate: { from: day(r.period.from), to: day(r.period.to), timeZone: r.period.timeZone }
              }}
            </p>
          }
        </div>
        <div class="st-controls">
          @if (activeBrand.brands().length > 1) {
            <select
              class="ov-select"
              [attr.aria-label]="'admin.settlements.brand' | translate"
              (change)="activeBrand.select($any($event.target).value)"
            >
              @for (b of activeBrand.brands(); track b.id) {
                <option [value]="b.id" [selected]="b.id === brandId()">{{ b.name }}</option>
              }
            </select>
          }
          @if ((report()?.currencies?.length ?? 0) > 1) {
            <select
              class="ov-select"
              [attr.aria-label]="'admin.settlements.currency' | translate"
              (change)="pickCurrency($any($event.target).value)"
            >
              @for (c of report()?.currencies ?? []; track c) {
                <option [value]="c" [selected]="c === report()?.currency">{{ c }}</option>
              }
            </select>
          }
          <div class="st-pills" role="group" [attr.aria-label]="'admin.dateRange.label' | translate">
            @for (p of presets; track p) {
              <button
                type="button"
                class="st-pill"
                [class.is-on]="preset() === p"
                [attr.aria-pressed]="preset() === p"
                (click)="preset.set(p)"
              >
                {{ 'admin.settlements.presets.' + p | translate }}
              </button>
            }
            <button
              type="button"
              class="st-pill"
              [class.is-on]="preset() === 'custom'"
              [attr.aria-pressed]="preset() === 'custom'"
              (click)="openCustom()"
            >
              {{ 'admin.settlements.presets.custom' | translate }}
            </button>
          </div>
          @if (report()) {
            <button type="button" class="st-ghost" (click)="downloadCsv()">
              {{ 'admin.settlements.exportCsv' | translate }}
            </button>
          }
        </div>
      </header>

      @if (preset() === 'custom') {
        <form class="st-custom" (submit)="$event.preventDefault(); applyCustom()">
          <label>
            <span>{{ 'admin.settlements.from' | translate }}</span>
            <input type="date" [value]="customFrom()" (input)="customFrom.set($any($event.target).value)" />
          </label>
          <label>
            <span>{{ 'admin.settlements.to' | translate }}</span>
            <input
              type="date"
              [value]="customTo()"
              [min]="customFrom()"
              (input)="customTo.set($any($event.target).value)"
            />
          </label>
          <button type="submit" class="st-primary" [disabled]="!customValid()">
            {{ 'admin.settlements.apply' | translate }}
          </button>
          @if (customFrom() && customTo() && customFrom() > customTo()) {
            <span class="dash-error">{{ 'admin.settlements.reversed' | translate }}</span>
          }
        </form>
      }

      @if (!brandId() && isPlatformAdmin()) {
        <article class="dash-card ov-state">
          <p class="dash-muted">{{ 'admin.settlements.noBrand' | translate }}</p>
        </article>
      } @else if (error() && !report()) {
        <article class="dash-card ov-state">
          <p class="dash-error">{{ error() }}</p>
        </article>
      } @else if (report(); as r) {
        <div class="st-kpis">
          <app-kpi-card
            [label]="'admin.settlements.kpi.captured' | translate"
            [value]="money(r.totals.capturedCents)"
            [footLeft]="'admin.settlements.foot.refunded' | translate: { value: money(r.totals.refundedCents) }"
            [footRight]="'admin.settlements.foot.cardOrders' | translate: { count: r.totals.cardOrders }"
          />
          <app-kpi-card
            [label]="'admin.settlements.kpi.commission' | translate: { rate: rateLabel() }"
            [value]="money(r.totals.commissionCents)"
            [footLeft]="'admin.settlements.foot.base' | translate: { value: money(r.totals.commissionBaseCents) }"
            [footRight]="'admin.settlements.foot.rounding' | translate"
          />
          <app-kpi-card
            [label]="
              (isPlatformAdmin() ? 'admin.settlements.kpi.payable' : 'admin.settlements.kpi.payableOwn') | translate
            "
            [value]="money(r.totals.payableCents)"
            [footLeft]="'admin.settlements.foot.sales' | translate: { value: money(r.totals.salesCents) }"
          />
          <app-kpi-card
            [label]="'admin.settlements.kpi.paid' | translate"
            [value]="money(r.balance.paidCents)"
            [footLeft]="
              r.balance.pendingCents
                ? ('admin.settlements.foot.pending' | translate: { value: money(r.balance.pendingCents) })
                : ''
            "
          />
          <app-kpi-card
            [label]="'admin.settlements.kpi.closing' | translate"
            [value]="money(r.balance.closingCents)"
            [footLeft]="'admin.settlements.foot.opening' | translate: { value: money(r.balance.openingCents) }"
            [footRight]="
              r.balance.closingPendingCents
                ? ('admin.settlements.foot.closingPending' | translate: { value: money(r.balance.closingPendingCents) })
                : ''
            "
          />
        </div>

        @if (r.totals.zeroTotalOrders) {
          <p class="dash-hint">{{ 'admin.settlements.zeroTotal' | translate: { count: r.totals.zeroTotalOrders } }}</p>
        }
        @if (r.totals.unpaidOrders) {
          <p class="dash-hint">
            {{
              'admin.settlements.unpaid'
                | translate: { count: r.totals.unpaidOrders, amount: money(r.totals.unpaidTotalCents) }
            }}
          </p>
        }
        @if (error()) {
          <p class="dash-error" role="alert">{{ error() }}</p>
        }
        @if (notice()) {
          <p class="st-notice" role="status">{{ notice() }}</p>
        }

        @if (isPlatformAdmin()) {
          <article class="dash-card">
            <header class="dash-card-head">
              <h2>{{ 'admin.settlements.payout.title' | translate }}</h2>
            </header>
            @if (r.nextPayout.blocked; as reason) {
              <p class="dash-muted">
                {{
                  'admin.settlements.payout.blocked.' + reason | translate: { day: day(r.nextPayout.lastSettledDay) }
                }}
              </p>
            } @else {
              <p class="st-payout-sum">
                {{
                  'admin.settlements.payout.summary'
                    | translate
                      : {
                          from: day(r.nextPayout.periodFrom),
                          to: day(r.nextPayout.periodTo),
                          amount: money(r.nextPayout.amountCents),
                        }
                }}
              </p>
              <p class="dash-hint">
                {{
                  'admin.settlements.payout.breakdown'
                    | translate
                      : { card: money(r.nextPayout.cardNetCents), commission: money(r.nextPayout.commissionCents) }
                }}
                @if (carried(); as c) {
                  · {{ 'admin.settlements.payout.carried' | translate: { amount: money(c) } }}
                }
              </p>
              <form class="st-payout-form" (submit)="$event.preventDefault(); fixPayout()">
                <input
                  type="text"
                  maxlength="200"
                  [placeholder]="'admin.settlements.payout.reference' | translate"
                  [attr.aria-label]="'admin.settlements.payout.reference' | translate"
                  [value]="payoutReference()"
                  (input)="payoutReference.set($any($event.target).value)"
                />
                <input
                  type="text"
                  maxlength="500"
                  class="st-grow"
                  [placeholder]="'admin.settlements.payout.comment' | translate"
                  [attr.aria-label]="'admin.settlements.payout.comment' | translate"
                  [value]="payoutComment()"
                  (input)="payoutComment.set($any($event.target).value)"
                />
                <button type="submit" class="st-primary" [disabled]="busy()">
                  {{ (busy() ? 'admin.settlements.payout.fixing' : 'admin.settlements.payout.fix') | translate }}
                </button>
              </form>
            }
          </article>
        }

        <article class="dash-card">
          <header class="dash-card-head">
            <h2>{{ 'admin.settlements.daily.title' | translate }}</h2>
            <span class="ov-hint">{{
              'admin.settlements.daily.hint' | translate: { timeZone: r.period.timeZone }
            }}</span>
          </header>
          <div class="ov-table-wrap">
            <table class="ov-table st-table">
              <thead>
                <tr>
                  <th scope="col">{{ 'admin.settlements.cols.date' | translate }}</th>
                  @for (c of columns; track c) {
                    <th scope="col">{{ 'admin.settlements.cols.' + c | translate }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (d of r.days; track d.date) {
                  <tr [class.st-empty]="!d.orders">
                    <td>{{ day(d.date) }}</td>
                    @for (c of columns; track c) {
                      <td>{{ cell(c, d[c]) }}</td>
                    }
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{{ 'admin.settlements.daily.total' | translate }}</th>
                  @for (c of columns; track c) {
                    <td>{{ cell(c, r.totals[c]) }}</td>
                  }
                </tr>
              </tfoot>
            </table>
          </div>
        </article>

        <article class="dash-card">
          <header class="dash-card-head">
            <h2>{{ 'admin.settlements.payouts.title' | translate }}</h2>
          </header>
          @if (r.payouts.length === 0) {
            <p class="dash-muted">{{ 'admin.settlements.payouts.empty' | translate }}</p>
          } @else {
            <div class="ov-table-wrap">
              <table class="ov-table st-table">
                <thead>
                  <tr>
                    <th scope="col">{{ 'admin.settlements.payouts.period' | translate }}</th>
                    <th scope="col">{{ 'admin.settlements.payouts.amount' | translate }}</th>
                    <th scope="col">{{ 'admin.settlements.payouts.commission' | translate }}</th>
                    <th scope="col">{{ 'admin.settlements.payouts.status' | translate }}</th>
                    <th scope="col">{{ 'admin.settlements.payouts.paidAt' | translate }}</th>
                    <th scope="col">{{ 'admin.settlements.payouts.reference' | translate }}</th>
                    @if (isPlatformAdmin()) {
                      <th scope="col">
                        <span class="st-sr">{{ 'admin.settlements.payouts.markPaid' | translate }}</span>
                      </th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (p of r.payouts; track p.id; let first = $first) {
                    <tr>
                      <td>{{ day(p.periodFrom) }} – {{ day(p.periodTo) }}</td>
                      <td>{{ money(p.amountCents) }}</td>
                      <td>{{ money(p.commissionCents) }}</td>
                      <td>
                        <span class="st-status" [attr.data-status]="p.status">{{
                          'admin.settlements.payouts.statuses.' + p.status | translate
                        }}</span>
                      </td>
                      <td>{{ p.paidAt ? fmt.date(p.paidAt, r.period.timeZone) : '—' }}</td>
                      <td class="st-ref">{{ refText(p) }}</td>
                      @if (isPlatformAdmin()) {
                        <td class="st-actions">
                          @if (p.status === 'PENDING') {
                            @if (paying() === p.id) {
                              <form class="st-inline" (submit)="$event.preventDefault(); confirmPaid(p)">
                                <input
                                  type="text"
                                  maxlength="200"
                                  [placeholder]="'admin.settlements.payout.reference' | translate"
                                  [attr.aria-label]="'admin.settlements.payout.reference' | translate"
                                  [value]="paidReference()"
                                  (input)="paidReference.set($any($event.target).value)"
                                />
                                <button type="submit" class="st-primary" [disabled]="busy()">
                                  {{ 'admin.settlements.payouts.confirmPaid' | translate }}
                                </button>
                                <button type="button" class="st-ghost" (click)="paying.set(null)">
                                  {{ 'admin.settlements.payouts.cancel' | translate }}
                                </button>
                              </form>
                            } @else {
                              <button type="button" class="st-ghost" [disabled]="busy()" (click)="startPaid(p)">
                                {{ 'admin.settlements.payouts.markPaid' | translate }}
                              </button>
                              @if (first) {
                                <button type="button" class="st-danger" [disabled]="busy()" (click)="removePayout(p)">
                                  {{ 'admin.settlements.payouts.remove' | translate }}
                                </button>
                              }
                            }
                          }
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </article>

        <app-settlement-rates [brandId]="brandId()" [canEdit]="isPlatformAdmin()" (changed)="reload()" />

        <article class="dash-card">
          <header class="dash-card-head">
            <h2>{{ 'admin.settlements.formula.title' | translate }}</h2>
          </header>
          <ul class="st-formula">
            <li>{{ 'admin.settlements.formula.captured' | translate }}</li>
            <li>{{ 'admin.settlements.formula.base' | translate }}</li>
            <li>{{ 'admin.settlements.formula.commission' | translate }}</li>
            <li>{{ 'admin.settlements.formula.payable' | translate }}</li>
            <li>{{ 'admin.settlements.formula.balance' | translate }}</li>
          </ul>
        </article>
      } @else {
        <article class="dash-card ov-state">
          <p class="dash-muted">{{ 'admin.settlements.loading' | translate }}</p>
        </article>
      }
    </section>
  `,
  styles: [
    DASH_CARD_STYLES,
    OVERVIEW_STYLES,
    `
      .st-head {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px 16px;
      }
      .st-titles h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: 28px;
        color: var(--color-espresso);
      }
      .st-sub {
        margin: 4px 0 0;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .st-controls,
      .st-pills,
      .st-custom,
      .st-payout-form,
      .st-inline {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .st-pill {
        height: 32px;
        padding: 0 12px;
        border-radius: 9999px;
        border: 1px solid var(--color-border-light);
        background: var(--color-foam);
        color: var(--color-text-secondary);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      .st-pill.is-on {
        background: var(--color-caramel);
        border-color: transparent;
        color: white;
      }
      .st-custom label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 11px;
        color: var(--color-text-tertiary);
      }
      .st-custom input,
      .st-payout-form input,
      .st-inline input {
        height: 34px;
        padding: 0 8px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        background: var(--color-cream);
        font-size: 13px;
        color: var(--color-text-primary);
      }
      .st-grow {
        flex: 1 1 220px;
      }
      .st-primary,
      .st-ghost,
      .st-danger {
        height: 34px;
        padding: 0 14px;
        border-radius: var(--radius-button);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }
      .st-primary {
        border: 0;
        background: var(--color-espresso);
        color: white;
      }
      .st-ghost {
        border: 1px solid var(--color-caramel);
        background: transparent;
        color: var(--color-caramel);
      }
      .st-danger {
        border: 0;
        background: transparent;
        color: var(--color-berry);
      }
      .st-primary:disabled,
      .st-ghost:disabled,
      .st-danger:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .st-kpis {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 12px;
      }
      .st-payout-sum {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        color: var(--color-text-primary);
      }
      .st-notice {
        margin: 0;
        font-size: 13px;
        color: var(--color-positive);
      }
      .st-table tbody tr {
        cursor: default;
      }
      .st-table tfoot th,
      .st-table tfoot td {
        padding: 10px;
        font-weight: 700;
        text-align: right;
        white-space: nowrap;
      }
      .st-table tfoot th {
        text-align: left;
      }
      .st-empty td {
        color: var(--color-text-tertiary);
      }
      .st-status {
        padding: 2px 8px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 700;
        background: color-mix(in srgb, var(--chart-warning) 18%, transparent);
        color: var(--chart-warning);
      }
      .st-status[data-status='PAID'] {
        background: color-mix(in srgb, var(--chart-customers) 18%, transparent);
        color: var(--color-positive);
      }
      .st-ref {
        max-width: 260px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .st-actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
      }
      .st-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .st-formula {
        margin: 0;
        padding-left: 18px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
    `,
  ],
})
export class SettlementsPage {
  private readonly api = inject(SettlementsApi);
  private readonly auth = inject(AuthStore);
  private readonly translate = inject(TranslateService);
  readonly activeBrand = inject(ActiveBrandService);
  readonly fmt = inject(LocaleFormatService);

  readonly presets = SETTLEMENT_PRESETS;
  readonly columns = DAY_COLUMNS;

  readonly isPlatformAdmin = computed(() => this.auth.user()?.role === 'SUPER_ADMIN');
  readonly brandId = computed(() => this.activeBrand.activeId());

  readonly preset = signal<SettlementPreset | 'custom'>('lastWeek');
  readonly customFrom = signal('');
  readonly customTo = signal('');
  private readonly appliedCustom = signal<DayRange | null>(null);
  /** The currency picked for a brand; another brand starts on its own. */
  private readonly currencyChoice = signal<{ brandId: string | null; currency: string } | null>(null);

  readonly report = signal<SettlementReport | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly busy = signal(false);
  readonly payoutReference = signal('');
  readonly payoutComment = signal('');
  /** The payout whose «Отметить выплаченной» form is open. */
  readonly paying = signal<string | null>(null);
  readonly paidReference = signal('');
  private readonly tick = signal(0);
  private request: Subscription | null = null;

  private readonly timeZone = computed(() => this.report()?.period.timeZone ?? null);
  readonly range = computed<DayRange | null>(
    () => {
      const preset = this.preset();
      if (preset === 'custom') return this.appliedCustom();
      return presetRange(preset, todayIn(this.timeZone()));
    },
    { equal: (a, b) => a?.from === b?.from && a?.to === b?.to },
  );
  readonly currency = computed(() => {
    const choice = this.currencyChoice();
    return choice && choice.brandId === this.brandId() ? choice.currency : null;
  });
  readonly customValid = computed(
    () => !!this.customFrom() && !!this.customTo() && this.customFrom() <= this.customTo(),
  );

  /** "15 %", or "10–15 %" when the rate changed within the period. */
  readonly rateLabel = computed(() => {
    const rates = this.report()?.rates ?? [];
    if (rates.length === 0) return '—';
    const values = rates.map((r) => r.bps);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pct = (bps: number) => this.fmt.percent(bps / 100, { maxDigits: 2 });
    return lo === hi ? pct(lo) : `${this.fmt.percent(lo / 100, { maxDigits: 2 }).replace(/\s?%$/, '')}–${pct(hi)}`;
  });

  /** What the next payout carries in from earlier periods (refunds after a payout, late orders). */
  readonly carried = computed(() => {
    const next = this.report()?.nextPayout;
    if (!next) return 0;
    return next.amountCents - (next.cardNetCents - next.commissionCents);
  });

  constructor() {
    effect(() => {
      const brandId = this.brandId();
      const range = this.range();
      const currency = this.currency();
      this.tick();
      untracked(() => this.load(brandId, range, currency));
    });
  }

  reload(): void {
    this.tick.update((n) => n + 1);
  }

  pickCurrency(currency: string): void {
    this.currencyChoice.set({ brandId: this.brandId(), currency });
  }

  openCustom(): void {
    const current = this.range();
    if (current && !this.customFrom()) {
      this.customFrom.set(current.from);
      this.customTo.set(current.to);
    }
    this.preset.set('custom');
  }

  applyCustom(): void {
    if (!this.customValid()) return;
    this.appliedCustom.set({ from: this.customFrom(), to: this.customTo() });
  }

  money(cents: number | null | undefined): string {
    if (cents === null || cents === undefined) return '—';
    return this.fmt.money(cents, this.report()?.currency);
  }

  /** A local calendar day, `YYYY-MM-DD`, in words. */
  day(value: string | null | undefined): string {
    if (!value) return '—';
    return this.fmt.date(`${value}T00:00:00Z`, 'UTC');
  }

  refText(payout: SettlementPayout): string {
    return [payout.reference, payout.comment].filter((v): v is string => !!v).join(' · ') || '—';
  }

  cell(column: keyof SettlementTotals, value: number): string {
    return column === 'orders' ? String(value) : this.money(value);
  }

  fixPayout(): void {
    const r = this.report();
    if (!r || r.nextPayout.blocked) return;
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.api
      .createPayout({
        brandId: r.brand.id,
        currency: r.currency,
        to: r.nextPayout.periodTo,
        reference: this.payoutReference().trim() || undefined,
        comment: this.payoutComment().trim() || undefined,
      })
      .subscribe({
        next: (payout) => {
          this.busy.set(false);
          this.payoutReference.set('');
          this.payoutComment.set('');
          this.notice.set(
            this.translate.instant('admin.settlements.payout.fixed', { amount: this.money(payout.amountCents) }),
          );
          this.reload();
        },
        error: (err) => this.fail(err),
      });
  }

  startPaid(payout: SettlementPayout): void {
    this.paidReference.set(payout.reference ?? '');
    this.paying.set(payout.id);
  }

  confirmPaid(payout: SettlementPayout): void {
    this.busy.set(true);
    this.error.set(null);
    this.api.markPaid(payout.id, { reference: this.paidReference().trim() || undefined }).subscribe({
      next: () => {
        this.busy.set(false);
        this.paying.set(null);
        this.reload();
      },
      error: (err) => this.fail(err),
    });
  }

  removePayout(payout: SettlementPayout): void {
    const ok = window.confirm(
      this.translate.instant('admin.settlements.payouts.removeConfirm', {
        from: this.day(payout.periodFrom),
        to: this.day(payout.periodTo),
      }),
    );
    if (!ok) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.deletePayout(payout.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.reload();
      },
      error: (err) => this.fail(err),
    });
  }

  downloadCsv(): void {
    const r = this.report();
    if (!r) return;
    const label = (key: string) =>
      this.translate.instant(
        key in r.totals ? `admin.settlements.cols.${key}` : `admin.settlements.csv.${key}`,
      ) as string;
    const csv = settlementCsv(r, label, this.fmt.lang());
    // The byte-order mark makes Excel read the file as UTF-8.
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `settlements-${slugOf(r.brand.name)}-${r.period.from}-${r.period.to}-${r.currency}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private load(brandId: string | null, range: DayRange | null, currency: string | null): void {
    this.request?.unsubscribe();
    if (!range || (this.isPlatformAdmin() && !brandId)) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.request = this.api.report({ brandId, currency, from: range.from, to: range.to }).subscribe({
      next: (report) => {
        // A brand switched while the request was out answers for the old one.
        if (brandId && report.brand.id !== brandId) return;
        this.report.set(report);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(apiErrorMessage(err, this.translate, { codes: ERROR_CODES, network: 'common.networkError' }));
      },
    });
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    this.error.set(apiErrorMessage(err, this.translate, { codes: ERROR_CODES, network: 'common.networkError' }));
  }
}

function slugOf(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'brand'
  );
}
