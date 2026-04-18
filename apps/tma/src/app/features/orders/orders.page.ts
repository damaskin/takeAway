import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { OrdersApi, type OrderStatusString, type OrderSummary } from '../../core/orders/orders.service';
import { TmaTabBarComponent } from '../../shared/tab-bar.component';

type Tab = 'ACTIVE' | 'HISTORY';

/**
 * TMA Orders History — pencil 3Srti.
 *
 * Hits /me/orders?group= on tab switch. Only authenticated users see orders
 * (unauth TMA sessions show a login prompt instead of hitting the API).
 */
@Component({
  selector: 'app-tma-orders',
  standalone: true,
  imports: [RouterLink, TmaTabBarComponent, TranslatePipe],
  template: `
    <section style="padding: 16px; padding-bottom: 88px; display: flex; flex-direction: column; gap: 16px">
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'tma.orders.title' | translate }}
      </h1>

      <!-- Tab row -->
      <div
        class="flex"
        style="background: var(--color-latte); border-radius: var(--radius-input); padding: 4px; height: 40px"
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
          {{ 'tma.orders.tabActive' | translate }}
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
          {{ 'tma.orders.tabHistory' | translate }}
        </button>
      </div>

      @if (!authStore.isAuthenticated()) {
        <div
          class="flex flex-col items-center"
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; padding: 32px 16px; gap: 10px"
        >
          <span style="font-size: 28px">🔐</span>
          <span
            style="font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-espresso)"
            >{{ 'tma.orders.signInTitle' | translate }}</span
          >
          <p
            class="text-center"
            style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0"
          >
            {{ 'tma.orders.signInSubtitle' | translate }}
          </p>
        </div>
      } @else if (loading()) {
        <p
          class="text-center"
          style="padding: 40px 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
        >
          {{ 'common.loading' | translate }}
        </p>
      } @else if (orders().length === 0) {
        <div
          class="flex flex-col items-center"
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; padding: 32px 16px; gap: 12px"
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
            @if (tab() === 'ACTIVE') {
              {{ 'tma.orders.emptyActive' | translate }}
            } @else {
              {{ 'tma.orders.emptyHistory' | translate }}
            }
          </span>
          <p
            class="text-center"
            style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0; max-width: 260px"
          >
            {{ 'tma.orders.emptySubtitle' | translate }}
          </p>
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
              style="background: var(--color-foam); border-radius: 16px; padding: 16px; gap: 10px"
            >
              <div class="flex items-start justify-between" style="gap: 10px">
                <div class="flex flex-col" style="gap: 4px">
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
              <div class="flex items-center justify-between">
                <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)"
                  >{{
                    (o.pickupMode === 'ASAP' ? 'tma.orders.pickupAsap' : 'tma.orders.pickupScheduled') | translate
                  }}
                  · {{ formatTime(o.pickupAt) }}</span
                >
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

    <app-tma-tab-bar />
  `,
})
export class TmaOrdersPage implements OnInit {
  readonly authStore = inject(TmaAuthStore);
  private readonly ordersApi = inject(OrdersApi);

  readonly tab = signal<Tab>('ACTIVE');
  readonly orders = signal<OrderSummary[]>([]);
  readonly loading = signal(false);

  readonly hasActive = computed(() => this.orders().some((o) => this.isActive(o.status)));

  ngOnInit(): void {
    if (this.authStore.isAuthenticated()) {
      this.fetchFor(this.tab());
    }
  }

  switchTab(tab: Tab): void {
    if (this.tab() === tab) return;
    this.tab.set(tab);
    if (this.authStore.isAuthenticated()) {
      this.fetchFor(tab);
    }
  }

  /** Returns a translation key — resolved via | translate in the template. */
  statusLabel(status: OrderStatusString): string {
    return `tma.orders.status.${status}`;
  }

  isActive(status: OrderStatusString): boolean {
    return ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY'].includes(status);
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
    this.ordersApi.listMine(tab, 30).subscribe({
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
