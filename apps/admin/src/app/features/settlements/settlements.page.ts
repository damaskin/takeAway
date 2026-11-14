import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import {
  type SettlementActions,
  type SettlementDirection,
  type SettlementPayout,
  type SettlementReport,
  type SettlementSide,
  type SettlementTotals,
  settlementActions,
} from '@takeaway/shared-types';
import type { Subscription } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { SettlementsApi } from '../../core/settlements/settlements.service';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';
import { OVERVIEW_STYLES } from '../../shared/overview/overview.styles';
import { settlementCsv } from './settlement-csv';
import { type DayRange, SETTLEMENT_PRESETS, type SettlementPreset, presetRange, todayIn } from './settlement-periods';
import { SettlementRatesComponent } from './settlement-rates.component';
import { SettlementTakeawayPromosComponent } from './settlement-takeaway-promos.component';

/** Columns of the daily table, in order; the first is the day. The CSV carries every figure. */
const DAY_COLUMNS: ReadonlyArray<keyof SettlementTotals> = [
  'orders',
  'salesCents',
  'promoDiscountCents',
  'giftCardCents',
  'deliveryFeeCents',
  'cardNetCents',
  'takeawayCompensationCents',
  'pointsCompensationCents',
  'commissionCents',
  'netCents',
];

const ERROR_CODES = {
  PAYOUT_PERIOD_OPEN: 'admin.settlements.errors.PAYOUT_PERIOD_OPEN',
  PAYOUT_OVERLAP: 'admin.settlements.errors.PAYOUT_OVERLAP',
  PAYOUT_NOTHING_DUE: 'admin.settlements.errors.PAYOUT_NOTHING_DUE',
  PAYOUT_STATUS: 'admin.settlements.errors.PAYOUT_STATUS',
  PAYOUT_NOT_YOUR_SIDE: 'admin.settlements.errors.PAYOUT_NOT_YOUR_SIDE',
  PAYOUT_PAID: 'admin.settlements.errors.PAYOUT_PAID',
  PAYOUT_NOT_LATEST: 'admin.settlements.errors.PAYOUT_NOT_LATEST',
};

/** The wording set of a viewer: «Вы должны takeAway» or «Бренд должен takeAway». */
type Viewer = 'brand' | 'platform';

/** A line of the «Ждёт вас» banner: a translation key and its parameters. */
interface WaitingLine {
  id: string;
  key: string;
  params: Record<string, string>;
}

/**
 * «Расчёты с брендами» for the platform admin, «Расчёты» for a brand owner.
 *
 * Since 2026-11-14 guests pay the brand directly. One brand, one currency, a
 * period: what guests paid by card (the brand has that money), what takeAway
 * compensates for the discounts it funds (its promos and loyalty points), the
 * commission on the full price, and the net of the two — «К взаиморасчёту»,
 * worded by sign and by who is looking. The platform admin fixes a settlement
 * for a closed period; the payer marks it paid, the receiver answers
 * «Получено» or «Не получено». Only a confirmed settlement reduces the
 * balance. Both sides see the same page; what each may do comes from
 * `settlementActions`. Definitions: docs/settlements.md.
 */
