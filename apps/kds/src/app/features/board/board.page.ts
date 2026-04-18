import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { interval, type Subscription } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { KdsApi, type KdsOrder, type KdsOrderStatus } from '../../core/kds/kds.service';
import { StoresApi, type StoreSummary } from '../../core/stores/stores.service';

type Column = 'NEW' | 'PREPARING' | 'READY';

const COLUMN_STATUSES: Record<Column, KdsOrderStatus[]> = {
  NEW: ['CREATED', 'PAID', 'ACCEPTED'],
  PREPARING: ['IN_PROGRESS'],
  READY: ['READY'],
};

@Component({
  selector: 'app-kds-board',
  standalone: true,
  template: `
    <div
      class="min-h-screen flex flex-col"
      style="background: var(--color-dark-bg); color: var(--color-cream); font-family: var(--font-sans)"
    >
      <header
        class="flex items-center justify-between px-6 py-3 border-b"
        style="border-color: var(--color-dark-surface-variant)"
      >
        <div class="flex items-center gap-4">
          <span class="text-2xl" style="font-family: var(--font-display)">takeAway KDS</span>
          @if (stores().length > 0) {
            <select
              [value]="selectedStoreId()"
              (change)="onStoreChange($event)"
              class="px-3 py-1 text-sm"
              style="background: var(--color-dark-surface-variant); color: var(--color-cream); border-radius: var(--radius-input)"
            >
              @for (s of stores(); track s.id) {
                <option [value]="s.id">{{ s.name }}</option>
              }
            </select>
          }
          <span class="text-xs" style="opacity: 0.5"> {{ openCount() }} in queue · {{ nowLabel() }} </span>
        </div>
        <span class="text-xs" style="opacity: 0.5">{{ authStore.user()?.name ?? authStore.user()?.phone }}</span>
      </header>

      <main class="grid grid-cols-3 gap-4 p-4 flex-1 overflow-hidden">
        @for (col of columns; track col.key) {
          <section class="flex flex-col min-h-0">
            <h2 class="text-lg mb-3 uppercase tracking-wider" style="opacity: 0.6">{{ col.label }}</h2>
            <div class="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
              @for (order of ordersFor(col.key); track order.id) {
                <article
                  class="p-4"
                  [style.background]="cardBackground(order)"
                  style="color: var(--color-espresso); border-radius: var(--radius-card)"
                >
                  <div class="flex items-center justify-between">
                    <span class="text-3xl" style="font-family: var(--font-mono)">{{ order.orderCode }}</span>
                    <span class="text-xs uppercase tracking-wider">{{ order.pickupMode }}</span>
                  </div>
                  <div class="mt-1 flex items-center justify-between">
                    <span class="text-sm">{{ order.customerName ?? 'Customer' }}</span>
                    <span class="text-sm" style="font-family: var(--font-mono)"> due {{ dueLabel(order) }} </span>
                  </div>
                  <ul class="mt-3 text-sm">
                    @for (item of order.items; track $index) {
                      <li>{{ item.quantity }} × {{ item.productSnapshot.name }}</li>
                    }
                  </ul>
                  @if (order.notes) {
                    <p
                      class="mt-2 text-xs p-2"
                      style="background: var(--color-latte); border-radius: var(--radius-input)"
                    >
                      ⚠ {{ order.notes }}
                    </p>
                  }
                  <div class="mt-3 flex gap-2">
                    @for (action of actionsFor(order); track action.label) {
                      <button
                        type="button"
                        (click)="action.run()"
                        class="px-3 py-2 text-xs font-medium"
                        [style.background]="action.color"
                        style="color: white; border-radius: var(--radius-button)"
                      >
                        {{ action.label }}
                      </button>
                    }
                  </div>
                </article>
              } @empty {
                <p class="text-xs" style="opacity: 0.4">—</p>
              }
            </div>
          </section>
        }
      </main>

      @if (error()) {
        <p class="px-4 py-2 text-sm" style="color: var(--color-berry)">{{ error() }}</p>
      }
    </div>
  `,
})
export class KdsBoardPage implements OnInit, OnDestroy {
  private readonly api = inject(KdsApi);
  private readonly storesApi = inject(StoresApi);
  readonly authStore = inject(AuthStore);

