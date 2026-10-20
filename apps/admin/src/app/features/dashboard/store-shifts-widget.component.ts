import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { interval } from 'rxjs';

import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { KitchenApi, type StoreShift } from '../../core/kitchen/kitchen.api';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';
import { StoreScheduleStatusComponent } from '../../shared/store-schedule-status.component';

/**
 * The stores on the dashboard, each with where it stands by its schedule —
 * open until when, extended, closed and when it opens, paused. Since
 * 2026-10-20 the working hours open and close the shift, so there are no
 * "Start work" / "Finish work" buttons here any more.
 */
@Component({
  selector: 'app-store-shifts-widget',
  standalone: true,
  imports: [RouterLink, TranslatePipe, StoreScheduleStatusComponent],
  template: `
    <article class="dash-card">
      <header class="dash-card-head">
        <h2>{{ 'admin.dashboard.shifts.title' | translate }}</h2>
        <a routerLink="/stores">{{ 'admin.dashboard.viewAll' | translate }}</a>
      </header>
      @if (stores().length === 0) {
        <p class="dash-muted">{{ (loaded() ? 'admin.dashboard.shifts.empty' : 'common.loading') | translate }}</p>
      }
      <ul class="shift-list">
        @for (s of stores(); track s.id) {
          <li class="shift-row" [attr.data-testid]="'dashboard-store-' + s.id">
            <span class="shift-name">{{ s.name }}</span>
            <app-store-schedule-status
              [shift]="shifts()[s.id] ?? null"
              [storeStatus]="s.status"
              [timezone]="s.timezone"
              [now]="now()"
            />
          </li>
        }
      </ul>
      @if (error(); as e) {
        <p class="dash-error" role="alert">{{ e }}</p>
      }
    </article>
  `,
  styles: [
    DASH_CARD_STYLES,
    `
      :host {
        display: block;
      }
      .shift-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .shift-row {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px 12px;
        border: 1px solid var(--color-border-light);
        border-radius: 14px;
        font-family: var(--font-sans);
      }
      .shift-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
      }
    `,
  ],
})
export class StoreShiftsWidgetComponent {
  private readonly catalog = inject(AdminCatalogApi);
  private readonly kitchen = inject(KitchenApi);
  private readonly translate = inject(TranslateService);

  readonly brandId = input.required<string>();

  readonly stores = signal<StoreAdminDto[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  /** Each store's shift, for its schedule line. */
  readonly shifts = signal<Readonly<Record<string, StoreShift>>>({});
  readonly now = signal(Date.now());

  constructor() {
    effect(() => {
      const brandId = this.brandId();
      untracked(() => {
        this.loaded.set(false);
        this.catalog.listStores(brandId).subscribe({
          next: (list) => {
            this.stores.set(list);
            this.loaded.set(true);
            this.loadShifts(list);
          },
          error: (err) => {
            this.loaded.set(true);
            this.error.set(apiErrorMessage(err, this.translate, { network: 'common.networkError' }));
          },
        });
      });
    });
    interval(60_000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.now.set(Date.now());
        this.loadShifts(this.stores());
      });
  }

  /** A store switched off reads as such without its shift; one the account cannot run shows its name only. */
  private loadShifts(stores: readonly StoreAdminDto[]): void {
    for (const store of stores) {
      if (store.status === 'CLOSED') continue;
      this.kitchen.shift(store.id).subscribe({
        next: (shift) => this.shifts.update((all) => ({ ...all, [store.id]: shift })),
        error: () => undefined,
      });
    }
  }
}
