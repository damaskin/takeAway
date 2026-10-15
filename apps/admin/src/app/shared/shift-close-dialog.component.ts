import { Component, DestroyRef, afterNextRender, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { apiErrorCode, apiErrorMessage } from '../core/http/api-error';
import { KitchenApi, type ShiftCloseSummary, type StoreShift } from '../core/kitchen/kitchen.api';
import { ConfirmDialogComponent } from './confirm-dialog.component';

/**
 * "Finish work", asked properly: what the close would leave behind, read
 * from `GET /kds/shift/close-summary` when the dialog opens.
 *
 * - Orders due soon that nobody accepted block it (the API answers 409
 *   `SHIFT_HAS_UNACCEPTED_ORDERS` too): accept or reject them first.
 * - Orders being made or ready stay on the board: finish them.
 * - Pre-orders for later come to the board in the next shift.
 *
 * Used on the kitchen board and on the store cards of «Точки»; replaces the
 * old `window.confirm`.
 */
@Component({
  selector: 'app-shift-close-dialog',
  standalone: true,
  imports: [TranslatePipe, ConfirmDialogComponent],
  template: `
    <app-confirm-dialog
      tone="danger"
      [title]="'admin.kitchen.shiftClose.title' | translate"
      [body]="
        (storeName() ? 'admin.kitchen.shiftClose.bodyStore' : 'admin.kitchen.shiftClose.body')
          | translate: { store: storeName() }
      "
      [confirmLabel]="(closing() ? 'admin.kitchen.working' : 'admin.kitchen.shift.finish') | translate"
      [cancelLabel]="'common.cancel' | translate"
      [busy]="closing() || loading() || blocked()"
      (confirmed)="close()"
      (cancelled)="cancelled.emit()"
    >
      @if (loading()) {
        <p class="close-note">{{ 'common.loading' | translate }}</p>
      } @else if (summary(); as s) {
        <ul class="close-list">
          @if (s.awaitingAcceptance > 0) {
            <li class="close-row close-block" data-testid="close-blocked">
              {{ 'admin.kitchen.shiftClose.awaiting' | translate: { count: s.awaitingAcceptance } }}
            </li>
          }
          @if (s.inProgress > 0) {
            <li class="close-row close-warn">
              {{ 'admin.kitchen.shiftClose.inProgress' | translate: { count: s.inProgress } }}
            </li>
          }
          @if (s.ready > 0) {
            <li class="close-row close-warn">{{ 'admin.kitchen.shiftClose.ready' | translate: { count: s.ready } }}</li>
          }
          @if (s.later > 0) {
            <li class="close-row close-info">{{ 'admin.kitchen.shiftClose.later' | translate: { count: s.later } }}</li>
          }
          @if (empty()) {
            <li class="close-row close-info">{{ 'admin.kitchen.shiftClose.empty' | translate }}</li>
          }
        </ul>
      }
      @if (error()) {
        <p class="close-error" role="alert">{{ error() }}</p>
      }
    </app-confirm-dialog>
  `,
  styles: [
    `
      .close-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .close-row,
      .close-note {
        margin: 0;
        padding: 10px 12px;
        border-radius: 10px;
        font-family: var(--font-sans);
        font-size: 14px;
        line-height: 1.45;
        color: var(--color-text-primary);
        background: var(--color-cream);
      }
      .close-block {
        border-left: 3px solid var(--color-berry);
        font-weight: 600;
      }
      .close-warn {
        border-left: 3px solid var(--color-amber);
      }
      .close-info {
        border-left: 3px solid var(--color-mint);
      }
      .close-error {
        margin: 0;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-berry);
      }
    `,
  ],
})
export class ShiftCloseDialogComponent {
  private readonly api = inject(KitchenApi);
  private readonly translate = inject(TranslateService);

  readonly storeId = input.required<string>();
  /** Named in the question when the dialog is opened away from the board (the store cards). */
  readonly storeName = input('');

  /** The shift as the API left it once closed. */
  readonly closed = output<StoreShift>();
  readonly cancelled = output<void>();

  readonly summary = signal<ShiftCloseSummary | null>(null);
  readonly loading = signal(true);
  readonly closing = signal(false);
  readonly error = signal<string | null>(null);
  readonly blocked = computed(() => (this.summary()?.awaitingAcceptance ?? 0) > 0);
  readonly empty = computed(() => {
    const s = this.summary();
    return !!s && s.awaitingAcceptance + s.inProgress + s.ready + s.later === 0;
  });

  private alive = true;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.alive = false));
    afterNextRender(() => this.load());
  }

  close(): void {
    if (this.closing() || this.blocked()) return;
    this.closing.set(true);
    this.error.set(null);
    this.api.setShift(this.storeId(), false).subscribe({
      next: (shift) => {
        this.closing.set(false);
        this.closed.emit(shift);
      },
      error: (err) => {
        this.closing.set(false);
        if (apiErrorCode(err) === 'SHIFT_HAS_UNACCEPTED_ORDERS') {
          // An order came in while the dialog was open: show it.
          this.load();
          return;
        }
        this.error.set(
          apiErrorMessage(err, this.translate, {
            network: 'common.networkError',
            statuses: { 403: 'common.forbidden' },
          }),
        );
      },
    });
  }

  private load(): void {
    this.loading.set(true);
    this.api.closeSummary(this.storeId()).subscribe({
      next: (summary) => {
        if (!this.alive) return;
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: (err) => {
        if (!this.alive) return;
        this.loading.set(false);
        // Without the summary the API still refuses a close that would strand orders.
        this.summary.set(null);
        this.error.set(apiErrorMessage(err, this.translate, { network: 'common.networkError' }));
      },
    });
  }
}
