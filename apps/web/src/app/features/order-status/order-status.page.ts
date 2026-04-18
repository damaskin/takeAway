import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { interval, type Subscription } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { OrdersApi, type OrderStatusString, type OrderView } from '../../core/orders/orders.service';
import { RealtimeService } from '../../core/realtime/realtime.service';

interface StatusStep {
  key: OrderStatusString;
  label: string;
  icon: string;
}

const STEPS: StatusStep[] = [
  { key: 'PAID', label: 'Paid', icon: '✓' },
  { key: 'IN_PROGRESS', label: 'Preparing', icon: '⏱' },
  { key: 'READY', label: 'Ready', icon: '🛎' },
  { key: 'PICKED_UP', label: 'Picked up', icon: '🏁' },
];

const STEP_ORDER: OrderStatusString[] = ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'PICKED_UP'];

@Component({
  selector: 'app-order-status',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (order(); as o) {
      <section class="max-w-3xl mx-auto px-6 py-10 flex flex-col items-center" style="gap: var(--spacing-lg)">
        <!-- Greeting -->
        <header class="text-center" style="margin-top: var(--spacing-sm)">
          <h1 class="text-4xl" style="font-family: var(--font-display); color: var(--color-espresso); font-weight: 600">
            Hi{{ firstName() ? ', ' + firstName() : '' }}!
          </h1>
          <p class="mt-2" style="font-family: var(--font-sans); font-size: 20px; color: var(--color-caramel)">
            {{ heroSubtitle() }}
          </p>
        </header>

        <!-- Timer Ring (300×300 circle, caramel-light fill) -->
        <div
          class="flex items-center justify-center rounded-full transition-colors"
          [style.background]="ringBackground()"
          [style.color]="ringTextColor()"
          style="width: 300px; height: 300px; margin-top: var(--spacing-base)"
        >
          @if (o.status === 'READY') {
            <span style="font-family: var(--font-display); font-size: 48px; font-weight: 700">Ready</span>
          } @else if (o.status === 'CANCELLED') {
            <span style="font-family: var(--font-display); font-size: 36px; font-weight: 600">Cancelled</span>
          } @else if (o.status === 'PICKED_UP') {
            <span style="font-family: var(--font-display); font-size: 40px; font-weight: 700">Thanks!</span>
          } @else {
            <span style="font-family: var(--font-sans); font-size: 96px; font-weight: 700; letter-spacing: -0.03em">
              {{ countdown() }}
            </span>
          }
        </div>

        <!-- Order Code + QR row -->
        <div class="flex gap-6 justify-center" style="margin-top: var(--spacing-sm)">
          <div
            class="flex flex-col items-center justify-center"
            style="
              width: 180px; height: 180px; gap: 8px;
              background: var(--color-cream);
              border: 2px solid var(--color-caramel);
              border-radius: 16px;
            "
          >
            <span
              style="font-family: var(--font-mono); font-size: 56px; font-weight: 700; color: var(--color-espresso); letter-spacing: 0.04em"
              >{{ o.orderCode }}</span
            >
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
              >Your code</span
            >
          </div>

          <div
            class="flex items-center justify-center"
            style="
              width: 180px; height: 180px;
              background: var(--color-cream);
              border: 2px solid var(--color-caramel);
              border-radius: 16px;
            "
          >
            <div
              style="width: 140px; height: 140px; background: var(--color-latte); border-radius: 8px; display: grid; place-items: center"
              aria-label="QR code placeholder"
            >
              <span style="font-family: var(--font-mono); font-size: 10px; color: var(--color-text-tertiary)">QR</span>
            </div>
          </div>
        </div>

        <!-- Status Step List -->
        <ol class="w-full flex gap-3" style="padding: 0 var(--spacing-xl); margin-top: var(--spacing-sm)">
          @for (step of steps(); track step.key) {
            <li
              class="flex flex-col items-center justify-center text-center flex-1"
              style="height: 60px; border-radius: 12px; padding: 0 var(--spacing-sm);"
              [style.background]="step.background"
              [style.color]="step.color"
            >
              <span style="font-family: var(--font-sans); font-size: 13px; font-weight: 600">
                {{ step.icon }} {{ step.label }}
              </span>
            </li>
          }
        </ol>

        <!-- Store info card -->
        <article
          class="w-full"
          style="
            background: var(--color-foam);
            border: 1px solid var(--color-border-light);
            border-radius: 16px;
            padding: var(--spacing-lg);
            display: flex; flex-direction: column; gap: var(--spacing-base);
          "
        >
          <div style="display: flex; flex-direction: column; gap: 4px">
            <span
              style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-espresso)"
            >
              📍 {{ o.storeName }}
            </span>
            @if (minutesToPickup() > 0 && !isTerminal(o.status)) {
              <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
                🚶 Pickup in ~{{ minutesToPickup() }} min
              </span>
            }
          </div>
          <a
            [href]="mapsUrl()"
            target="_blank"
            rel="noopener"
            class="flex items-center justify-center"
            style="
              background: var(--color-caramel);
              color: var(--color-foam);
              height: 40px;
              border-radius: 12px;
              font-family: var(--font-sans); font-size: 14px; font-weight: 600;
              text-decoration: none;
            "
          >
            Open in Maps
          </a>
        </article>

        <!-- Primary CTA: I'm here -->
        @if (!isTerminal(o.status)) {
          <button
            type="button"
            (click)="imHere()"
            class="w-full flex items-center justify-center"
            style="
              background: var(--color-caramel);
              color: var(--color-foam);
              height: 56px;
              border-radius: 16px;
              font-family: var(--font-sans); font-size: 16px; font-weight: 600;
              transition: background 0.15s;
            "
          >
            {{ imHereClicked() ? 'We know — see you in a sec ✓' : "I'm here" }}
          </button>
        }

        <!-- Cancel -->
        @if (canCancel()) {
          <button
            type="button"
            (click)="cancel()"
            class="w-full flex items-center justify-center"
            style="
              background: var(--color-cream);
              color: var(--color-espresso);
              height: 48px;
              border-radius: 14px;
              border: 1px solid var(--color-border);
              font-family: var(--font-sans); font-size: 14px; font-weight: 500;
            "
          >
            Cancel order
          </button>
        }

        <a routerLink="/menu" class="text-sm mt-2 underline" style="color: var(--color-text-secondary)">
          Back to menu
        </a>
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
  private readonly authStore = inject(AuthStore);

  readonly order = signal<OrderView | null>(null);
  readonly error = signal<string | null>(null);
  readonly now = signal(Date.now());
  readonly imHereClicked = signal(false);

  private detachSocket: (() => void) | null = null;
  private tickSub: Subscription | null = null;

  readonly firstName = computed(() => {
    const name = this.authStore.user()?.name ?? '';
    return name.split(/\s+/)[0] ?? '';
  });

  readonly heroSubtitle = computed(() => {
    const status = this.order()?.status;
    switch (status) {
      case 'CREATED':
        return 'Order received';
      case 'PAID':
        return 'Payment confirmed';
      case 'ACCEPTED':
        return 'Starting your order soon';
      case 'IN_PROGRESS':
        return 'Preparing your order';
      case 'READY':
        return 'Ready for pickup';
      case 'PICKED_UP':
        return 'Enjoy!';
      case 'CANCELLED':
        return 'Order cancelled';
      case 'EXPIRED':
        return 'Order expired';
      default:
        return '';
    }
  });

  readonly countdown = computed(() => {
    const o = this.order();
    if (!o) return '0:00';
    const diff = Math.max(0, new Date(o.pickupAt).getTime() - this.now());
    const min = Math.floor(diff / 60_000);
    const sec = Math.floor((diff % 60_000) / 1000);
    return `${min}:${String(sec).padStart(2, '0')}`;
  });

  readonly minutesToPickup = computed(() => {
    const o = this.order();
    if (!o) return 0;
    const diff = new Date(o.pickupAt).getTime() - this.now();
    return Math.max(0, Math.ceil(diff / 60_000));
  });

  readonly canCancel = computed(() => {
    const s = this.order()?.status;
    return s === 'CREATED' || s === 'PAID' || s === 'ACCEPTED';
  });

  readonly steps = computed(() => {
    const status = this.order()?.status ?? 'CREATED';
    const activeIdx = STEP_ORDER.indexOf(status);
    return STEPS.map((step) => {
      const stepIdx = STEP_ORDER.indexOf(step.key);
      const completed = stepIdx < activeIdx;
      const current = stepIdx === activeIdx || (step.key === 'PAID' && status === 'CREATED');
      const { background, color } = this.stepStyle(completed, current);
      return { ...step, background, color };
    });
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

  imHere(): void {
    // Placeholder for POST /orders/:id/im-here — not wired yet on backend.
    // For now we just flip local state so the barista UX is testable.
    this.imHereClicked.set(true);
  }

  isTerminal(status: OrderStatusString): boolean {
    return status === 'PICKED_UP' || status === 'CANCELLED' || status === 'EXPIRED';
  }

  ringBackground(): string {
    const status = this.order()?.status;
    if (status === 'READY') return 'var(--color-mint)';
    if (status === 'CANCELLED' || status === 'EXPIRED') return 'var(--color-latte)';
    if (status === 'PICKED_UP') return 'var(--color-caramel-light)';
    return 'var(--color-caramel-light)';
  }

  ringTextColor(): string {
    const status = this.order()?.status;
    if (status === 'READY') return 'var(--color-foam)';
    if (status === 'PICKED_UP') return 'var(--color-caramel)';
    return 'var(--color-espresso)';
  }

  mapsUrl(): string {
    // Fallback — real coords land with M5 analytics/map integration.
    const store = this.order()?.storeName ?? '';
    return `https://maps.google.com/?q=${encodeURIComponent(store)}`;
  }

  private stepStyle(completed: boolean, current: boolean): { background: string; color: string } {
    if (completed || current) {
      return { background: 'var(--color-caramel)', color: 'var(--color-foam)' };
    }
    // Upcoming steps fade from caramel-light → latte as distance grows.
    return { background: 'var(--color-latte)', color: 'var(--color-text-secondary)' };
  }
}
