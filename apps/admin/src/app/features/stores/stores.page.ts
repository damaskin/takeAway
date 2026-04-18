import { Component, OnInit, inject, signal } from '@angular/core';

import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';

@Component({
  selector: 'app-stores',
  standalone: true,
  template: `
    <h1 class="text-3xl mb-8" style="font-family: var(--font-display)">Stores</h1>

    @if (stores().length === 0 && !error()) {
      <p style="opacity: 0.6">No stores yet.</p>
    }

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      @for (s of stores(); track s.id) {
        <article
          class="p-5"
          style="background: var(--color-cream); border-radius: var(--radius-card); box-shadow: var(--shadow-soft)"
        >
          <h2 class="text-lg mb-1" style="font-family: var(--font-display)">{{ s.name }}</h2>
          <p class="text-sm" style="opacity: 0.6">{{ s.city }} · {{ s.country }}</p>
          <p class="text-xs mt-2 uppercase tracking-wider" style="opacity: 0.5">{{ s.status }} · {{ s.currency }}</p>
        </article>
      }
    </div>

    @if (error()) {
      <p class="mt-4 text-sm" style="color: var(--color-berry)">{{ error() }}</p>
    }
  `,
})
export class StoresPage implements OnInit {
  private readonly api = inject(AdminCatalogApi);

  readonly stores = signal<StoreAdminDto[]>([]);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.api.listStores().subscribe({
      next: (list) => this.stores.set(list),
      error: (err) => {
        const maybe = err as { error?: { message?: string }; message?: string };
        this.error.set(maybe.error?.message ?? maybe.message ?? 'Failed to load stores');
      },
    });
  }
}
