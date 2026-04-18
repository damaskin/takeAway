import { Component, signal } from '@angular/core';

type OrderStatus = 'PAID' | 'ACCEPTED' | 'IN_PROGRESS' | 'READY' | 'PICKED_UP' | 'CANCELLED';

interface AdminOrder {
  code: string;
  customer: string;
  product: string;
  store: string;
  total: string;
  status: OrderStatus;
  minutesAgo: number;
}

/**
 * Admin Orders — pencil C3 (tWSda).
 *
 * Has its own in-page filter sidebar (260px foam) + 64px top bar + table.
 *
 * API: /orders/admin list isn't live yet (M3). This page currently uses
 * an inline fixture so the layout can be reviewed end-to-end.
 */
@Component({
  selector: 'app-admin-orders',
  standalone: true,
  template: `
    <div
      class="flex items-center justify-between"
      style="height: 64px; padding: 0 24px; background: var(--color-foam); border-bottom: 1px solid var(--color-border-light)"
    >
      <div class="flex items-center" style="gap: 16px">
        <h1
          style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
        >
          Orders
        </h1>
        <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)"
          >{{ filtered().length }} orders</span
        >
      </div>
      <div class="flex items-center" style="gap: 8px">
        <div
          class="flex items-center"
          style="height: 36px; padding: 0 12px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); gap: 8px"
        >
          <span style="color: var(--color-text-tertiary); font-size: 14px">🔍</span>
          <input
            type="search"
            placeholder="Code, customer, product…"
            class="outline-none bg-transparent"
            style="width: 280px; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary)"
          />
        </div>
        <button
          type="button"
          class="flex items-center"
          style="height: 36px; padding: 0 14px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
        >
          Export CSV
        </button>
      </div>
    </div>

    <section style="padding: 24px; display: grid; grid-template-columns: 1fr 260px; gap: 24px; align-items: start">
      <!-- Orders table -->
      <article
        class="flex flex-col"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; overflow: hidden; min-width: 0"
      >
        <table style="width: 100%; border-collapse: collapse; font-family: var(--font-sans)">
          <thead style="background: var(--color-cream)">
            <tr>
              <th
                style="text-align: left; padding: 12px 16px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >
                Code
              </th>
              <th
                style="text-align: left; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >
                Customer
              </th>
              <th
                style="text-align: left; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >
                Product
              </th>
              <th
                style="text-align: left; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >
                Store
              </th>
              <th
                style="text-align: right; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >
                Total
              </th>
              <th
                style="text-align: center; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >
                Status
              </th>
              <th
                style="text-align: right; padding: 12px 16px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >
                Placed
              </th>
            </tr>
          </thead>
          <tbody>
            @for (o of filtered(); track o.code) {
              <tr style="border-top: 1px solid var(--color-border-light)">
                <td
                  style="padding: 12px 16px; font-family: var(--font-mono); font-size: 13px; font-weight: 700; color: var(--color-caramel)"
                >
                  {{ o.code }}
                </td>
                <td style="padding: 12px; font-size: 14px; color: var(--color-text-primary)">
                  {{ o.customer }}
                </td>
                <td style="padding: 12px; font-size: 13px; color: var(--color-text-secondary)">
                  {{ o.product }}
                </td>
                <td style="padding: 12px; font-size: 13px; color: var(--color-text-secondary)">
                  {{ o.store }}
                </td>
                <td
                  style="padding: 12px; font-size: 14px; font-weight: 600; color: var(--color-text-primary); text-align: right"
                >
                  {{ o.total }}
                </td>
                <td style="padding: 12px; text-align: center">
                  <span
                    [style.background]="statusBg(o.status)"
                    [style.color]="statusColor(o.status)"
                    style="padding: 4px 10px; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700"
                    >{{ statusLabel(o.status) }}</span
                  >
                </td>
                <td style="padding: 12px 16px; font-size: 12px; color: var(--color-text-tertiary); text-align: right">
                  {{ o.minutesAgo }}m ago
                </td>
              </tr>
            }
          </tbody>
        </table>
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
            STATUS
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
                <span>{{ f.label }}</span>
                <span style="font-size: 12px; color: var(--color-text-tertiary)">{{ statusCount(f.key) }}</span>
              </button>
            }
          </div>
        </div>

        <div class="flex flex-col" style="gap: 8px">
          <h3
            style="font-family: var(--font-sans); font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 1px; margin: 0"
          >
            TIME RANGE
          </h3>
          <div class="flex flex-col" style="gap: 4px">
            @for (r of ranges; track r) {
              <button
                type="button"
                class="text-left"
                style="height: 36px; padding: 0 12px; border-radius: 10px; font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-primary)"
              >
                {{ r }}
              </button>
            }
          </div>
        </div>
      </aside>
    </section>
  `,
})
export class AdminOrdersPage {
  readonly activeStatus = signal<OrderStatus | 'ALL'>('ALL');

