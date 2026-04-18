import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { OrdersApi, type OrderStatusString, type OrderSummary } from '../../core/orders/orders.service';

type Tab = 'ACTIVE' | 'HISTORY';

const ACTIVE_STATUSES: OrderStatusString[] = ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY'];

/**
 * Web "My orders" page — surfaced from the profile screen and from the
 * top-bar quick-link. Same shape as the TMA orders page (active vs history
 * tabs + status badges + ETA), but routed through the web shell so users on
 * desktop / mobile-web can pull up their order history without leaving the
 * site.
 *
 * Backed by GET /me/orders?group=ACTIVE|HISTORY (M4 endpoint, already exists).
 */
@Component({
  selector: 'app-orders-history',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <section class="flex flex-col" style="max-width: 800px; margin: 0 auto; padding: 32px 16px 48px 16px; gap: 24px">
      <header class="flex flex-col" style="gap: 4px">
        <h1
          style="font-family: var(--font-display); font-size: 28px; font-weight: 700; color: var(--color-espresso); margin: 0"
        >
          {{ 'web.orders.title' | translate }}
        </h1>
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
          {{ 'web.orders.subtitle' | translate }}
        </p>
      </header>

      <!-- Tab row -->
      <div
        class="flex"
        style="background: var(--color-latte); border-radius: var(--radius-input); padding: 4px; height: 44px; max-width: 360px"
      >
        <button
          type="button"
          (click)="switchTab('ACTIVE')"
          class="flex-1 flex items-center justify-center"
          [style.background]="tab() === 'ACTIVE' ? 'var(--color-foam)' : 'transparent'"
          [style.color]="tab() === 'ACTIVE' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'"
          [style.boxShadow]="tab() === 'ACTIVE' ? 'var(--shadow-soft)' : 'none'"
          style="border-radius: 10px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
        >
          {{ 'web.orders.tabActive' | translate }}
          @if (activeCount() > 0) {
            <span
              style="margin-left: 6px; padding: 1px 7px; background: var(--color-caramel); color: white; border-radius: 9999px; font-size: 11px; font-weight: 700"
              >{{ activeCount() }}</span
            >
          }
        </button>
        <button
          type="button"
          (click)="switchTab('HISTORY')"
          class="flex-1 flex items-center justify-center"
          [style.background]="tab() === 'HISTORY' ? 'var(--color-foam)' : 'transparent'"
          [style.color]="tab() === 'HISTORY' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'"
          [style.boxShadow]="tab() === 'HISTORY' ? 'var(--shadow-soft)' : 'none'"
          style="border-radius: 10px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
        >
          {{ 'web.orders.tabHistory' | translate }}
        </button>
      </div>

      @if (loading()) {
        <p
          class="text-center"
          style="padding: 40px 0; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)"
        >
          {{ 'common.loading' | translate }}
        </p>
      } @else if (orders().length === 0) {
        <div
          class="flex flex-col items-center"
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; padding: 48px 24px; gap: 12px"
        >
          <div
            class="flex items-center justify-center"
            style="width: 72px; height: 72px; border-radius: 9999px; background: var(--color-caramel-light); font-size: 28px"
          >
            ☕
          </div>
          <span
            style="font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-espresso); text-align: center"
          >
            {{ (tab() === 'ACTIVE' ? 'web.orders.emptyActive' : 'web.orders.emptyHistory') | translate }}
          </span>
          <p
            class="text-center"
            style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0; max-width: 320px"
          >
            {{ 'web.orders.emptySubtitle' | translate }}
          </p>
          <a
            routerLink="/menu"
            style="margin-top: 8px; padding: 10px 18px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600"
            >{{ 'web.orders.browseMenu' | translate }}</a
          >
        </div>
      } @else {
        <div class="flex flex-col" style="gap: 12px">
          @for (o of orders(); track o.id) {
            <a
              [routerLink]="['/orders', o.id]"
              class="flex flex-col"
              [style.border]="
                isActive(o.status) ? '2px solid var(--color-caramel)' : '1px solid var(--color-border-light)'
              "
              style="background: var(--color-foam); border-radius: 16px; padding: 16px; gap: 10px; text-decoration: none"
            >
              <div class="flex items-start justify-between" style="gap: 12px; flex-wrap: wrap">
                <div class="flex flex-col" style="gap: 4px; min-width: 0">
                  <span
                    style="font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso)"
                    >#{{ o.orderCode }} · {{ o.storeName }}</span
                  >
                  <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
                    >{{ formatDate(o.createdAt) }} ·
                    {{ 'tma.orders.itemsCount' | translate: { count: o.itemCount } }}</span
                  >
                </div>
                <span
                  [style.background]="statusBg(o.status)"
                  [style.color]="statusColor(o.status)"
                  style="padding: 4px 10px; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700; white-space: nowrap"
                  >{{ statusLabel(o.status) | translate }}</span
                >
              </div>
              <div class="flex items-center justify-between" style="gap: 12px; flex-wrap: wrap">
                <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)">
                  {{ (o.pickupMode === 'ASAP' ? 'tma.orders.pickupAsap' : 'tma.orders.pickupScheduled') | translate }}
                  · {{ formatTime(o.pickupAt) }}
                </span>
                <span
                  style="font-family: var(--font-sans); font-size: 14px; font-weight: 700; color: var(--color-caramel)"
                  >{{ price(o.totalCents, o.currency) }}</span
                >
              </div>
            </a>
          }
        </div>
      }
    </section>
  `,
})
export class OrdersHistoryPage implements OnInit {
  private readonly api = inject(OrdersApi);

  readonly tab = signal<Tab>('ACTIVE');
  readonly orders = signal<OrderSummary[]>([]);
  readonly loading = signal(false);

  // Cached active-count badge — driven by the current `orders` signal when
  // we're on the ACTIVE tab; on HISTORY we'd need a separate fetch. Keep it
  // simple: refresh on tab switch and only show the badge while ACTIVE is
  // open (stale-but-harmless on HISTORY).
  readonly activeCount = computed(() =>
    this.tab() === 'ACTIVE' ? this.orders().filter((o) => this.isActive(o.status)).length : 0,
  );

  ngOnInit(): void {
    this.fetchFor(this.tab());
  }

  switchTab(tab: Tab): void {
    if (this.tab() === tab) return;
    this.tab.set(tab);
    this.fetchFor(tab);
  }

  isActive(status: OrderStatusString): boolean {
    return ACTIVE_STATUSES.includes(status);
  }

  /** Returns a translation key — resolved via | translate in the template. */
  statusLabel(status: OrderStatusString): string {
    return `tma.orders.status.${status}`;
  }

  statusBg(status: OrderStatusString): string {
    if (status === 'READY') return '#7BC4A433';
    if (status === 'IN_PROGRESS') return 'var(--color-caramel-light)';
    if (status === 'ACCEPTED' || status === 'PAID' || status === 'CREATED') return '#E9A84B33';
    if (status === 'PICKED_UP') return 'var(--color-surface-variant)';
    return '#D94B5E22';
  }

  statusColor(status: OrderStatusString): string {
    if (status === 'READY') return '#3E8868';
    if (status === 'IN_PROGRESS') return 'var(--color-caramel)';
    if (status === 'ACCEPTED' || status === 'PAID' || status === 'CREATED') return '#8A6720';
    if (status === 'PICKED_UP') return 'var(--color-text-secondary)';
    return '#8F2F3C';
  }

  price(cents: number, currency: string): string {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private fetchFor(tab: Tab): void {
    this.loading.set(true);
    this.api.listMine(tab, 30).subscribe({
      next: (list) => {
        this.orders.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.orders.set([]);
      },
    });
  }
}
