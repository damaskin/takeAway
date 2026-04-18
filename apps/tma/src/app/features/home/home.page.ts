import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { StoreListItem } from '@takeaway/shared-types';

import { CatalogService } from '../../core/catalog/catalog.service';

@Component({
  selector: 'app-tma-home',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="px-4 pt-6 pb-24">
      <h1 class="text-2xl mb-1" style="font-family: var(--font-display)">Pre-order</h1>
      <p class="text-sm mb-6" style="opacity: 0.6">Skip the queue. Pick it up.</p>

      <h2 class="text-lg mb-3" style="font-family: var(--font-display)">Nearby stores</h2>
      @if (stores().length === 0) {
        <p class="text-sm" style="opacity: 0.6">Loading…</p>
      }
      <ul class="flex flex-col gap-3">
        @for (s of stores(); track s.id) {
          <li>
            <a
              [routerLink]="['/stores', s.slug]"
              class="block p-4"
              style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft)"
            >
              <div class="flex items-start justify-between">
                <div>
                  <h3 style="font-family: var(--font-display)">{{ s.name }}</h3>
                  <p class="text-xs mt-1" style="opacity: 0.6">{{ s.addressLine }}</p>
                </div>
                <span
                  class="text-xs px-2 py-1 font-medium"
                  [style.background]="eta(s.busyMeter)"
                  style="color: white; border-radius: var(--radius-pill)"
                >
                  {{ minutes(s.currentEtaSeconds) }} min
                </span>
              </div>
            </a>
          </li>
        }
      </ul>
    </section>
  `,
})
export class TmaHomePage implements OnInit {
  private readonly catalog = inject(CatalogService);

  readonly stores = signal<StoreListItem[]>([]);

  ngOnInit(): void {
    this.catalog.listStores().subscribe({ next: (s) => this.stores.set(s) });
  }

  minutes(seconds: number): number {
    return Math.max(1, Math.round(seconds / 60));
  }

  eta(busy: number): string {
    if (busy >= 75) return 'var(--color-berry)';
    if (busy >= 40) return 'var(--color-amber)';
    return 'var(--color-mint)';
  }
}
