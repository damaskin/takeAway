import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import type { TakeawayPromo } from '@takeaway/shared-types';

import { apiErrorMessage } from '../../core/http/api-error';
import { TakeawayPromosApi } from '../../core/takeaway-promos/takeaway-promos.service';
import { TAKEAWAY_PROMO_STATUS_ERRORS } from './takeaway-promo-errors';
import { TAKEAWAY_PROMO_STYLES } from './takeaway-promo.styles';

/**
 * The «Акции» tab of «Акции takeAway»: every promo with its budget, what is
 * spent and left, where it stands now, and the way to its form and report.
 * Switching off and on happens in the row — it never touches orders already
 * placed, so it asks nothing.
 */
@Component({
  selector: 'app-takeaway-promo-list',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <section class="tpl">
      <div class="tpl-bar">
        <button type="button" class="tp-action" (click)="load()" [disabled]="loading()">
          {{ (loading() ? 'common.refreshing' : 'common.refresh') | translate }}
        </button>
        <a routerLink="/takeaway-promos/new" class="tp-action tp-action-main" data-testid="takeaway-promo-new">
          {{ 'admin.takeawayPromos.newPromo' | translate }}
        </a>
      </div>

      @if (error(); as e) {
        <p class="tpl-error" role="alert">{{ e }}</p>
      }

      <article class="tpl-card">
        @if (promos().length === 0) {
          <p class="tpl-empty">
            {{
              (loading()
                ? 'admin.takeawayPromos.loading'
                : loadFailed()
                  ? 'admin.takeawayPromos.loadError'
                  : 'admin.takeawayPromos.empty'
              ) | translate
            }}
          </p>
        } @else {
          <div class="tpl-wrap">
            <table class="tpl-table">
              <thead>
                <tr>
                  <th scope="col">
                    {{ 'admin.takeawayPromos.cols.name' | translate }} ·
                    {{ 'admin.takeawayPromos.cols.code' | translate }}
                  </th>
                  <th scope="col" class="num">{{ 'admin.takeawayPromos.cols.percent' | translate }}</th>
                  <th scope="col">{{ 'admin.takeawayPromos.cols.period' | translate }}</th>
                  <th scope="col">{{ 'admin.takeawayPromos.cols.currency' | translate }}</th>
                  <th scope="col">{{ 'admin.takeawayPromos.cols.budget' | translate }}</th>
                  <th scope="col" class="num">{{ 'admin.takeawayPromos.cols.orders' | translate }}</th>
                  <th scope="col">{{ 'admin.takeawayPromos.cols.status' | translate }}</th>
                  <th scope="col">{{ 'admin.takeawayPromos.cols.actions' | translate }}</th>
                </tr>
              </thead>
              <tbody>
                @for (p of promos(); track p.id) {
                  <tr data-testid="takeaway-promo-row">
                    <td>
                      <a class="tpl-name" [routerLink]="['/takeaway-promos', p.id, 'report']">{{ p.name }}</a>
                      <div class="tpl-code">{{ p.code }}</div>
                      @if (p.isWelcome) {
                        <span class="tp-badge tpl-welcome">{{ 'admin.takeawayPromos.welcomeBadge' | translate }}</span>
                      }
                    </td>
                    <td class="num tpl-strong">
                      {{ 'admin.takeawayPromos.percentValue' | translate: { percent: p.percent } }}
                    </td>
                    <td class="tpl-small">
                      <div>{{ fmt.date(p.startsAt) }} —</div>
                      <div>{{ fmt.date(p.endsAt) }}</div>
                    </td>
                    <td class="tpl-muted">{{ p.currency }}</td>
                    <td>
                      <div class="tpl-budget">
                        <span class="tpl-strong">{{ money(p.budgetCents, p.currency) }}</span>
                        <div
                          class="tp-meter"
                          role="meter"
                          aria-valuemin="0"
                          [attr.aria-valuemax]="p.budgetCents"
                          [attr.aria-valuenow]="p.spentCents"
                          [attr.aria-label]="'admin.takeawayPromos.cols.budget' | translate"
                          [attr.data-full]="p.leftCents <= 0"
                        >
                          <span [style.width.%]="spentShare(p)"></span>
                        </div>
                        <span class="tpl-small">{{
                          'admin.takeawayPromos.budgetLine'
                            | translate
                              : { spent: money(p.spentCents, p.currency), left: money(p.leftCents, p.currency) }
                        }}</span>
                      </div>
                    </td>
                    <td class="num">{{ p.redemptionsCount }}</td>
                    <td>
                      <span class="tp-status" [attr.data-status]="p.effectiveStatus">{{
                        'admin.takeawayPromos.status.' + p.effectiveStatus | translate
                      }}</span>
                    </td>
                    <td>
                      <div class="tpl-actions">
                        <a class="tp-action" [routerLink]="['/takeaway-promos', p.id]">{{
                          'admin.takeawayPromos.actions.edit' | translate
                        }}</a>
                        <a class="tp-action" [routerLink]="['/takeaway-promos', p.id, 'report']">{{
                          'admin.takeawayPromos.actions.report' | translate
                        }}</a>
                        @if (p.status === 'ACTIVE') {
                          <button
                            type="button"
                            class="tp-action tp-action-danger"
                            [disabled]="busyId() === p.id"
                            (click)="setStatus(p, 'DISABLED')"
                          >
                            {{ 'admin.takeawayPromos.actions.disable' | translate }}
                          </button>
                        } @else {
                          <button
                            type="button"
                            class="tp-action tp-action-main"
                            [disabled]="busyId() === p.id || p.leftCents <= 0"
                            (click)="setStatus(p, 'ACTIVE')"
                          >
                            {{ 'admin.takeawayPromos.actions.enable' | translate }}
                          </button>
                        }
                      </div>
                      @if (p.status !== 'ACTIVE' && p.leftCents <= 0) {
                        <p class="tpl-small tpl-blocked">
                          {{ 'admin.takeawayPromos.actions.enableBlocked' | translate }}
                        </p>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </article>
    </section>
  `,
  styles: [
    TAKEAWAY_PROMO_STYLES,
    `
      .tpl {
        padding: 16px clamp(16px, 4vw, 24px) 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        font-family: var(--font-sans);
      }
      .tpl-bar {
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: 8px;
      }
      .tpl-error {
        margin: 0;
        font-size: 13px;
        color: var(--color-berry);
      }
      .tpl-card {
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: 20px;
        overflow: hidden;
      }
      .tpl-wrap {
        overflow-x: auto;
      }
      .tpl-empty {
        margin: 0;
        padding: 40px 16px;
        text-align: center;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .tpl-table {
        width: 100%;
        border-collapse: collapse;
      }
      .tpl-table thead {
        background: var(--color-cream);
      }
      .tpl-table th {
        padding: 12px 10px;
        text-align: left;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        white-space: nowrap;
        color: var(--color-text-tertiary);
      }
      .tpl-table td {
        padding: 12px 10px;
        border-top: 1px solid var(--color-border-light);
        font-size: 14px;
        color: var(--color-text-primary);
        vertical-align: top;
      }
      .tpl-table .num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .tpl-name {
        font-weight: 600;
        color: var(--color-espresso);
        text-decoration: none;
      }
      .tpl-code {
        margin-top: 2px;
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 700;
        color: var(--color-caramel);
      }
      .tpl-welcome {
        margin: 6px 0 0;
      }
      .tpl-strong {
        font-weight: 600;
      }
      .tpl-muted {
        color: var(--color-text-secondary) !important;
      }
      .tpl-small {
        font-size: 12px;
        color: var(--color-text-secondary);
        white-space: nowrap;
      }
      .tpl-budget {
        min-width: 170px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .tpl-budget .tpl-small {
        white-space: normal;
      }
      .tpl-actions {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
      }
      .tpl-blocked {
        margin: 6px 0 0;
        white-space: normal;
        max-width: 160px;
      }
    `,
  ],
})
export class TakeawayPromoListPage {
  private readonly api = inject(TakeawayPromosApi);
  private readonly translate = inject(TranslateService);
  readonly fmt = inject(LocaleFormatService);

  readonly promos = signal<TakeawayPromo[]>([]);
  readonly loading = signal(false);
  readonly loadFailed = signal(false);
  readonly error = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.api.list().subscribe({
      next: (list) => {
        this.promos.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadFailed.set(true);
      },
    });
  }

  setStatus(promo: TakeawayPromo, status: 'ACTIVE' | 'DISABLED'): void {
    this.busyId.set(promo.id);
    this.error.set(null);
    this.api.setStatus(promo.id, status).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.promos.update((list) => list.map((p) => (p.id === updated.id ? updated : p)));
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(apiErrorMessage(err, this.translate, TAKEAWAY_PROMO_STATUS_ERRORS));
      },
    });
  }

  money(cents: number, currency: string): string {
    return this.fmt.money(cents, currency);
  }

  /** How full the budget bar is, 0..100. */
  spentShare(promo: TakeawayPromo): number {
    if (promo.budgetCents <= 0) return 0;
    return Math.min(100, Math.round((promo.spentCents / promo.budgetCents) * 1000) / 10);
  }
}
