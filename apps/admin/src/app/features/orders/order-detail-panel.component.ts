import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AdminOrdersApi, type AdminOrderDetail } from '../../core/orders/orders.service';

/**
 * Order detail drawer, and the only way to issue a refund.
 *
 * The refund endpoint shipped in M5 and no interface could reach it, so a
 * manager facing an unhappy customer had nothing to click. This shows what
 * was ordered, what was charged, what has already been given back, and the
 * event timeline that explains how the order got where it is.
 *
 * The refund control defaults to the full refundable balance because that
 * is the overwhelmingly common case, but the amount stays editable for the
 * "one drink was wrong" conversation. It is irreversible, so it asks once.
 */
@Component({
  selector: 'app-order-detail-panel',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  template: `
    <div
      class="fixed inset-0"
      style="background: rgba(0, 0, 0, 0.35); z-index: 40"
      (click)="closed.emit()"
      (keydown.escape)="closed.emit()"
      tabindex="-1"
    ></div>

    <aside
      class="fixed flex flex-col"
      style="top: 0; right: 0; bottom: 0; width: min(520px, 100vw); background: var(--color-foam); border-left: 1px solid var(--color-border-light); z-index: 41; overflow-y: auto"
      role="dialog"
      aria-modal="true"
    >
      @if (loading()) {
        <p style="padding: 24px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)">
          {{ 'common.loading' | translate }}
        </p>
      } @else if (order(); as o) {
        <!-- Header -->
        <header
          class="flex items-start justify-between"
          style="padding: 20px 24px; border-bottom: 1px solid var(--color-border-light); gap: 12px"
        >
          <div class="flex flex-col" style="gap: 4px">
            <span style="font-family: var(--font-mono); font-size: 20px; font-weight: 700; color: var(--color-caramel)"
              >#{{ o.orderCode }}</span
            >
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
              {{ o.storeName }} · {{ o.status }}
            </span>
          </div>
          <button
            type="button"
            (click)="closed.emit()"
            [attr.aria-label]="'common.close' | translate"
            style="border: none; background: transparent; font-size: 20px; color: var(--color-text-tertiary); cursor: pointer"
          >
            ✕
          </button>
        </header>

        <!-- Customer -->
        <section class="flex flex-col" style="padding: 16px 24px; gap: 6px">
          <h3
            style="font-family: var(--font-sans); font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 1px; margin: 0"
          >
            {{ 'admin.orderDetail.customer' | translate }}
          </h3>
          <span style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)">
            {{ o.customerName || ('admin.orderDetail.noName' | translate) }}
          </span>
          @if (o.customerEmail) {
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
              o.customerEmail
            }}</span>
          }
          @if (o.customerPhone) {
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
              o.customerPhone
            }}</span>
          }
          @if (o.notes) {
            <span
              style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); font-style: italic"
              >“{{ o.notes }}”</span
            >
          }
        </section>

        <!-- Items -->
        <section
          class="flex flex-col"
          style="padding: 16px 24px; gap: 8px; border-top: 1px solid var(--color-border-light)"
        >
          <h3
            style="font-family: var(--font-sans); font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 1px; margin: 0"
          >
            {{ 'admin.orderDetail.items' | translate }}
          </h3>
          @for (item of o.items; track item.id) {
            <div class="flex items-center justify-between">
              <span style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
                >{{ item.quantity }} × {{ item.name }}</span
              >
              <span style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)">{{
                money(item.totalCents, o.currency)
              }}</span>
            </div>
          }

          <div style="height: 1px; background: var(--color-border-light); margin: 6px 0"></div>

          <div class="flex items-center justify-between">
            <span style="font-size: 13px; color: var(--color-text-secondary)">{{ 'common.subtotal' | translate }}</span>
            <span style="font-size: 13px; color: var(--color-text-secondary)">{{
              money(o.subtotalCents, o.currency)
            }}</span>
          </div>
          @if (o.discountCents > 0) {
            <div class="flex items-center justify-between">
              <span style="font-size: 13px; color: var(--color-mint)"
                >{{ 'common.discount' | translate }} {{ o.couponCode }}</span
              >
              <span style="font-size: 13px; color: var(--color-mint)">− {{ money(o.discountCents, o.currency) }}</span>
            </div>
          }
          @if (o.deliveryFeeCents > 0) {
            <div class="flex items-center justify-between">
              <span style="font-size: 13px; color: var(--color-text-secondary)">{{
                'admin.orderDetail.delivery' | translate
              }}</span>
              <span style="font-size: 13px; color: var(--color-text-secondary)">{{
                money(o.deliveryFeeCents, o.currency)
              }}</span>
            </div>
          }
          @if (o.taxCents > 0) {
            <div class="flex items-center justify-between">
              <span style="font-size: 13px; color: var(--color-text-secondary)">{{ 'common.tax' | translate }}</span>
              <span style="font-size: 13px; color: var(--color-text-secondary)">{{
                money(o.taxCents, o.currency)
              }}</span>
            </div>
          }
          @if (o.giftCardCents > 0) {
            <div class="flex items-center justify-between">
              <span style="font-size: 13px; color: var(--color-mint)">🎁 {{ o.giftCardCode }}</span>
              <span style="font-size: 13px; color: var(--color-mint)">− {{ money(o.giftCardCents, o.currency) }}</span>
            </div>
          }
          <div class="flex items-center justify-between">
            <span style="font-size: 14px; font-weight: 700; color: var(--color-espresso)">{{
              'common.total' | translate
            }}</span>
            <span style="font-size: 15px; font-weight: 700; color: var(--color-caramel)">{{
              money(o.totalCents, o.currency)
            }}</span>
          </div>
          @if (o.refundedCents > 0) {
            <div class="flex items-center justify-between">
              <span style="font-size: 13px; color: var(--color-berry)">{{
                'admin.orderDetail.refunded' | translate
              }}</span>
              <span style="font-size: 13px; font-weight: 600; color: var(--color-berry)"
                >− {{ money(o.refundedCents, o.currency) }}</span
              >
            </div>
          }
        </section>

        <!-- Refund -->
        @if (o.refundableCents > 0) {
          <section
            class="flex flex-col"
            style="padding: 16px 24px; gap: 10px; border-top: 1px solid var(--color-border-light); background: var(--color-cream)"
          >
            <h3
              style="font-family: var(--font-sans); font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 1px; margin: 0"
            >
              {{ 'admin.orderDetail.refundTitle' | translate }}
            </h3>

            @if (!confirming()) {
              <button
                type="button"
                (click)="startRefund(o)"
                style="height: 40px; padding: 0 16px; border: 1px solid var(--color-berry); background: transparent; color: var(--color-berry); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; cursor: pointer"
              >
                {{ 'admin.orderDetail.refundUpTo' | translate: { amount: money(o.refundableCents, o.currency) } }}
              </button>
            } @else {
              <label class="flex flex-col" style="gap: 4px">
                <span style="font-size: 12px; color: var(--color-text-secondary)">{{
                  'admin.orderDetail.amount' | translate
                }}</span>
                <input
                  type="number"
                  [(ngModel)]="amountMajor"
                  [min]="0.01"
                  [max]="o.refundableCents / 100"
                  step="0.01"
                  style="height: 38px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 14px"
                />
              </label>
              <label class="flex flex-col" style="gap: 4px">
                <span style="font-size: 12px; color: var(--color-text-secondary)">{{
                  'admin.orderDetail.reason' | translate
                }}</span>
                <select
                  [(ngModel)]="reason"
                  style="height: 38px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 14px"
                >
                  <option value="requested_by_customer">
                    {{ 'admin.orderDetail.reasonRequested' | translate }}
                  </option>
                  <option value="duplicate">{{ 'admin.orderDetail.reasonDuplicate' | translate }}</option>
                  <option value="fraudulent">{{ 'admin.orderDetail.reasonFraud' | translate }}</option>
                </select>
              </label>
              <label class="flex flex-col" style="gap: 4px">
                <span style="font-size: 12px; color: var(--color-text-secondary)">{{
                  'admin.orderDetail.note' | translate
                }}</span>
                <input
                  type="text"
                  [(ngModel)]="note"
                  maxlength="500"
                  style="height: 38px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 14px"
                />
              </label>

              <p style="margin: 0; font-size: 12px; color: var(--color-text-secondary)">
                {{ 'admin.orderDetail.irreversible' | translate }}
              </p>

              <div class="flex" style="gap: 8px">
                <button
                  type="button"
                  (click)="submitRefund(o)"
                  [disabled]="refunding() || !amountValid(o)"
                  style="height: 40px; padding: 0 16px; border: none; background: var(--color-berry); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; cursor: pointer"
                  [style.opacity]="refunding() || !amountValid(o) ? '0.5' : '1'"
                >
                  {{ (refunding() ? 'admin.orderDetail.refunding' : 'admin.orderDetail.confirm') | translate }}
                </button>
                <button
                  type="button"
                  (click)="confirming.set(false)"
                  [disabled]="refunding()"
                  style="height: 40px; padding: 0 16px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text-secondary); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; cursor: pointer"
                >
                  {{ 'common.cancel' | translate }}
                </button>
              </div>
            }

            @if (refundError()) {
              <p style="margin: 0; font-size: 13px; color: var(--color-berry)">{{ refundError() }}</p>
            }
          </section>
        }

        <!-- Timeline -->
        <section
          class="flex flex-col"
          style="padding: 16px 24px 32px; gap: 8px; border-top: 1px solid var(--color-border-light)"
        >
          <h3
            style="font-family: var(--font-sans); font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 1px; margin: 0"
          >
            {{ 'admin.orderDetail.timeline' | translate }}
          </h3>
          @for (event of o.events; track event.id) {
            <div class="flex items-baseline" style="gap: 10px">
              <span
                style="font-family: var(--font-mono); font-size: 11px; color: var(--color-text-tertiary); min-width: 108px"
              >
                {{ time(event.createdAt) }}
              </span>
              <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary)">
                {{ event.type }}{{ eventDetail(event.payload) }}
              </span>
            </div>
          }
        </section>
      } @else if (error()) {
        <p style="padding: 24px; font-family: var(--font-sans); font-size: 14px; color: var(--color-berry)">
          {{ error() }}
        </p>
      }
    </aside>
  `,
})
export class OrderDetailPanelComponent {
  private readonly api = inject(AdminOrdersApi);
  private readonly translate = inject(TranslateService);

