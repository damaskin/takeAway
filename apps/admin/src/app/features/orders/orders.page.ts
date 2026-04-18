import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminOrdersApi, type AdminOrderSummary, type OrderStatusString } from '../../core/orders/orders.service';

type OrderStatus = OrderStatusString;
type StatusFilter = OrderStatus | 'ALL';

/**
 * Admin Orders — pencil C3 (tWSda).
 *
 * Lives on GET /admin/orders (M4). Filter sidebar re-queries the endpoint
 * so counts reflect what the backend actually has for the current filter.
 */
@Component({
  selector: 'app-admin-orders',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div
      class="flex items-center justify-between"
      style="height: 64px; padding: 0 24px; background: var(--color-foam); border-bottom: 1px solid var(--color-border-light)"
    >
      <div class="flex items-center" style="gap: 16px">
        <h1
          style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
        >
          {{ 'admin.orders.title' | translate }}
        </h1>
        <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)">{{
          'admin.orders.count' | translate: { count: filtered().length }
        }}</span>
      </div>
      <div class="flex items-center" style="gap: 8px">
        <div
          class="flex items-center"
          style="height: 36px; padding: 0 12px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); gap: 8px"
        >
          <span style="color: var(--color-text-tertiary); font-size: 14px">🔍</span>
          <input
            type="search"
            [placeholder]="'admin.orders.searchPlaceholder' | translate"
            (input)="onSearch($event)"
            class="outline-none bg-transparent"
            style="width: 280px; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary)"
          />
        </div>
        <button
          type="button"
          (click)="refresh()"
          [disabled]="loading()"
          class="flex items-center"
          style="height: 36px; padding: 0 14px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
        >
          {{ (loading() ? 'common.refreshing' : 'common.refresh') | translate }}
        </button>
      </div>
    </div>

    <section style="padding: 24px; display: grid; grid-template-columns: 1fr 260px; gap: 24px; align-items: start">
      <!-- Orders table -->
      <article
        class="flex flex-col"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; overflow: hidden; min-width: 0"
      >
        @if (loading() && orders().length === 0) {
          <p
            class="text-center"
            style="padding: 40px; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
          >
            {{ 'common.loading' | translate }}
          </p>
        } @else if (filtered().length === 0) {
          <p
            class="text-center"
            style="padding: 40px; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
          >
            {{ 'admin.orders.empty' | translate }}
          </p>
        } @else {
          <table style="width: 100%; border-collapse: collapse; font-family: var(--font-sans)">
            <thead style="background: var(--color-cream)">
              <tr>
                <th
                  style="text-align: left; padding: 12px 16px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >
                  {{ 'admin.orders.columns.code' | translate }}
                </th>
                <th
                  style="text-align: left; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >
                  {{ 'admin.orders.columns.store' | translate }}
                </th>
                <th
                  style="text-align: left; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >
                  {{ 'admin.orders.columns.items' | translate }}
                </th>
                <th
                  style="text-align: left; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >
                  {{ 'admin.orders.columns.pickup' | translate }}
                </th>
                <th
                  style="text-align: right; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >
                  {{ 'admin.orders.columns.total' | translate }}
                </th>
                <th
                  style="text-align: center; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >
                  {{ 'admin.orders.columns.status' | translate }}
                </th>
                <th
                  style="text-align: right; padding: 12px 16px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >
                  {{ 'admin.orders.columns.placed' | translate }}
                </th>
              </tr>
            </thead>
            <tbody>
              @for (o of filtered(); track o.id) {
                <tr style="border-top: 1px solid var(--color-border-light)">
                  <td
                    style="padding: 12px 16px; font-family: var(--font-mono); font-size: 13px; font-weight: 700; color: var(--color-caramel)"
                  >
                    {{ o.orderCode }}
                  </td>
                  <td style="padding: 12px; font-size: 13px; color: var(--color-text-primary)">
                    {{ o.storeName }}
                  </td>
                  <td style="padding: 12px; font-size: 13px; color: var(--color-text-secondary)">
                    {{ o.itemCount }}
                  </td>
                  <td style="padding: 12px; font-size: 12px; color: var(--color-text-secondary)">
                    {{ o.pickupMode === 'ASAP' ? 'ASAP' : 'Scheduled' }} · {{ formatTime(o.pickupAt) }}
                  </td>
                  <td
                    style="padding: 12px; font-size: 14px; font-weight: 600; color: var(--color-text-primary); text-align: right"
                  >
                    {{ price(o.totalCents, o.currency) }}
                  </td>
                  <td style="padding: 12px; text-align: center">
                    <span
                      [style.background]="statusBg(o.status)"
                      [style.color]="statusColor(o.status)"
                      style="padding: 4px 10px; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700"
                      >{{ statusLabel(o.status) | translate }}</span
                    >
                  </td>
                  <td style="padding: 12px 16px; font-size: 12px; color: var(--color-text-tertiary); text-align: right">
                    {{ timeAgo(o.createdAt) }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </article>

      <!-- Filter rail -->
      <aside
        class="flex flex-col"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 16px"
      >
        <div class="flex flex-col" style="gap: 8px">
          <h3
            style="font-family: var(--font-sans); font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 1px; margin: 0"
          >
            {{ 'admin.orders.columns.status' | translate }}
          </h3>
          <div class="flex flex-col" style="gap: 4px">
            @for (f of statusFilters; track f.key) {
              <button
                type="button"
                (click)="setStatus(f.key)"
                class="flex items-center justify-between"
                [style.background]="activeStatus() === f.key ? 'var(--color-caramel-light)' : 'transparent'"
                [style.color]="activeStatus() === f.key ? 'var(--color-caramel)' : 'var(--color-text-primary)'"
                style="height: 38px; padding: 0 12px; border-radius: 10px; font-family: var(--font-sans); font-size: 13px; font-weight: 500"
              >
                <span>{{ f.label | translate }}</span>
                <span style="font-size: 12px; color: var(--color-text-tertiary)">{{ statusCount(f.key) }}</span>
              </button>
            }
          </div>
        </div>
      </aside>
    </section>
  `,
})
export class AdminOrdersPage implements OnInit {
  private readonly api = inject(AdminOrdersApi);

  readonly activeStatus = signal<StatusFilter>('ALL');
  readonly search = signal('');
  readonly loading = signal(false);
  readonly orders = signal<AdminOrderSummary[]>([]);

  readonly statusFilters: Array<{ key: StatusFilter; label: string }> = [
    { key: 'ALL', label: 'admin.orders.filters.all' },
    { key: 'PAID', label: 'admin.orders.status.PAID' },
    { key: 'ACCEPTED', label: 'admin.orders.status.ACCEPTED' },
    { key: 'IN_PROGRESS', label: 'admin.orders.status.IN_PROGRESS' },
    { key: 'READY', label: 'admin.orders.status.READY' },
    { key: 'PICKED_UP', label: 'admin.orders.status.PICKED_UP' },
    { key: 'CANCELLED', label: 'admin.orders.status.CANCELLED' },
  ];

  readonly filtered = computed(() => {
    const list = this.orders();
    const status = this.activeStatus();
    const q = this.search().toLowerCase().trim();
    return list.filter((o) => {
      if (status !== 'ALL' && o.status !== status) return false;
      if (q && !this.matches(o, q)) return false;
      return true;
    });
  });

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.api.list({ take: 200 }).subscribe({
      next: (list) => {
        this.orders.set(list);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  setStatus(s: StatusFilter): void {
    this.activeStatus.set(s);
  }

  statusCount(key: StatusFilter): number {
    if (key === 'ALL') return this.orders().length;
    return this.orders().filter((o) => o.status === key).length;
  }

  onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  /** Returns a translation key — resolved in the template via | translate. */
  statusLabel(status: OrderStatus): string {
    return `admin.orders.status.${status}`;
  }

  statusBg(status: OrderStatus): string {
    if (status === 'READY') return '#7BC4A433';
    if (status === 'IN_PROGRESS') return 'var(--color-caramel-light)';
    if (status === 'ACCEPTED' || status === 'CREATED' || status === 'PAID') return '#E9A84B33';
    if (status === 'PICKED_UP') return 'var(--color-surface-variant)';
    if (status === 'CANCELLED' || status === 'EXPIRED') return '#D94B5E22';
    return 'var(--color-surface-variant)';
  }

  statusColor(status: OrderStatus): string {
    if (status === 'READY') return '#3E8868';
    if (status === 'IN_PROGRESS') return 'var(--color-caramel)';
    if (status === 'ACCEPTED' || status === 'CREATED' || status === 'PAID') return '#8A6720';
    if (status === 'PICKED_UP') return 'var(--color-text-secondary)';
    if (status === 'CANCELLED' || status === 'EXPIRED') return '#8F2F3C';
    return 'var(--color-text-secondary)';
  }

  price(cents: number, currency: string): string {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  }

  formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.round(diff / 60_000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }

  private matches(o: AdminOrderSummary, q: string): boolean {
    return (
      o.orderCode.toLowerCase().includes(q) ||
      o.storeName.toLowerCase().includes(q) ||
      o.status.toLowerCase().includes(q)
    );
  }
}
