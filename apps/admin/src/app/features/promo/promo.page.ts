import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { type Promo, type PromoStatus, isPromoEditable, promoNextStatuses } from '@takeaway/shared-types';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import { map } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { campaignLink, parseInactiveDays } from '../../core/customers/inactive-segment';
import { apiErrorMessage } from '../../core/http/api-error';
import { AdminPromoApi } from '../../core/promo/promo.service';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { PROMO_ERROR_WORDING } from './promo-errors';

type FilterKey = 'All' | 'Running' | 'Scheduled' | 'Expired' | 'Paused' | 'Draft';

const FILTER_MAP: Record<Exclude<FilterKey, 'All'>, PromoStatus> = {
  Running: 'RUNNING',
  Scheduled: 'SCHEDULED',
  Expired: 'EXPIRED',
  Paused: 'PAUSED',
  Draft: 'DRAFT',
};

/** A status move the row offers, with the words on its button. */
interface PromoAction {
  status: PromoStatus;
  label: string;
}

/**
 * Admin Promo / Loyalty — pencil C4 (5fLM7), the «Промокоды» tab of «Акции».
 *
 * Lists /admin/promo with a status filter. Each row says where the promo
 * stands and offers the next steps as buttons — start a draft, pause,
 * resume, end — and opens the form to edit a draft, or a scheduled or
 * paused promo nobody has used yet.
 */
