import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { interval, type Subscription } from 'rxjs';

import { OrdersApi, type OrderStatusString, type OrderView } from '../../core/orders/orders.service';
import { RealtimeService } from '../../core/realtime/realtime.service';

const ACTIVE_STEPS: OrderStatusString[] = ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'PICKED_UP'];

@Component({
  selector: 'app-order-status',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (order(); as o) {
      <section class="max-w-xl mx-auto px-4 py-10">
        <p class="text-xs uppercase tracking-widest mb-2" style="opacity: 0.5">Order</p>
        <h1 class="text-3xl mb-1" style="font-family: var(--font-display)">{{ statusLabel(o.status) }}</h1>
        <p style="opacity: 0.6">{{ o.storeName }}</p>

        <div
          class="mt-8 flex items-center justify-center flex-col p-8"
          [style.background]="o.status === 'READY' ? 'var(--color-mint)' : 'var(--color-foam)'"
          [style.color]="o.status === 'READY' ? 'white' : 'var(--color-espresso)'"
          style="border-radius: var(--radius-card); box-shadow: var(--shadow-soft)"
        >
          @if (o.status === 'READY') {
            <p class="text-xl mb-2" style="font-family: var(--font-display)">Ready for pickup</p>
            <p class="text-5xl font-mono tracking-widest" style="font-family: var(--font-mono)">{{ o.orderCode }}</p>
            <p class="mt-3 text-sm">Show the code at the counter.</p>
          } @else if (o.status === 'CANCELLED') {
            <p class="text-xl" style="font-family: var(--font-display)">Order cancelled</p>
          } @else if (o.status === 'PICKED_UP') {
            <p class="text-xl" style="font-family: var(--font-display)">Thanks, enjoy!</p>
            <p class="text-sm mt-2" style="opacity: 0.6">Code was: {{ o.orderCode }}</p>
          } @else {
            <p class="text-6xl font-mono" style="font-family: var(--font-mono)">{{ countdown() }}</p>
            <p class="mt-3 text-sm" style="opacity: 0.7">Ready at {{ formatTime(o.pickupAt) }}</p>
            <p class="mt-4 text-xs tracking-widest uppercase" style="opacity: 0.5">code · {{ o.orderCode }}</p>
          }
        </div>

        <ol class="mt-6 flex items-center justify-between text-xs">
          @for (step of steps(); track step.key) {
            <li class="flex flex-col items-center gap-1 flex-1">
              <span
                class="w-3 h-3 rounded-full"
                [style.background]="step.active ? 'var(--color-caramel)' : 'var(--color-latte)'"
              ></span>
              <span [style.opacity]="step.active ? 1 : 0.4">{{ step.label }}</span>
            </li>
          }
        </ol>

        <section class="mt-8">
          <h2 class="text-lg mb-3" style="font-family: var(--font-display)">Your order</h2>
          <ul class="flex flex-col gap-2 text-sm">
            @for (item of o.items; track item.id) {
              <li class="flex justify-between">
                <span>{{ item.quantity }} × {{ item.productSnapshot.name }}</span>
                <span>{{ price(item.totalCents) }}</span>
              </li>
            }
          </ul>
          <hr class="my-3" style="border-color: var(--color-latte)" />
          <div class="flex justify-between font-medium">
            <span>Total</span>
            <span>{{ price(o.totalCents) }}</span>
          </div>
        </section>

        @if (canCancel()) {
          <button
            type="button"
            (click)="cancel()"
            class="mt-6 w-full py-3 border"
            style="border-color: var(--color-berry); color: var(--color-berry); border-radius: var(--radius-button)"
          >
            Cancel order
          </button>
        }

        <a routerLink="/menu" class="block mt-6 text-center text-sm underline">Back to menu</a>
      </section>
    }

    @if (error()) {
      <p class="mt-6 text-center text-sm" style="color: var(--color-berry)">{{ error() }}</p>
    }
  `,
})
export class OrderStatusPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly orders = inject(OrdersApi);
  private readonly realtime = inject(RealtimeService);

  readonly order = signal<OrderView | null>(null);
  readonly error = signal<string | null>(null);
  readonly now = signal(Date.now());

  private detachSocket: (() => void) | null = null;
  private tickSub: Subscription | null = null;

  readonly steps = computed(() => {
    const status = this.order()?.status ?? 'CREATED';
    const activeIdx = ACTIVE_STEPS.indexOf(status);
    return [
      { key: 'CREATED', label: 'Received' },
      { key: 'IN_PROGRESS', label: 'Preparing' },
      { key: 'READY', label: 'Ready' },
      { key: 'PICKED_UP', label: 'Picked up' },
    ].map((s) => ({ ...s, active: ACTIVE_STEPS.indexOf(s.key as OrderStatusString) <= activeIdx }));
  });

  readonly countdown = computed(() => {
    const o = this.order();
    if (!o) return '0:00';
    const diff = Math.max(0, new Date(o.pickupAt).getTime() - this.now());
    const min = Math.floor(diff / 60_000);
    const sec = Math.floor((diff % 60_000) / 1000);
    return `${min}:${String(sec).padStart(2, '0')}`;
  });

  readonly canCancel = computed(() => {
    const s = this.order()?.status;
    return s === 'CREATED' || s === 'PAID' || s === 'ACCEPTED';
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Missing order id');
      return;
    }

    this.orders.get(id).subscribe({
      next: (o) => this.order.set(o),
      error: () => this.error.set('Order not found'),
    });

    this.detachSocket = this.realtime.subscribeToOrder(id, (event) => {
      this.order.update((current) => (current ? { ...current, status: event.status } : current));
    });

    this.tickSub = interval(1000).subscribe(() => this.now.set(Date.now()));
  }

  ngOnDestroy(): void {
    this.detachSocket?.();
    this.tickSub?.unsubscribe();
  }

  cancel(): void {
    const o = this.order();
    if (!o) return;
    this.orders.cancel(o.id).subscribe({
      next: (updated) => this.order.set(updated),
    });
  }

  price(cents: number): string {
    const currency = this.order()?.currency ?? 'USD';
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  }

  formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
}