  readonly columns: Array<{ key: Column; label: string }> = [
    { key: 'NEW', label: 'New' },
    { key: 'PREPARING', label: 'Preparing' },
    { key: 'READY', label: 'Ready' },
  ];

  readonly stores = signal<StoreSummary[]>([]);
  readonly selectedStoreId = signal<string>('');
  readonly orders = signal<KdsOrder[]>([]);
  readonly now = signal(Date.now());
  readonly error = signal<string | null>(null);

  readonly openCount = computed(() => this.orders().length);
  readonly nowLabel = computed(() =>
    new Date(this.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  );

  private tickSub: Subscription | null = null;
  private pollSub: Subscription | null = null;

  ngOnInit(): void {
    this.storesApi.list().subscribe({
      next: (list) => {
        this.stores.set(list);
        const first = list[0];
        if (first) {
          this.selectedStoreId.set(first.id);
          this.refresh();
        }
      },
    });
    this.tickSub = interval(1000).subscribe(() => this.now.set(Date.now()));
    // Lightweight polling fallback; live WS updates will come from the
    // realtime gateway once we wire a KDS subscription channel.
    this.pollSub = interval(5000).subscribe(() => this.refresh());
  }

  ngOnDestroy(): void {
    this.tickSub?.unsubscribe();
    this.pollSub?.unsubscribe();
  }

  onStoreChange(event: Event): void {
    this.selectedStoreId.set((event.target as HTMLSelectElement).value);
    this.refresh();
  }

  ordersFor(col: Column): KdsOrder[] {
    return this.orders().filter((o) => COLUMN_STATUSES[col].includes(o.status));
  }

  dueLabel(order: KdsOrder): string {
    const diff = new Date(order.pickupAt).getTime() - this.now();
    const abs = Math.abs(Math.round(diff / 1000));
    const min = Math.floor(abs / 60);
    const sec = abs % 60;
    const sign = diff < 0 ? '−' : '';
    return `${sign}${min}:${String(sec).padStart(2, '0')}`;
  }

  cardBackground(order: KdsOrder): string {
    const diff = (new Date(order.pickupAt).getTime() - this.now()) / 1000;
    if (order.status === 'READY') return 'var(--color-mint)';
    if (diff < 0) return 'var(--color-berry)';
    if (diff < 120) return 'var(--color-amber-warn)';
    return 'var(--color-cream)';
  }

  actionsFor(order: KdsOrder): Array<{ label: string; color: string; run: () => void }> {
    const storeId = this.selectedStoreId();
    const handle = (obs: ReturnType<KdsApi['accept']>): void => {
      obs.subscribe({
        next: () => this.refresh(),
        error: (err) => this.error.set(extractMessage(err)),
      });
    };

    switch (order.status) {
      case 'CREATED':
      case 'PAID':
        return [
          { label: 'Accept', color: 'var(--color-caramel)', run: () => handle(this.api.accept(storeId, order.id)) },
        ];
      case 'ACCEPTED':
        return [
          { label: 'Start', color: 'var(--color-caramel)', run: () => handle(this.api.start(storeId, order.id)) },
        ];
      case 'IN_PROGRESS':
        return [{ label: 'Ready', color: 'var(--color-mint)', run: () => handle(this.api.ready(storeId, order.id)) }];
      case 'READY':
        return [
          {
            label: 'Picked up',
            color: 'var(--color-espresso)',
            run: () => handle(this.api.pickedUp(storeId, order.id)),
          },
        ];
      default:
        return [];
    }
  }

  private refresh(): void {
    const storeId = this.selectedStoreId();
    if (!storeId) return;
    this.api.list(storeId).subscribe({
      next: (list) => this.orders.set(list),
      error: (err) => this.error.set(extractMessage(err)),
    });
  }
}

function extractMessage(err: unknown): string {
  const maybe = err as { error?: { message?: unknown }; message?: unknown };
  if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
  if (typeof maybe.message === 'string') return maybe.message;
  return 'Request failed';
}
