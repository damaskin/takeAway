import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { interval, type Subscription } from 'rxjs';

import { OrdersApi, type OrderStatusString, type OrderView } from '../../core/orders/orders.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

const STATUS_LABELS: Record<OrderStatusString, string> = {
  CREATED: 'Order received',
  PAID: 'Payment confirmed',
  ACCEPTED: 'Preparing soon',
  IN_PROGRESS: 'Preparing\nyour order',
  READY: 'Ready for pickup',
  PICKED_UP: 'Picked up',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

/**
 * TMA Order Status — pencil e48T5.
 *
 * tosContent (centered vertical, padding 24, gap 24):
 *   tosIllus     — 120px caramel-light circle with big emoji
 *   tosStatusTx  — Fraunces 28/700 two-line status label
 *   tosTimerRow  — countdown + code badge
 *   tosTL        — 4-row timeline (Paid / Accepted / Ready / Picked up)
 */
@Component({
  selector: 'app-tma-order-status',
  standalone: true,
  template: `
    @if (order(); as o) {
      <section
        style="padding: 24px; padding-bottom: 32px; display: flex; flex-direction: column; align-items: center; gap: 24px"
      >
        <!-- Illustration -->
        <div
          class="flex items-center justify-center"
          [style.background]="isReady() ? 'var(--color-mint)' : 'var(--color-caramel-light)'"
          style="width: 120px; height: 120px; border-radius: 9999px; font-size: 52px"
        >
          {{ illustrationEmoji(o.status) }}
        </div>

        <h1
          style="font-family: var(--font-display); font-size: 28px; font-weight: 700; line-height: 1.2; color: var(--color-espresso); text-align: center; white-space: pre-line; margin: 0"
        >
          {{ statusLabel(o.status) }}
        </h1>

        <!-- Timer + code -->
        <div class="flex items-center" style="gap: 12px">
          @if (isReady()) {
            <span style="font-family: var(--font-mono); font-size: 40px; font-weight: 700; color: var(--color-mint)">{{
              o.orderCode
            }}</span>
          } @else if (o.status === 'CANCELLED' || o.status === 'EXPIRED') {
            <span style="font-family: var(--font-sans); font-size: 15px; color: var(--color-text-secondary)"
              >Order closed</span
            >
          } @else {
            <span
              style="font-family: var(--font-mono); font-size: 40px; font-weight: 700; color: var(--color-caramel)"
              >{{ countdown() }}</span
            >
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
              >code {{ o.orderCode }}</span
            >
          }
        </div>

        <!-- Timeline -->
        <div class="flex flex-col w-full" style="gap: 12px">
          @for (step of timelineSteps; track step.key) {
            <div
              class="flex items-center"
              style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px; padding: 14px 16px; gap: 12px"
            >
              <span
                class="flex items-center justify-center"
                [style.background]="isStepDone(o.status, step.key) ? 'var(--color-mint)' : 'var(--color-border-light)'"
                [style.color]="isStepDone(o.status, step.key) ? 'white' : 'var(--color-text-tertiary)'"
                style="width: 28px; height: 28px; border-radius: 9999px; font-size: 13px; font-weight: 700"
              >
                {{ isStepDone(o.status, step.key) ? '✓' : step.idx }}
              </span>
              <span
                style="font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--color-text-primary)"
                >{{ step.label }}</span
              >
            </div>
          }
        </div>

        <!-- Order summary -->
        <section class="w-full flex flex-col" style="gap: 12px; margin-top: 12px">
          <h2
            style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 1px; margin: 0"
          >
            {{ o.storeName.toUpperCase() }}
          </h2>
          <div
            class="flex flex-col"
            style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px; padding: 16px; gap: 10px"
          >
            @for (item of o.items; track item.id) {
              <div class="flex items-center justify-between">
                <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary)"
                  >{{ item.quantity }} × {{ item.productSnapshot.name }}</span
                >
                <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
                  price(item.totalCents)
                }}</span>
              </div>
            }
            <hr style="border: none; border-top: 1px solid var(--color-border-light); margin: 0" />
            <div class="flex items-center justify-between">
              <span
                style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
                >Total</span
              >
              <span
                style="font-family: var(--font-sans); font-size: 15px; font-weight: 700; color: var(--color-caramel)"
                >{{ price(o.totalCents) }}</span
              >
            </div>
          </div>
        </section>
      </section>
    }
  `,
})
export class TmaOrderStatusPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly orders = inject(OrdersApi);
  private readonly realtime = inject(RealtimeService);
  private readonly tg = inject(TelegramBridgeService);

  readonly order = signal<OrderView | null>(null);
  readonly now = signal(Date.now());

  readonly timelineSteps = [
    { idx: 1, key: 'PAID' as OrderStatusString, label: 'Payment confirmed' },
    { idx: 2, key: 'ACCEPTED' as OrderStatusString, label: 'Accepted by kitchen' },
    { idx: 3, key: 'READY' as OrderStatusString, label: 'Ready for pickup' },
    { idx: 4, key: 'PICKED_UP' as OrderStatusString, label: 'Picked up' },
  ];

  private tickSub: Subscription | null = null;
  private detachSocket: (() => void) | null = null;
  private detachBack: (() => void) | null = null;

  readonly countdown = computed(() => {
    const o = this.order();
    if (!o) return '0:00';
    const diff = Math.max(0, new Date(o.pickupAt).getTime() - this.now());
    const min = Math.floor(diff / 60_000);
    const sec = Math.floor((diff % 60_000) / 1000);
    return `${min}:${String(sec).padStart(2, '0')}`;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;

    this.orders.get(id).subscribe({ next: (o) => this.order.set(o) });

    this.detachSocket = this.realtime.subscribeToOrder(id, (event) => {
      this.order.update((current) => (current ? { ...current, status: event.status } : current));
      if (event.status === 'READY') this.tg.haptic('heavy');
    });

    this.tickSub = interval(1000).subscribe(() => this.now.set(Date.now()));
    this.detachBack = this.tg.setBackButton(() => void this.router.navigate(['/']));
  }

  ngOnDestroy(): void {
    this.tickSub?.unsubscribe();
    this.detachSocket?.();
    this.detachBack?.();
  }

  statusLabel(status: OrderStatusString): string {
    return STATUS_LABELS[status];
  }

  isReady(): boolean {
    return this.order()?.status === 'READY';
  }

  illustrationEmoji(status: OrderStatusString): string {
    if (status === 'READY') return '✅';
    if (status === 'CANCELLED' || status === 'EXPIRED') return '✖';
    if (status === 'PICKED_UP') return '🎉';
    if (status === 'IN_PROGRESS') return '☕';
    return '⏱';
  }

  isStepDone(current: OrderStatusString, step: OrderStatusString): boolean {
    const order: OrderStatusString[] = ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'PICKED_UP'];
    const ci = order.indexOf(current);
    const si = order.indexOf(step);
    if (ci < 0 || si < 0) return false;
    return ci >= si;
  }

  price(cents: number): string {
    const currency = this.order()?.currency ?? 'USD';
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  }
}