@Component({
  selector: 'app-admin-promo',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ConfirmDialogComponent],
  template: `
    <div class="flex items-center justify-end flex-wrap" style="padding: 16px clamp(16px, 4vw, 24px) 0; gap: 8px">
      <button
        type="button"
        (click)="refresh()"
        [disabled]="loading()"
        class="flex items-center"
        style="height: 36px; padding: 0 14px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
      >
        {{ (loading() ? 'common.refreshing' : 'common.refresh') | translate }}
      </button>
      <a
        routerLink="/promotions/promo/new"
        class="flex items-center"
        style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; text-decoration: none"
      >
        {{ 'admin.promo.newPromo' | translate }}
      </a>
    </div>

    <section style="padding: 16px clamp(16px, 4vw, 24px) 24px; display: flex; flex-direction: column; gap: 24px">
      @if (created(); as c) {
        <div class="promo-created" role="status">
          <span>{{ 'admin.promo.created.title' | translate: { code: c.code } }}</span>
          @if (c.broadcast; as link) {
            <a [routerLink]="link.commands" [queryParams]="link.queryParams">{{
              'admin.promo.created.broadcast' | translate
            }}</a>
          }
          <button type="button" (click)="dismissCreated()">{{ 'admin.promo.created.dismiss' | translate }}</button>
        </div>
      }

      <!-- Loyalty tier cards (static — tiers come from M5 analytics) -->
      <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px">
        @for (t of tiers; track t.name) {
          <article
            class="flex flex-col"
            [style.background]="t.gradient"
            style="border-radius: 20px; padding: 20px; gap: 8px; color: white"
          >
            <span
              style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.8); letter-spacing: 1px"
              >{{ t.name.toUpperCase() }}</span
            >
            <span style="font-family: var(--font-display); font-size: 28px; font-weight: 700">{{ t.members }}</span>
            <span style="font-family: var(--font-sans); font-size: 12px; color: rgba(255,255,255,0.8)"
              >{{ t.threshold }} {{ 'admin.promo.tiers.pointsSuffix' | translate }} · {{ t.benefit | translate }}</span
            >
          </article>
        }
      </div>

      @if (error(); as e) {
        <p role="alert" style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">
          {{ e }}
        </p>
      }

      <!-- Promos table -->
      <article
        class="flex flex-col"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; overflow: hidden; overflow-x: auto"
      >
        <header
          class="flex items-center justify-between flex-wrap"
          style="padding: 20px; border-bottom: 1px solid var(--color-border-light); gap: 12px"
        >
          <div class="flex flex-col" style="gap: 4px">
            <h2
              style="font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso); margin: 0"
            >
              {{ 'admin.promo.table.title' | translate }}
            </h2>
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)">{{
              'admin.promo.table.subtitle' | translate: { total: promos().length, running: runningCount() }
            }}</span>
          </div>
          <div class="flex flex-wrap" style="gap: 8px">
            @for (f of filters; track f) {
              <button
                type="button"
                (click)="filter.set(f)"
                [style.background]="filter() === f ? 'var(--color-caramel)' : 'var(--color-cream)'"
                [style.color]="filter() === f ? 'white' : 'var(--color-text-primary)'"
                style="height: 30px; padding: 0 14px; border-radius: 9999px; font-family: var(--font-sans); font-size: 12px; font-weight: 600"
              >
                {{ 'admin.promo.filters.' + f.toLowerCase() | translate }}
              </button>
            }
          </div>
        </header>

        @if (filtered().length === 0) {
          <p
            class="text-center"
            style="padding: 40px; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
          >
            @if (loading()) {
              {{ 'admin.promo.table.loading' | translate }}
            } @else {
              {{ 'admin.promo.table.empty' | translate }}
            }
          </p>
        } @else {
          <table class="promo-table">
            <thead>
              <tr>
                <th>{{ 'admin.promo.table.code' | translate }}</th>
                <th>{{ 'admin.promo.table.label' | translate }}</th>
                <th>{{ 'admin.promo.table.type' | translate }}</th>
                <th class="num">{{ 'admin.promo.table.value' | translate }}</th>
                <th>{{ 'admin.promo.table.window' | translate }}</th>
                <th class="num">{{ 'admin.promo.table.usage' | translate }}</th>
                <th>{{ 'admin.promo.table.status' | translate }}</th>
                <th>{{ 'admin.promo.actions.title' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (p of filtered(); track p.id) {
                <tr>
                  <td class="promo-code">
                    <a [routerLink]="['/promotions/promo', p.id]">{{ p.code }}</a>
                  </td>
                  <td>
                    {{ p.label }}
                    @if (p.inactiveDays) {
                      <div class="promo-audience">
                        {{ 'admin.promo.audienceBadge' | translate: { days: p.inactiveDays } }}
                      </div>
                    }
                  </td>
                  <td class="promo-muted">{{ 'admin.promo.type.' + p.type | translate }}</td>
                  <td class="num promo-strong">{{ formatValue(p) }}</td>
                  <td class="promo-muted promo-small">{{ formatWindow(p) }}</td>
                  <td class="num promo-muted">
                    {{ p.redemptionsCount }}{{ p.maxRedemptions > 0 ? '/' + p.maxRedemptions : '' }}
                  </td>
                  <td>
                    <span
                      class="promo-status"
                      [style.background]="statusBg(p.status)"
                      [style.color]="statusColor(p.status)"
                    >
                      {{ 'admin.promo.status.' + p.status | translate }}
                    </span>
                  </td>
                  <td>
                    <div class="promo-actions">
                      @if (editable(p)) {
                        <a [routerLink]="['/promotions/promo', p.id]" class="promo-action">{{
                          'admin.promo.actions.edit' | translate
                        }}</a>
                      }
                      @for (a of actions(p); track a.status) {
                        <button
                          type="button"
                          class="promo-action"
                          [class.promo-action-main]="a.status === 'RUNNING'"
                          [class.promo-action-danger]="a.status === 'EXPIRED'"
                          [disabled]="busyId() === p.id"
                          (click)="act(p, a.status)"
                        >
                          {{ a.label | translate }}
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </article>
    </section>

    @if (ending(); as p) {
      <app-confirm-dialog
        tone="danger"
        [title]="'admin.promo.actions.endConfirmTitle' | translate: { code: p.code }"
        [body]="'admin.promo.actions.endConfirmBody' | translate"
        [confirmLabel]="'admin.promo.actions.end' | translate"
        [cancelLabel]="'common.cancel' | translate"
        [busy]="busyId() === p.id"
        (confirmed)="setStatus(p, 'EXPIRED')"
        (cancelled)="ending.set(null)"
      />
    }
  `,
  styles: [
    `
      .promo-table {
        width: 100%;
        border-collapse: collapse;
        font-family: var(--font-sans);
      }
      .promo-table thead {
        background: var(--color-cream);
      }
      .promo-table th {
        text-align: left;
        padding: 12px;
        font-size: 11px;
        font-weight: 600;
        color: var(--color-text-tertiary);
        letter-spacing: 0.5px;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .promo-table td {
        padding: 12px;
        font-size: 14px;
        color: var(--color-text-primary);
        border-top: 1px solid var(--color-border-light);
        vertical-align: top;
      }
      .promo-table .num {
        text-align: right;
      }
      .promo-code a {
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 700;
        color: var(--color-caramel);
        text-decoration: none;
      }
      .promo-muted {
        font-size: 13px;
        color: var(--color-text-secondary) !important;
      }
      .promo-small {
        font-size: 12px !important;
        white-space: nowrap;
      }
      .promo-strong {
        font-weight: 600;
      }
      .promo-audience {
        margin-top: 4px;
        font-size: 11px;
        font-weight: 600;
        color: var(--chart-warning);
      }
      .promo-status {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
      }
      .promo-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .promo-action {
        height: 28px;
        padding: 0 10px;
        display: inline-flex;
        align-items: center;
        border-radius: 9999px;
        border: 1px solid var(--color-border);
        background: var(--color-foam);
        color: var(--color-text-primary);
        font-size: 12px;
        font-weight: 600;
        text-decoration: none;
        white-space: nowrap;
        cursor: pointer;
      }
      .promo-action:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .promo-action-main {
        background: var(--color-caramel);
        border-color: transparent;
        color: white;
      }
      .promo-action-danger {
        color: var(--color-berry);
      }
      .promo-created {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px 16px;
        padding: 12px 16px;
        border-radius: 14px;
        background: var(--color-caramel-light);
        font-family: var(--font-sans);
        font-size: 14px;
        color: var(--color-espresso);
      }
      .promo-created a {
        font-weight: 600;
        color: var(--color-caramel);
      }
      .promo-created button {
        margin-left: auto;
        border: 0;
        background: none;
        color: var(--color-text-secondary);
        font-size: 13px;
        cursor: pointer;
      }
    `,
  ],
})
export class AdminPromoPage implements OnInit {
  private readonly api = inject(AdminPromoApi);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly fmt = inject(LocaleFormatService);
  private readonly router = inject(Router);

