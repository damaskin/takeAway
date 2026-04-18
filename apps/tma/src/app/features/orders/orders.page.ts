import { Component, signal } from '@angular/core';

import { TmaTabBarComponent } from '../../shared/tab-bar.component';

type Tab = 'ACTIVE' | 'HISTORY';

/**
 * TMA Orders History — pencil 3Srti.
 *
 * Body (gap 16):
 *   title "Your orders"
 *   tabRow (latte, 40px pill tabs: Active / History)
 *   activeCard — caramel 2px stroke card with live order status
 *   history cards — foam cards with past orders
 *
 * NOTE: API endpoint /orders/me isn't live yet; this page stubs the list
 * with a placeholder empty state until M3 delivers it.
 */
@Component({
  selector: 'app-tma-orders',
  standalone: true,
  imports: [TmaTabBarComponent],
  template: `
    <section style="padding: 16px; padding-bottom: 88px; display: flex; flex-direction: column; gap: 16px">
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        Your orders
      </h1>

      <!-- Tab row -->
      <div
        class="flex"
        style="background: var(--color-latte); border-radius: var(--radius-input); padding: 4px; height: 40px"
      >
        <button
          type="button"
          (click)="tab.set('ACTIVE')"
          class="flex-1 flex items-center justify-center"
          [style.background]="tab() === 'ACTIVE' ? 'var(--color-foam)' : 'transparent'"
          [style.color]="tab() === 'ACTIVE' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'"
          [style.boxShadow]="tab() === 'ACTIVE' ? 'var(--shadow-soft)' : 'none'"
          style="border-radius: 10px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
        >
          Active
        </button>
        <button
          type="button"
          (click)="tab.set('HISTORY')"
          class="flex-1 flex items-center justify-center"
          [style.background]="tab() === 'HISTORY' ? 'var(--color-foam)' : 'transparent'"
          [style.color]="tab() === 'HISTORY' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'"
          [style.boxShadow]="tab() === 'HISTORY' ? 'var(--shadow-soft)' : 'none'"
          style="border-radius: 10px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
        >
          History
        </button>
      </div>

      <!-- Empty state until /orders/me lands -->
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
            No active orders
          } @else {
            No past orders yet
          }
        </span>
        <p
          class="text-center"
          style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0; max-width: 260px"
        >
          Your takeAway history will appear here once you place your first order.
        </p>
      </div>
    </section>

    <app-tma-tab-bar />
  `,
})
export class TmaOrdersPage {
  readonly tab = signal<Tab>('ACTIVE');
}
