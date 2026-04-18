import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { StoreListItem } from '@takeaway/shared-types';

import { CatalogService } from '../../core/catalog/catalog.service';

@Component({
  selector: 'app-stores-list',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="max-w-6xl mx-auto px-4 py-12">
      <h1 class="text-4xl mb-2" style="font-family: var(--font-display)">Stores</h1>
      <p class="mb-8" style="opacity: 0.6">Sorted by current ETA for an ASAP order.</p>

      @if (stores().length === 0) {
        <p style="opacity: 0.6">Loading…</p>
      }

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        @for (store of stores(); track store.id) {
          <a
            [routerLink]="['/stores', store.slug]"
            class="block p-5"
            style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft)"
          >
            <div class="flex items-start justify-between">
              <div>
                <h2 class="text-xl" style="font-family: var(--font-display)">{{ store.name }}</h2>
                <p class="text-sm mt-1" style="opacity: 0.6">{{ store.addressLine }} · {{ store.city }}</p>
              </div>
              <span
                class="text-xs px-3 py-1 font-medium"
                style="background: var(--color-espresso); color: white; border-radius: var(--radius-pill)"
              >
                Ready in {{ etaMinutes(store) }} min
              </span>
            </div>
          </a>
        }
      </div>
    </section>
  `,
})
export class StoresListPage implements OnInit {
  private readonly catalog = inject(CatalogService);

  readonly stores = signal<StoreListItem[]>([]);

  ngOnInit(): void {
    this.catalog.listStores().subscribe({ next: (list) => this.stores.set(list) });
  }

  etaMinutes(store: StoreListItem): number {
    return Math.max(1, Math.round(store.currentEtaSeconds / 60));
  }
}
