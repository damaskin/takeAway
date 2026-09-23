import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import type { ReadinessCheck, StoreReadinessDto, StoreStatus } from '../../core/catalog/admin-catalog.service';

/**
 * What a store still lacks before it can take orders, as the API computes
 * it. The same checks gate "Open store" on the server.
 */
@Component({
  selector: 'app-store-readiness',
  standalone: true,
  imports: [TranslatePipe, RouterLink],
  template: `
    <div
      style="display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: 12px"
    >
      <p
        style="margin: 0; font-family: var(--font-sans); font-size: 13px; font-weight: 700; color: var(--color-espresso)"
      >
        {{ title() | translate }}
      </p>
      <ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px">
        @for (item of readiness().items; track item.check) {
          <li class="flex items-start" style="gap: 8px; font-family: var(--font-sans); font-size: 13px">
            <span
              aria-hidden="true"
              [style.background]="
                item.ok ? 'var(--color-mint)' : item.required ? 'var(--color-berry)' : 'var(--color-amber)'
              "
              style="flex: none; width: 9px; height: 9px; margin-top: 5px; border-radius: 999px"
            ></span>
            <span class="flex flex-col" style="gap: 2px">
              <span [style.color]="item.ok ? 'var(--color-text-secondary)' : 'var(--color-text-primary)'">
                <span class="sr-only">{{
                  (item.ok ? 'admin.stores.readiness.done' : 'admin.stores.readiness.notDone') | translate
                }}</span>
                {{ 'admin.stores.readiness.items.' + item.check | translate }}
              </span>
              @if (!item.ok) {
                @if (item.check === 'menu') {
                  <a routerLink="/menu" style="font-size: 12px; color: var(--color-caramel)">{{
                    'admin.stores.readiness.todo.menu' | translate
                  }}</a>
                } @else if (item.check !== 'brandApproved' && canFix()) {
                  <button
                    type="button"
                    (click)="fix.emit(item.check)"
                    style="align-self: flex-start; padding: 0; background: none; border: 0; font-family: var(--font-sans); font-size: 12px; color: var(--color-caramel); text-decoration: underline; cursor: pointer"
                  >
                    {{ 'admin.stores.readiness.todo.' + item.check | translate }}
                  </button>
                } @else {
                  <span style="font-size: 12px; color: var(--color-text-tertiary)">{{
                    'admin.stores.readiness.todo.' + item.check | translate
                  }}</span>
                }
              }
            </span>
          </li>
        }
      </ul>
    </div>
  `,
})
export class StoreReadinessComponent {
  readonly readiness = input.required<StoreReadinessDto>();
  readonly status = input.required<StoreStatus>();
  /** Offer to open the editor at the place where a missing item is fixed. */
  readonly canFix = input(false);
  readonly fix = output<ReadinessCheck>();

  readonly title = computed(() => {
    if (this.status() !== 'CLOSED') return 'admin.stores.readiness.titleOpen';
    return this.readiness().ready ? 'admin.stores.readiness.titleReady' : 'admin.stores.readiness.titleClosed';
  });
}