  readonly ranges = ['Today', 'Last 24 hours', 'Last 7 days', 'This month'];

  readonly statusFilters: Array<{ key: OrderStatus | 'ALL'; label: string }> = [
    { key: 'ALL', label: 'All orders' },
    { key: 'PAID', label: 'Queued' },
    { key: 'ACCEPTED', label: 'Accepted' },
    { key: 'IN_PROGRESS', label: 'Preparing' },
    { key: 'READY', label: 'Ready' },
    { key: 'PICKED_UP', label: 'Picked up' },
    { key: 'CANCELLED', label: 'Cancelled' },
  ];

  readonly fixtures: AdminOrder[] = [
    {
      code: '2481',
      customer: 'Raynor D.',
      product: 'Caramel latte · Large',
      store: 'Downtown Hub',
      total: '$5.80',
      status: 'IN_PROGRESS',
      minutesAgo: 2,
    },
    {
      code: '2480',
      customer: 'Aya K.',
      product: 'Matcha oat · Medium',
      store: 'Marina Bay',
      total: '$6.40',
      status: 'ACCEPTED',
      minutesAgo: 4,
    },
    {
      code: '2479',
      customer: 'Linh T.',
      product: 'Avocado toast + filter',
      store: 'Airport T3',
      total: '$11.20',
      status: 'READY',
      minutesAgo: 8,
    },
    {
      code: '2478',
      customer: 'Marco S.',
      product: 'Double espresso',
      store: 'Downtown Hub',
      total: '$3.20',
      status: 'PICKED_UP',
      minutesAgo: 12,
    },
    {
      code: '2477',
      customer: 'Nadia R.',
      product: 'Almond croissant · tea',
      store: 'Parkside',
      total: '$7.50',
      status: 'PAID',
      minutesAgo: 14,
    },
    {
      code: '2476',
      customer: 'Eli M.',
      product: 'Cold brew · Signature',
      store: 'Marina Bay',
      total: '$6.10',
      status: 'CANCELLED',
      minutesAgo: 22,
    },
  ];

  filtered(): AdminOrder[] {
    const f = this.activeStatus();
    if (f === 'ALL') return this.fixtures;
    return this.fixtures.filter((o) => o.status === f);
  }

  statusCount(key: OrderStatus | 'ALL'): number {
    if (key === 'ALL') return this.fixtures.length;
    return this.fixtures.filter((o) => o.status === key).length;
  }

  setStatus(s: OrderStatus | 'ALL'): void {
    this.activeStatus.set(s);
  }

  statusLabel(status: OrderStatus): string {
    return {
      PAID: 'Queued',
      ACCEPTED: 'Accepted',
      IN_PROGRESS: 'Preparing',
      READY: 'Ready',
      PICKED_UP: 'Picked up',
      CANCELLED: 'Cancelled',
    }[status];
  }

  statusBg(status: OrderStatus): string {
    if (status === 'READY') return '#7BC4A433';
    if (status === 'IN_PROGRESS') return 'var(--color-caramel-light)';
    if (status === 'ACCEPTED') return '#E9A84B33';
    if (status === 'PICKED_UP') return 'var(--color-surface-variant)';
    if (status === 'CANCELLED') return '#D94B5E22';
    return 'var(--color-surface-variant)';
  }

  statusColor(status: OrderStatus): string {
    if (status === 'READY') return '#3E8868';
    if (status === 'IN_PROGRESS') return 'var(--color-caramel)';
    if (status === 'ACCEPTED') return '#8A6720';
    if (status === 'PICKED_UP') return 'var(--color-text-secondary)';
    if (status === 'CANCELLED') return '#8F2F3C';
    return 'var(--color-text-secondary)';
  }
}
