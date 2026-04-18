import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { interval, type Subscription } from 'rxjs';

import { OrdersApi, type OrderStatusString, type OrderView } from '../../core/orders/orders.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

@Component({
  selector: 'app-tma-order-status',
  standalone: true,
  template: `
    @if (order(); as o) {
      <section class="px-4 pt-6 pb-16">
        <p class="text-xs uppercase tracking-widest mb-2" style="opacity: 0.5">{{ statusLabel(o.status) }}</p>

        <div
          class="p-6 text-center"
          [style.background]="o.status === 'READY' ? 'var(--color-mint)' : 'var(--color-foam)'"
          [style.color]="o.status === 'READY' ? 'white' : 'var(--color-espresso)'"
          style="border-radius: var(--radius-card); box-shadow: var(--shadow-soft)"
        >
          @if (o.status === 'READY') {
            <p class="text-lg mb-2" style="font-family: var(--font-display)">Ready for pickup</p>
            <p class="text-5xl" style="font-family: var(--font-mono)">{{ o.orderCode }}</p>
          } @else if (o.status === 'CANCELLED') {
            <p class="text-lg" style="font-family: var(--font-display)">Cancelled</p>
          } @else {
            <p class="text-5xl" style="font-family: var(--font-mono)">{{ countdown() }}</p>
            <p class="text-xs mt-3" style="opacity: 0.7">Ready at {{ time(o.pickupAt) }} · code {{ o.orderCode }}</p>
          }
        </div>

        <section class="mt-6">
          <h2 class="text-sm uppercase tracking-widest mb-2" style="opacity: 0.5">{{ o.storeName }}</h2>
          <ul class="flex flex-col gap-1 text-sm">
            @for (item of o.items; track item.id) {
              <li class="flex justify-between">
                <span>{{ item.quantity }} × {{ item.productSnapshot.name }}</span>
                <span>{{ price(item.totalCents) }}</span>
              </li>
            }
          </ul>
          <hr class="my-3" style="border-color: var(--color-latte)" />
          <div class="flex justify-between font-medium text-sm">
            <span>Total</span>
            <span>{{ price(o.totalCents) }}</span>
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

    this.orders.get(id).subscribe({
      next: (o) => this.order.set(o),
    });

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
    return (
      {
        CREATED: 'Order received',
        PAID: 'Payment confirmed',
        ACCEPTED: 'Preparing soon',
        IN_PROGRESS: 'Preparing',
        READY: 'Ready for pickup',
        PICKED_UP: 'Picked up',
        CANCELLED: 'Cancelled',
        EXPIRED: 'Expired',
      } satisfies Record<OrderStatusString, string>
    )[status];
  }

  time(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  price(cents: number): string {
    const currency = this.order()?.currency ?? 'USD';
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  }
}