  readonly filter = signal<FilterKey>('All');
  readonly filters: FilterKey[] = ['All', 'Running', 'Scheduled', 'Paused', 'Draft', 'Expired'];

  readonly loading = signal(false);
  readonly promos = signal<Promo[]>([]);
  readonly error = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);
  /** The promo whose «Завершить» waits for a yes. */
  readonly ending = signal<Promo | null>(null);

  /**
   * The code the form just saved (`?created=CODE`), with the way on to a
   * campaign when it is a code for inactive customers.
   */
  readonly created = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(
      map((q) => {
        const code = q.get('created');
        if (!code) return null;
        const days = parseInactiveDays(q.get('inactiveDays'));
        return {
          code,
          broadcast: days ? campaignLink({ days, storeId: q.get('storeId') }, code) : null,
        };
      }),
    ),
    { initialValue: null },
  );

  readonly tiers = [
    {
      name: 'Silver',
      members: '—',
      threshold: '0',
      benefit: 'admin.promo.tiers.silverBenefit',
      gradient: 'linear-gradient(135deg, #A39888 0%, #6B5E54 100%)',
    },
    {
      name: 'Gold',
      members: '—',
      threshold: '1,500',
      benefit: 'admin.promo.tiers.goldBenefit',
      gradient: 'linear-gradient(135deg, var(--color-caramel) 0%, #a0612a 100%)',
    },
    {
      name: 'Platinum',
      members: '—',
      threshold: '3,000',
      benefit: 'admin.promo.tiers.platinumBenefit',
      gradient: 'linear-gradient(135deg, #8E5FB0 0%, #5B3D78 100%)',
    },
    {
      name: 'Signature',
      members: '—',
      threshold: '10,000',
      benefit: 'admin.promo.tiers.signatureBenefit',
      gradient: 'linear-gradient(135deg, #1a1414 0%, #3a3430 100%)',
    },
  ];

  readonly filtered = computed<Promo[]>(() => {
    const all = this.promos();
    const f = this.filter();
    if (f === 'All') return all;
    const target = FILTER_MAP[f];
    return all.filter((p) => p.status === target);
  });

  readonly runningCount = computed(() => this.promos().filter((p) => p.status === 'RUNNING').length);

  constructor() {
    // Re-list whenever the active brand changes.
    effect(() => {
      const brandId = this.activeBrand.activeId();
      if (!brandId) {
        this.promos.set([]);
        return;
      }
      this.load(brandId);
    });
  }

  ngOnInit(): void {
    if (!this.activeBrand.loaded()) this.activeBrand.refresh();
  }

  refresh(): void {
    const brandId = this.activeBrand.activeId();
    if (brandId) this.load(brandId);
  }

  editable(p: Promo): boolean {
    return isPromoEditable(p);
  }

  /** The next steps from where the promo stands: start, pause, resume, end. */
  actions(p: Promo): PromoAction[] {
    return promoNextStatuses(p).map((status) => ({
      status,
      label:
        status === 'EXPIRED'
          ? 'admin.promo.actions.end'
          : status === 'PAUSED'
            ? 'admin.promo.actions.pause'
            : p.status === 'DRAFT'
              ? 'admin.promo.actions.start'
              : 'admin.promo.actions.resume',
    }));
  }

  /** Ending cannot be undone, so it asks first; the other moves happen at once. */
  act(p: Promo, status: PromoStatus): void {
    if (status === 'EXPIRED') {
      this.ending.set(p);
      return;
    }
    this.setStatus(p, status);
  }

  setStatus(p: Promo, status: PromoStatus): void {
    this.busyId.set(p.id);
    this.error.set(null);
    this.api.updateStatus(p.id, status).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.ending.set(null);
        this.promos.update((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      },
      error: (err) => {
        this.busyId.set(null);
        this.ending.set(null);
        this.error.set(
          apiErrorMessage(err, this.translate, {
            ...PROMO_ERROR_WORDING,
            statuses: { 500: 'admin.promo.errors.statusFailed' },
          }),
        );
      },
    });
  }

  dismissCreated(): void {
    void this.router.navigate([], {
      queryParams: { created: null, inactiveDays: null, storeId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  formatValue(p: Promo): string {
    switch (p.type) {
      case 'PERCENT':
        return this.translate.instant('admin.promo.value.percent', { value: p.value });
      case 'FIXED':
        return this.translate.instant('admin.promo.value.fixed', {
          value: this.fmt.money(p.value, this.activeBrand.active()?.currency),
        });
      case 'BOGO':
        return this.translate.instant('admin.promo.value.bogo');
      case 'POINTS_MULTIPLIER':
        return this.translate.instant('admin.promo.value.pointsMultiplier', { value: (p.value / 10).toFixed(1) });
      default:
        return String(p.value);
    }
  }

  formatWindow(p: Promo): string {
    return `${this.fmt.date(p.startsAt)} — ${this.fmt.date(p.endsAt)}`;
  }

  statusBg(status: PromoStatus): string {
    if (status === 'RUNNING') return '#7BC4A433';
    if (status === 'SCHEDULED') return 'var(--color-caramel-light)';
    if (status === 'PAUSED') return '#E9A84B33';
    if (status === 'EXPIRED') return '#D94B5E22';
    return 'var(--color-surface-variant)';
  }

  statusColor(status: PromoStatus): string {
    if (status === 'RUNNING') return '#3E8868';
    if (status === 'SCHEDULED') return 'var(--color-caramel)';
    if (status === 'PAUSED') return '#8A6720';
    if (status === 'EXPIRED') return '#8F2F3C';
    return 'var(--color-text-secondary)';
  }

  private load(brandId: string): void {
    this.loading.set(true);
    this.api.list(brandId).subscribe({
      next: (list) => {
        this.promos.set(list);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
