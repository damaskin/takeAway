import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { KitchenApi } from '../../core/kitchen/kitchen.api';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';

/**
 * Store management on the dashboard: every store with its shift and a
 * "Start work" / "Finish work" button — the same shift the kitchen board
 * and the stores page open and close.
 */
@Component({
  selector: 'app-store-shifts-widget',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
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
          <li class="shift-row">
            <div class="shift-name">
              <span class="shift-dot" [class.shift-dot-on]="s.shiftOpen && s.status !== 'CLOSED'"></span>
              <span>{{ s.name }}</span>
            </div>
            @if (s.status === 'CLOSED') {
              <span class="shift-state">{{ 'admin.dashboard.shifts.storeClosed' | translate }}</span>
            } @else {
              <span class="shift-state">{{
                (s.shiftOpen ? 'admin.stores.shift.open' : 'admin.stores.shift.closed') | translate
              }}</span>
              @if (canToggle()) {
                <button
                  type="button"
                  class="shift-btn"
                  [class.shift-btn-start]="!s.shiftOpen"
                  [disabled]="busyId() === s.id"
                  (click)="toggle(s)"
                >
                  {{ (s.shiftOpen ? 'admin.kitchen.shift.finish' : 'admin.kitchen.shift.start') | translate }}
                </button>
              }
            }
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
        align-items: center;
        flex-wrap: wrap;
        gap: 8px 12px;
        padding: 10px 12px;
        border: 1px solid var(--color-border-light);
        border-radius: 14px;
        font-family: var(--font-sans);
        font-size: 14px;
      }
      .shift-name {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1 1 140px;
        min-width: 0;
        color: var(--color-text-primary);
        font-weight: 500;
      }
      .shift-dot {
        width: 8px;
        height: 8px;
        border-radius: 9999px;
        background: var(--color-border);
        flex: none;
      }
      .shift-dot-on {
        background: #3e8868;
      }
      .shift-state {
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .shift-btn {
        height: 32px;
        padding: 0 12px;
        border-radius: var(--radius-button);
        border: 1px solid var(--color-border);
        background: transparent;
        color: var(--color-text-primary);
        font-family: var(--font-sans);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      .shift-btn-start {
        border-color: transparent;
        background: var(--color-caramel);
        color: white;
      }
      .shift-btn:disabled {
        opacity: 0.5;
      }
    `,
  ],
})
export class StoreShiftsWidgetComponent {
  private readonly catalog = inject(AdminCatalogApi);
  private readonly kitchen = inject(KitchenApi);
  private readonly translate = inject(TranslateService);

  readonly brandId = input.required<string>();
  /** Whether the viewer may open and close shifts; the API decides in the end. */
  readonly canToggle = input(true);

  readonly stores = signal<StoreAdminDto[]>([]);
  readonly loaded = signal(false);
  readonly busyId = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const brandId = this.brandId();
      untracked(() => {
        this.loaded.set(false);
        this.catalog.listStores(brandId).subscribe({
          next: (list) => {
            this.stores.set(list);
            this.loaded.set(true);
          },
          error: (err) => {
            this.loaded.set(true);
            this.error.set(apiErrorMessage(err, this.translate, { network: 'common.networkError' }));
          },
        });
      });
    });
  }

  toggle(store: StoreAdminDto): void {
    const open = !store.shiftOpen;
    if (!open && !confirm(this.translate.instant('admin.kitchen.shift.finishConfirm'))) return;
    this.busyId.set(store.id);
    this.error.set(null);
    this.kitchen.setShift(store.id, open).subscribe({
      next: (shift) => {
        this.busyId.set(null);
        this.stores.update((list) => list.map((s) => (s.id === store.id ? { ...s, shiftOpen: shift.open } : s)));
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(apiErrorMessage(err, this.translate, { network: 'common.networkError' }));
      },
    });
  }
}
