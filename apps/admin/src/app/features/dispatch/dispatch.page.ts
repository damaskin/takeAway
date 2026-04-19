import { Component, OnInit, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { type AvailableRider, DeliveryApi, type DispatchOrderRow } from '../../core/delivery/delivery.service';

/**
 * Admin Dispatch — delivery queue for a store. Managers pick a store, see
 * DELIVERY orders in READY / OUT_FOR_DELIVERY, and assign them to a rider.
 *
 * The real-time story reuses the `kds:<storeId>` channel (see M6 PR 3);
 * for v1 we just refresh on assign/claim — a socket subscription is a
 * follow-up to avoid bloating this PR.
 */
@Component({
  selector: 'app-admin-dispatch',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div
      class="flex items-center flex-wrap"
      style="min-height: 64px; padding: 12px clamp(12px, 3vw, 24px); background: var(--color-foam); border-bottom: 1px solid var(--color-border-light); gap: 12px"
    >
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'admin.dispatch.title' | translate }}
      </h1>

      <!-- Store picker (if the user has more than one) -->
      <select
        [value]="selectedStoreId() ?? ''"
        (change)="selectStore($any($event.target).value)"
        style="height: 36px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-foam); font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary)"
      >
        @for (s of stores(); track s.id) {
          <option [value]="s.id">{{ s.name }} · {{ s.city }}</option>
        }
      </select>

      <button
        type="button"
        (click)="refresh()"
        [disabled]="loading()"
        class="flex items-center disabled:opacity-50"
        style="height: 36px; padding: 0 14px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
      >
        {{ (loading() ? 'common.refreshing' : 'common.refresh') | translate }}
      </button>
    </div>

    <section style="padding: clamp(16px, 3vw, 24px); display: flex; flex-direction: column; gap: 16px">
      @if (error()) {
        <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">{{ error() }}</p>
      }

      @if (queue().length === 0 && !loading()) {
        <p
          class="text-center"
          style="padding: 40px 0; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)"
        >
          {{ 'admin.dispatch.empty' | translate }}
        </p>
      }

      @for (o of queue(); track o.id) {
        <article
          class="flex flex-col"
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; padding: 16px; gap: 12px"
        >
          <header class="flex items-start justify-between" style="gap: 12px; flex-wrap: wrap">
            <div class="flex flex-col" style="gap: 4px">
              <span
                style="font-family: var(--font-sans); font-size: 17px; font-weight: 700; color: var(--color-espresso)"
                >#{{ o.orderCode }}</span
              >
              <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
                {{ o.customerName ?? ('common.user' | translate) }} ·
                {{ 'tma.orders.itemsCount' | translate: { count: o.itemCount } }}
              </span>
            </div>
            <span
              [style.background]="statusBg(o.status)"
              [style.color]="statusColor(o.status)"
              style="padding: 4px 10px; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700; white-space: nowrap"
              >{{ 'admin.orders.status.' + o.status | translate }}</span
            >
          </header>

          <div class="flex flex-col" style="gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary)">
              📍 {{ o.deliveryAddressLine }}, {{ o.deliveryCity }}
            </span>
            @if (o.deliveryNotes) {
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">
                📝 {{ o.deliveryNotes }}
              </span>
            }
            @if (o.customerPhone) {
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">
                📱 {{ o.customerPhone }}
              </span>
            }
          </div>

          <footer class="flex items-center justify-between" style="gap: 12px; flex-wrap: wrap">
            @if (o.rider) {
              <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary)">
                🛵 {{ o.rider.name ?? o.rider.phone ?? o.rider.id }}
              </span>
            } @else {
              <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)">
                {{ 'admin.dispatch.noRider' | translate }}
              </span>
            }

            @if (o.status === 'READY') {
              <div class="flex items-center" style="gap: 8px">
                <select
                  #riderSelect
                  style="height: 32px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-foam); font-family: var(--font-sans); font-size: 12px"
                >
                  <option value="">{{ 'admin.dispatch.pickRider' | translate }}</option>
                  @for (r of riders(); track r.id) {
                    <option [value]="r.id">{{ r.name ?? r.phone ?? r.id }}</option>
                  }
                </select>
                <button
                  type="button"
                  (click)="assign(o.id, riderSelect.value)"
                  [disabled]="!riderSelect.value || assigning()"
                  class="disabled:opacity-50"
                  style="height: 32px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: 8px; font-family: var(--font-sans); font-size: 12px; font-weight: 600"
                >
                  {{ 'admin.dispatch.assign' | translate }}
                </button>
              </div>
            }
          </footer>
        </article>
      }
    </section>
  `,
})
export class DispatchPage implements OnInit {
  private readonly catalog = inject(AdminCatalogApi);
  private readonly delivery = inject(DeliveryApi);

  readonly stores = signal<StoreAdminDto[]>([]);
  readonly selectedStoreId = signal<string | null>(null);
  readonly queue = signal<DispatchOrderRow[]>([]);
  readonly riders = signal<AvailableRider[]>([]);
  readonly loading = signal(false);
  readonly assigning = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.catalog.listStores().subscribe({
      next: (list) => {
        this.stores.set(list);
        const first = list[0];
        if (first) this.selectStore(first.id);
      },
      error: (err) => this.error.set(extractMessage(err)),
    });
  }

  selectStore(storeId: string): void {
    if (!storeId) return;
    this.selectedStoreId.set(storeId);
    this.refresh();
    this.loadRiders(storeId);
  }

  refresh(): void {
    const storeId = this.selectedStoreId();
    if (!storeId) return;
    this.loading.set(true);
    this.delivery.listQueue(storeId).subscribe({
      next: (list) => {
        this.queue.set(list);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(extractMessage(err));
      },
    });
  }

  assign(orderId: string, riderId: string): void {
    if (!riderId) return;
    this.assigning.set(true);
    this.delivery.assignRider(orderId, riderId).subscribe({
      next: () => {
        this.assigning.set(false);
        this.refresh();
      },
      error: (err) => {
        this.assigning.set(false);
        this.error.set(extractMessage(err));
      },
    });
  }

  statusBg(status: string): string {
    if (status === 'OUT_FOR_DELIVERY') return 'var(--color-caramel-light)';
    if (status === 'READY') return '#7BC4A433';
    return 'var(--color-surface-variant)';
  }

  statusColor(status: string): string {
    if (status === 'OUT_FOR_DELIVERY') return 'var(--color-caramel)';
    if (status === 'READY') return '#3E8868';
    return 'var(--color-text-secondary)';
  }

  private loadRiders(storeId: string): void {
    this.delivery.listRiders(storeId).subscribe({
      next: (list) => this.riders.set(list),
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