@Component({
  selector: 'app-settlements',
  standalone: true,
  imports: [TranslatePipe, SettlementRatesComponent, SettlementTakeawayPromosComponent],
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
        <!-- What waits on the viewer: a settlement to pay or to confirm. -->
        @if (waiting().length) {
          <aside class="st-waiting" role="status" data-testid="settlement-waiting">
            <strong>{{ 'admin.settlements.waiting.title' | translate }}</strong>
            <ul>
              @for (w of waiting(); track w.id) {
                <li>{{ w.key | translate: w.params }}</li>
              }
            </ul>
          </aside>
        }

        <!-- Maxim's three figures and the result, for both sides alike. -->
        <div class="st-figures" data-testid="settlement-figures">
          <article class="st-fig" data-testid="figure-card">
            <span class="st-fig-label">{{ 'admin.settlements.figures.cardNet' | translate }}</span>
            <span class="st-fig-value">{{ money(r.totals.cardNetCents) }}</span>
            <span class="st-fig-note">{{
              'admin.settlements.figures.cardNetNote'
                | translate: { count: r.totals.cardOrders, refunded: money(r.totals.refundedCents) }
            }}</span>
            <span class="st-fig-note">{{ 'admin.settlements.figures.cardNetWhere.' + viewer() | translate }}</span>
          </article>
          <article class="st-fig" data-testid="figure-compensation">
            <span class="st-fig-label">{{ 'admin.settlements.figures.compensation' | translate }}</span>
            <span class="st-fig-value">{{ money(r.totals.compensationCents) }}</span>
            <dl class="st-fig-lines">
              <div data-testid="figure-compensation-promo">
                <dt>{{ 'admin.settlements.figures.compensationPromo' | translate }}</dt>
                <dd>{{ money(r.totals.takeawayCompensationCents) }}</dd>
              </div>
              <div data-testid="figure-compensation-points">
                <dt>{{ 'admin.settlements.figures.compensationPoints' | translate }}</dt>
                <dd>{{ money(r.totals.pointsCompensationCents) }}</dd>
              </div>
            </dl>
            <span class="st-fig-note">{{ 'admin.settlements.figures.compensationNote' | translate }}</span>
          </article>
          <article class="st-fig" data-testid="figure-commission">
            <span class="st-fig-label">{{
              'admin.settlements.figures.commission' | translate: { rate: rateLabel() }
            }}</span>
            <span class="st-fig-value">{{ money(r.totals.commissionCents) }}</span>
            <span class="st-fig-note">{{
              'admin.settlements.figures.commissionNote' | translate: { base: money(r.totals.commissionBaseCents) }
            }}</span>
          </article>
          <article class="st-fig st-fig-result" data-testid="figure-net" [attr.data-sign]="sign(r.totals.netCents)">
            <span class="st-fig-label">{{ 'admin.settlements.figures.net' | translate }}</span>
            <span class="st-fig-owes">{{ owes(r.totals.netCents) }}</span>
            <span class="st-fig-note">{{
              'admin.settlements.figures.netNote'
                | translate
                  : { commission: money(r.totals.commissionCents), compensation: money(r.totals.compensationCents) }
            }}</span>
          </article>
        </div>

        <p class="dash-hint" data-testid="settlement-breakdown">
          @for (part of breakdownParts(); track part.key; let last = $last) {
            {{ 'admin.settlements.breakdownParts.' + part.key | translate: { amount: money(part.cents) } }}
            @if (!last) {
              ·
            }
          }
        </p>
        @if (r.totals.promoDiscountCents || r.totals.giftCardCents) {
          <p class="dash-hint">{{ 'admin.settlements.breakdownHint' | translate }}</p>
        }
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

        <div class="st-pair">
          <article class="dash-card" data-testid="settlement-payout">
            <header class="dash-card-head">
              <h2>{{ 'admin.settlements.payout.title' | translate }}</h2>
            </header>
            @if (payoutClosedEarly()) {
              <p class="dash-hint" data-testid="payout-closed-days">
                {{ 'admin.settlements.payout.closedDays' | translate: { day: day(r.nextPayout.periodTo) } }}
              </p>
            }
            @if (r.nextPayout.blocked; as reason) {
              <p class="dash-muted" data-testid="payout-blocked">
                {{
                  'admin.settlements.payout.blocked.' +
                    (reason === 'OVERLAP' && payoutClosedEarly() ? 'UP_TO_DATE' : reason)
                    | translate: { day: day(r.nextPayout.lastSettledDay) }
                }}
              </p>
            } @else if (r.nextPayout.direction; as direction) {
              <p class="st-payout-period">
                {{
                  'admin.settlements.payout.period'
                    | translate: { from: day(r.nextPayout.periodFrom), to: day(r.nextPayout.periodTo) }
                }}
              </p>
              <p class="st-payout-sum" data-testid="payout-summary">
                {{ paysText(direction, r.nextPayout.amountCents) }}
              </p>
            }
            @if (payoutBreakdown(); as b) {
              <p class="dash-hint" data-testid="payout-breakdown">
                {{
                  'admin.settlements.payout.breakdown'
                    | translate: { commission: b.commission, promo: b.promo, points: b.points, result: b.result }
                }}
                @if (b.carried) {
                  · {{ 'admin.settlements.payout.carried' | translate: { amount: b.carried } }}
                }
              </p>
              <p class="dash-hint">{{ 'admin.settlements.payout.cardNet' | translate: { amount: b.cardNet } }}</p>
            }
            @if (!isPlatformAdmin()) {
              <p class="dash-muted" data-testid="payout-owner-hint">
                {{ 'admin.settlements.payout.ownerHint' | translate }}
              </p>
            } @else if (!r.nextPayout.blocked && r.nextPayout.direction) {
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

          <article class="dash-card" data-testid="settlement-balance">
            <header class="dash-card-head">
              <h2>{{ 'admin.settlements.balance.title' | translate }}</h2>
            </header>
            <dl class="st-balance">
              <div>
                <dt>{{ 'admin.settlements.balance.opening' | translate }}</dt>
                <dd data-testid="balance-opening">{{ owes(r.balance.openingCents) }}</dd>
              </div>
              <div>
                <dt>{{ 'admin.settlements.balance.net' | translate }}</dt>
                <dd data-testid="balance-net">{{ owes(r.balance.netCents) }}</dd>
              </div>
              <div>
                <dt>{{ 'admin.settlements.balance.settled' | translate }}</dt>
                <dd data-testid="balance-settled">{{ flow(r.balance.settledCents) }}</dd>
              </div>
              <div>
                <dt>{{ 'admin.settlements.balance.open' | translate }}</dt>
                <dd data-testid="balance-open">{{ flow(r.balance.openCents) }}</dd>
              </div>
              <div class="st-balance-total" [attr.data-sign]="sign(r.balance.closingCents)">
                <dt>{{ 'admin.settlements.balance.closing' | translate }}</dt>
                <dd data-testid="balance-closing">{{ owes(r.balance.closingCents) }}</dd>
              </div>
            </dl>
            @if (r.balance.closingOpenCents) {
              <p class="dash-hint" data-testid="balance-closing-open">
                {{ 'admin.settlements.balance.closingOpen' | translate: { flow: flow(r.balance.closingOpenCents) } }}
              </p>
            }
            <p class="dash-hint">{{ 'admin.settlements.balance.hint' | translate }}</p>
          </article>
        </div>

        <article class="dash-card" data-testid="settlement-payouts">
          <header class="dash-card-head">
            <h2>{{ 'admin.settlements.payouts.title' | translate }}</h2>
          </header>
          @if (r.payouts.length === 0) {
            <p class="dash-muted" data-testid="payouts-empty">
              {{ 'admin.settlements.payouts.empty' | translate }}
              {{
                (isPlatformAdmin() ? 'admin.settlements.payouts.emptyAdmin' : 'admin.settlements.payouts.emptyOwner')
                  | translate
              }}
            </p>
          } @else {
            <div class="ov-table-wrap">
              <table class="ov-table st-table st-payouts">
                <thead>
                  <tr>
                    <th scope="col">{{ 'admin.settlements.payouts.period' | translate }}</th>
                    <th scope="col" class="st-left">{{ 'admin.settlements.payouts.direction' | translate }}</th>
                    <th scope="col">{{ 'admin.settlements.payouts.amount' | translate }}</th>
                    <th scope="col" class="st-left">{{ 'admin.settlements.payouts.breakdown' | translate }}</th>
                    <th scope="col" class="st-left">{{ 'admin.settlements.payouts.status' | translate }}</th>
                    <th scope="col" class="st-left">{{ 'admin.settlements.payouts.reference' | translate }}</th>
                    <th scope="col">
                      <span class="st-sr">{{ 'admin.settlements.payouts.status' | translate }}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of r.payouts; track p.id; let first = $first) {
                    <tr data-testid="settlement-row" [attr.data-status]="p.status">
                      <td>{{ day(p.periodFrom) }} – {{ day(p.periodTo) }}</td>
                      <td class="st-left">{{ 'admin.settlements.direction.' + p.direction | translate }}</td>
                      <td class="st-strong">{{ money(p.amountCents) }}</td>
                      <td class="st-left st-small">
                        {{
                          'admin.settlements.payouts.breakdownLine'
                            | translate
                              : {
                                  commission: money(p.commissionCents),
                                  promo: money(p.compensationCents),
                                  points: money(p.pointsCompensationCents),
                                }
                        }}
                      </td>
                      <td class="st-left">
                        <span class="st-status" [attr.data-status]="p.status" data-testid="settlement-status">{{
                          statusText(p)
                        }}</span>
                        @if (p.status === 'PAID' && p.paidAt) {
                          <span class="st-under">{{
                            'admin.settlements.payouts.paidOn' | translate: { date: shortDay(p.paidAt) }
                          }}</span>
                        }
                        @if (p.status === 'DISPUTED' && p.disputeComment) {
                          <span class="st-under st-dispute" data-testid="settlement-dispute"
                            >“{{ p.disputeComment }}”</span
                          >
                        }
                      </td>
                      <td class="st-left st-ref">{{ refText(p) }}</td>
                      <td class="st-actions-cell">
                        <div class="st-actions">
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
                          } @else if (disputing() === p.id) {
                            <form class="st-inline" (submit)="$event.preventDefault(); sendDispute(p)">
                              <input
                                type="text"
                                maxlength="500"
                                [placeholder]="'admin.settlements.payouts.disputeComment' | translate"
                                [attr.aria-label]="'admin.settlements.payouts.disputeComment' | translate"
                                [value]="disputeComment()"
                                (input)="disputeComment.set($any($event.target).value)"
                              />
                              <button
                                type="submit"
                                class="st-danger-solid"
                                [disabled]="busy() || !disputeComment().trim()"
                              >
                                {{ 'admin.settlements.payouts.disputeSend' | translate }}
                              </button>
                              <button type="button" class="st-ghost" (click)="disputing.set(null)">
                                {{ 'admin.settlements.payouts.cancel' | translate }}
                              </button>
                            </form>
                          } @else {
                            @let can = actions(p);
                            @if (can.markPaid) {
                              <button type="button" class="st-primary" [disabled]="busy()" (click)="startPaid(p)">
                                {{ 'admin.settlements.payouts.markPaid' | translate }}
                              </button>
                            }
                            @if (can.confirm) {
                              <button type="button" class="st-primary" [disabled]="busy()" (click)="received(p)">
                                {{ 'admin.settlements.payouts.received' | translate }}
                              </button>
                            }
                            @if (can.dispute) {
                              <button type="button" class="st-ghost" [disabled]="busy()" (click)="startDispute(p)">
                                {{ 'admin.settlements.payouts.notReceived' | translate }}
                              </button>
                            }
                            @if (isPlatformAdmin() && first && p.status === 'PENDING') {
                              <button type="button" class="st-danger" [disabled]="busy()" (click)="removePayout(p)">
                                {{ 'admin.settlements.payouts.remove' | translate }}
                              </button>
                            }
                          }
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </article>

        <article class="dash-card">
          <header class="dash-card-head">
            <h2>{{ 'admin.settlements.daily.title' | translate }}</h2>
            <span class="ov-hint">{{
              'admin.settlements.daily.hint' | translate: { timeZone: r.period.timeZone }
            }}</span>
          </header>
          <p class="dash-hint">{{ 'admin.settlements.daily.sign.' + viewer() | translate }}</p>
          <div class="ov-table-wrap">
            <table class="ov-table st-table" data-testid="settlement-days">
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

        <app-settlement-takeaway-promos [report]="r" />

        <app-settlement-rates [brandId]="brandId()" [canEdit]="isPlatformAdmin()" (changed)="reload()" />

        <article class="dash-card">
          <header class="dash-card-head">
            <h2>{{ 'admin.settlements.formula.title' | translate }}</h2>
          </header>
          <ul class="st-formula">
            <li>{{ 'admin.settlements.formula.cardNet' | translate }}</li>
            <li>{{ 'admin.settlements.formula.compensation' | translate }}</li>
            <li>{{ 'admin.settlements.formula.commission' | translate }}</li>
            <li>{{ 'admin.settlements.formula.net' | translate }}</li>
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
      .st-titles {
        max-width: 760px;
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
        min-width: 0;
        padding: 0 8px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        background: var(--color-cream);
        font-size: 13px;
        color: var(--color-text-primary);
      }
      .st-inline input {
        width: 200px;
      }
      .st-grow {
        flex: 1 1 220px;
      }
      .st-primary,
      .st-ghost,
      .st-danger,
      .st-danger-solid {
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
      .st-danger-solid {
        border: 0;
        background: var(--color-berry);
        color: white;
      }
      .st-primary:disabled,
      .st-ghost:disabled,
      .st-danger:disabled,
      .st-danger-solid:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .st-waiting {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 14px 18px;
        border-radius: 16px;
        border: 1px solid var(--color-caramel);
        background: var(--color-caramel-light);
        color: var(--color-espresso);
        font-size: 14px;
      }
      .st-waiting ul {
        margin: 0;
        padding-left: 18px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .st-figures {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
      }
      .st-fig {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
        padding: 18px 20px;
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: 20px;
      }
      .st-fig-label {
        font-size: 12px;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: var(--color-text-tertiary);
      }
      .st-fig-value {
        font-family: var(--font-display);
        font-size: 28px;
        line-height: 1.15;
        font-weight: 700;
        color: var(--color-espresso);
        font-variant-numeric: tabular-nums;
      }
      .st-fig-owes {
        font-family: var(--font-display);
        font-size: 22px;
        line-height: 1.2;
        font-weight: 700;
        color: var(--color-espresso);
        font-variant-numeric: tabular-nums;
      }
      .st-fig-note {
        font-size: 12px;
        color: var(--color-text-secondary);
      }
      .st-fig-lines {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .st-fig-lines > div {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 13px;
      }
      .st-fig-lines dt {
        color: var(--color-text-secondary);
      }
      .st-fig-lines dd {
        margin: 0;
        font-weight: 600;
        color: var(--color-text-primary);
        font-variant-numeric: tabular-nums;
      }
      .st-fig-result {
        background: var(--color-cream);
      }
      .st-fig-result[data-sign='negative'] {
        border-color: color-mix(in srgb, var(--color-positive) 40%, transparent);
      }
      .st-fig-result[data-sign='positive'] {
        border-color: var(--color-caramel);
      }
      .st-pair {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
        gap: 16px;
        align-items: start;
      }
      .st-payout-period {
        margin: 0;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .st-payout-sum {
        margin: 0;
        font-size: 20px;
        font-weight: 700;
        color: var(--color-text-primary);
      }
      .st-balance {
        margin: 0;
        display: flex;
        flex-direction: column;
      }
      .st-balance > div {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 4px 12px;
        padding: 8px 0;
        border-bottom: 1px solid var(--color-border-light);
        font-size: 13px;
      }
      .st-balance dt {
        color: var(--color-text-secondary);
      }
      .st-balance dd {
        margin: 0;
        font-weight: 600;
        color: var(--color-text-primary);
        font-variant-numeric: tabular-nums;
      }
      .st-balance .st-balance-total {
        border-bottom: 0;
        font-size: 15px;
      }
      .st-balance-total dt {
        font-weight: 700;
        color: var(--color-espresso);
      }
      .st-balance-total dd {
        font-weight: 700;
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
      .ov-table .st-left {
        text-align: left;
      }
      .st-strong {
        font-weight: 700;
      }
      .ov-table td.st-small {
        min-width: 160px;
        max-width: 220px;
        font-size: 12px;
        color: var(--color-text-secondary);
        white-space: normal;
      }
      .st-payouts td {
        vertical-align: top;
      }
      .st-status {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 700;
        background: color-mix(in srgb, var(--chart-warning) 18%, transparent);
        color: var(--chart-warning);
      }
      .st-status[data-status='PAID'] {
        background: var(--color-caramel-light);
        color: var(--color-caramel);
      }
      .st-status[data-status='CONFIRMED'] {
        background: color-mix(in srgb, var(--chart-customers) 18%, transparent);
        color: var(--color-positive);
      }
      .st-status[data-status='DISPUTED'] {
        background: color-mix(in srgb, var(--color-berry) 14%, transparent);
        color: var(--color-berry);
      }
      .st-under {
        display: block;
        margin-top: 4px;
        font-size: 12px;
        color: var(--color-text-tertiary);
        white-space: normal;
      }
      .st-dispute {
        max-width: 240px;
        font-style: italic;
        color: var(--color-berry);
      }
      .ov-table td.st-ref {
        max-width: 200px;
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .st-actions {
        display: flex;
        flex-wrap: wrap;
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
  /** The side the viewer speaks for: the platform admin for takeAway, an owner for their brand. */
  readonly side = computed<SettlementSide>(() => (this.isPlatformAdmin() ? 'TAKEAWAY' : 'BRAND'));
  readonly viewer = computed<Viewer>(() => (this.isPlatformAdmin() ? 'platform' : 'brand'));
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
  /** The settlement whose «Отметить оплату» form is open. */
  readonly paying = signal<string | null>(null);
  readonly paidReference = signal('');
  /** The settlement whose «Не получено» form is open. */
  readonly disputing = signal<string | null>(null);
  readonly disputeComment = signal('');
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

  /**
   * The report reaches today, so the settlement card stops at yesterday: the
   * API proposes only days that have ended, and the card says why its
   * period is shorter than the report's.
   */
  readonly payoutClosedEarly = computed(() => {
    const r = this.report();
    return !!r && r.nextPayout.periodTo < r.period.to;
  });

  /**
   * «комиссия − компенсация по акциям − компенсация по баллам = итог» of the
   * settlement on offer, and what it carries in from earlier periods
   * (refunds or rate corrections after an earlier settlement). Shown while a
   * settlement can be fixed, and when the two sides cancel out (to explain
   * why there is nothing to fix).
   */
  readonly payoutBreakdown = computed(() => {
    const next = this.report()?.nextPayout;
    if (!next?.periodFrom) return null;
    if (next.blocked && next.blocked !== 'NOTHING_DUE') return null;
    const points = next.pointsCompensationCents ?? 0;
    const own = next.commissionCents - next.compensationCents - points;
    const carried = next.netCents - own;
    return {
      commission: this.money(next.commissionCents),
      promo: this.money(next.compensationCents),
      points: this.money(points),
      result: this.money(own),
      carried: carried ? this.signedMoney(carried) : null,
      cardNet: this.money(next.cardNetCents),
    };
  });

  /** «Продажи 150 руб. · промокоды бренда −5 руб. · баллы −20 руб.»: the sales and what came off them, zeros left out. */
  readonly breakdownParts = computed(() => {
    const t = this.report()?.totals;
    if (!t) return [];
    const parts: Array<{ key: string; cents: number }> = [
      { key: 'sales', cents: t.salesCents },
      { key: 'promo', cents: t.promoDiscountCents },
      { key: 'gift', cents: t.giftCardCents },
      { key: 'points', cents: t.pointsDiscountCents },
      { key: 'delivery', cents: t.deliveryFeeCents },
    ];
    return parts.filter((p) => p.key === 'sales' || p.cents);
  });

  /** «Ждёт вас»: the settlements this viewer has to pay, pay again or confirm. */
  readonly waiting = computed<WaitingLine[]>(() => {
    const r = this.report();
    if (!r) return [];
    const side = this.side();
    const viewer = this.viewer();
    return r.payouts.flatMap((p): WaitingLine[] => {
      const can = settlementActions(p, side);
      const params = { amount: this.money(p.amountCents), period: this.shortPeriod(p.periodFrom, p.periodTo) };
      if (can.markPaid && p.status === 'DISPUTED') {
        const comment = p.disputeComment ? `: «${p.disputeComment}»` : '';
        return [{ id: p.id, key: 'admin.settlements.waiting.repay', params: { ...params, comment } }];
      }
      if (can.markPaid) return [{ id: p.id, key: `admin.settlements.waiting.pay.${viewer}`, params }];
      // The receiver may confirm early, but only a paid one waits on them.
      if (can.dispute) return [{ id: p.id, key: `admin.settlements.waiting.confirm.${viewer}`, params }];
      return [];
    });
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

  /** «+2 руб.» / «−2 руб.»: a correction whose sign matters. */
  signedMoney(cents: number): string {
    return cents > 0 ? `+${this.money(cents)}` : this.money(cents);
  }

  /** A local calendar day, `YYYY-MM-DD`, in words. */
  day(value: string | null | undefined): string {
    if (!value) return '—';
    return this.fmt.date(`${value}T00:00:00Z`, 'UTC');
  }

  /** «1 нояб. – 7 нояб.» — a settlement's days in a sentence. */
  shortPeriod(from: string, to: string): string {
    const short = (value: string) => this.fmt.dayMonth(`${value}T00:00:00Z`, 'UTC');
    return from === to ? short(from) : `${short(from)} – ${short(to)}`;
  }

  /** «27.10» on the brand's clock. */
  shortDay(iso: string): string {
    return this.fmt.shortDay(iso, this.report()?.period.timeZone);
  }

  sign(cents: number): 'positive' | 'negative' | 'zero' {
    return cents > 0 ? 'positive' : cents < 0 ? 'negative' : 'zero';
  }

  /**
   * A signed sum in words for this viewer: «Вы должны takeAway 50 руб.»,
   * «takeAway должен бренду 50 руб.», «В расчёте».
   */
  owes(cents: number): string {
    return this.translate.instant(`admin.settlements.owes.${this.viewer()}.${this.sign(cents)}`, {
      amount: this.money(Math.abs(cents)),
    });
  }

  /** Money that moved or will move: «Бренд → takeAway 50 руб.», «нет». */
  flow(cents: number): string {
    if (!cents) return this.translate.instant('admin.settlements.balance.none');
    const direction: SettlementDirection = cents > 0 ? 'BRAND_TO_TAKEAWAY' : 'TAKEAWAY_TO_BRAND';
    return `${this.translate.instant(`admin.settlements.direction.${direction}`)} ${this.money(Math.abs(cents))}`;
  }

  /** «Вы платите takeAway 50 руб.», «takeAway платит бренду 50 руб.». */
  paysText(direction: SettlementDirection, amountCents: number): string {
    return this.translate.instant(`admin.settlements.payout.pays.${this.viewer()}.${direction}`, {
      amount: this.money(amountCents),
    });
  }

  /** «Ждёт оплаты», «Оплачено — ждёт подтверждения», «Получено 27.10», «Не получено». */
  statusText(payout: SettlementPayout): string {
    if (payout.status === 'CONFIRMED' && payout.confirmedAt) {
      return this.translate.instant('admin.settlements.payouts.confirmedOn', {
        date: this.shortDay(payout.confirmedAt),
      });
    }
    return this.translate.instant(`admin.settlements.payouts.statuses.${payout.status}`);
  }

  actions(payout: SettlementPayout): SettlementActions {
    return settlementActions(payout, this.side());
  }

  refText(payout: SettlementPayout): string {
    return [payout.reference, payout.comment].filter((v): v is string => !!v).join(' · ') || '—';
  }

  /** A figure of the daily table; a column an older API does not send reads «—». */
  cell(column: keyof SettlementTotals, value: number | undefined): string {
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
            this.translate.instant('admin.settlements.payout.fixed', {
              amount: this.paysText(payout.direction, payout.amountCents),
            }),
          );
          this.reload();
        },
        error: (err) => this.fail(err),
      });
  }

  startPaid(payout: SettlementPayout): void {
    this.disputing.set(null);
    this.paidReference.set(payout.reference ?? '');
    this.paying.set(payout.id);
  }

  confirmPaid(payout: SettlementPayout): void {
    this.begin();
    this.api.markPaid(payout.id, { reference: this.paidReference().trim() || undefined }).subscribe({
      next: () => this.done('admin.settlements.payouts.markedPaid'),
      error: (err) => this.fail(err),
    });
  }

  /** «Получено» is final: it asks once. */
  received(payout: SettlementPayout): void {
    const ok = window.confirm(
      this.translate.instant('admin.settlements.payouts.receivedConfirm', {
        amount: this.money(payout.amountCents),
        from: this.day(payout.periodFrom),
        to: this.day(payout.periodTo),
      }),
    );
    if (!ok) return;
    this.begin();
    this.api.confirm(payout.id, { received: true }).subscribe({
      next: () => this.done('admin.settlements.payouts.confirmed'),
      error: (err) => this.fail(err),
    });
  }

  startDispute(payout: SettlementPayout): void {
    this.paying.set(null);
    this.disputeComment.set('');
    this.disputing.set(payout.id);
  }

  /** «Не получено» with the receiver's words — the payer needs to know what to check. */
  sendDispute(payout: SettlementPayout): void {
    const comment = this.disputeComment().trim();
    if (!comment) return;
    this.begin();
    this.api.confirm(payout.id, { received: false, comment }).subscribe({
      next: () => this.done('admin.settlements.payouts.disputed'),
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
    this.begin();
    this.api.deletePayout(payout.id).subscribe({
      next: () => this.done(null),
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

  private begin(): void {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
  }

  /** A step went through: close the inline forms, say so, re-read the report. */
  private done(noticeKey: string | null): void {
    this.busy.set(false);
    this.paying.set(null);
    this.disputing.set(null);
    if (noticeKey) this.notice.set(this.translate.instant(noticeKey));
    this.reload();
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