  @Input({ required: true }) set orderId(id: string) {
    this.load(id);
  }

  /** Emitted after a successful refund so the list can re-query. */
  @Output() readonly refunded = new EventEmitter<void>();
  // Named `closed`, not `close`: an output called `close` shadows the
  // native DOM event of that name.
  @Output() readonly closed = new EventEmitter<void>();

  readonly order = signal<AdminOrderDetail | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly confirming = signal(false);
  readonly refunding = signal(false);
  readonly refundError = signal<string | null>(null);

  /** Major units in the input; the API takes cents. */
  amountMajor = 0;
  reason: 'requested_by_customer' | 'duplicate' | 'fraudulent' = 'requested_by_customer';
  note = '';

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.confirming.set(false);
    this.api.get(id).subscribe({
      next: (detail) => {
        this.order.set(detail);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(extractMessage(err, this.translate.instant('common.genericError')));
      },
    });
  }

  startRefund(order: AdminOrderDetail): void {
    // Default to everything still refundable: partial refunds are the
    // exception, and pre-filling saves the common case a calculation.
    this.amountMajor = order.refundableCents / 100;
    this.note = '';
    this.refundError.set(null);
    this.confirming.set(true);
  }

  amountValid(order: AdminOrderDetail): boolean {
    const cents = Math.round(this.amountMajor * 100);
    return cents > 0 && cents <= order.refundableCents;
  }

  submitRefund(order: AdminOrderDetail): void {
    if (!this.amountValid(order)) return;
    this.refunding.set(true);
    this.refundError.set(null);

    const cents = Math.round(this.amountMajor * 100);
    this.api
      .refund(order.id, {
        // Send the amount only for a genuine partial: omitting it lets the
        // server refund the exact remaining balance without us racing it.
        amountCents: cents === order.refundableCents ? undefined : cents,
        reason: this.reason,
        note: this.note.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.refunding.set(false);
          this.confirming.set(false);
          this.refunded.emit();
          this.load(order.id);
        },
        error: (err) => {
          this.refunding.set(false);
          this.refundError.set(extractMessage(err, this.translate.instant('common.genericError')));
        },
      });
  }

  money(cents: number, currency: string): string {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  }

  time(iso: string): string {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** Surfaces the bits of an event payload a human would want to read. */
  eventDetail(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return '';
    const p = payload as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof p['from'] === 'string' && typeof p['to'] === 'string') parts.push(`${p['from']} → ${p['to']}`);
    else if (typeof p['to'] === 'string') parts.push(String(p['to']));
    if (typeof p['reason'] === 'string') parts.push(String(p['reason']));
    if (typeof p['amountCents'] === 'number') parts.push(`${(p['amountCents'] as number) / 100}`);
    return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
  }
}

function extractMessage(err: unknown, fallback: string): string {
  const maybe = err as { error?: { message?: unknown } };
  if (typeof maybe.error?.message === 'string') return maybe.error.message;
  return fallback;
}
