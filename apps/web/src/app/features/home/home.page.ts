import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { StoreListItem } from '@takeaway/shared-types';

import { CatalogService } from '../../core/catalog/catalog.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="max-w-6xl mx-auto px-4 pt-16 pb-20">
      <h1
        class="text-5xl md:text-6xl leading-tight max-w-3xl"
        style="font-family: var(--font-display); color: var(--color-espresso)"
      >
        Pre-order. Skip the queue.
      </h1>
      <p class="mt-6 text-lg max-w-2xl" style="opacity: 0.7">
        Your coffee and food ready the moment you walk in. Zero waiting.
      </p>
      <div class="mt-8 flex gap-3">
        <a
          routerLink="/stores"
          class="px-6 py-3 font-medium"
          style="background: var(--color-caramel); color: white; border-radius: var(--radius-button)"
        >
          Order now
        </a>
        <a
          routerLink="/menu"
          class="px-6 py-3 font-medium border"
          style="border-color: var(--color-espresso); border-radius: var(--radius-button)"
        >
          Browse the menu
        </a>
      </div>
    </section>

    <section class="max-w-6xl mx-auto px-4 pb-16">
      <h2 class="text-2xl mb-6" style="font-family: var(--font-display)">Live near you</h2>
      @if (stores().length === 0) {
        <p style="opacity: 0.6">Loading nearby stores…</p>
      }
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        @for (store of stores(); track store.id) {
          <a
            [routerLink]="['/stores', store.slug]"
            class="block p-5 transition-shadow"
            style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft)"
          >
            <div class="flex items-start justify-between">
              <div>
                <h3 class="text-lg" style="font-family: var(--font-display)">{{ store.name }}</h3>
                <p class="text-sm mt-1" style="opacity: 0.6">{{ store.city }} · {{ store.country }}</p>
              </div>
              <span
                class="text-xs px-3 py-1 font-medium"
                [style.background]="etaColor(store)"
                style="color: white; border-radius: var(--radius-pill)"
              >
                Ready in {{ etaMinutes(store) }} min
              </span>
            </div>
            <div class="mt-4 h-2 rounded-full overflow-hidden" style="background: var(--color-latte)">
              <div
                class="h-full transition-all"
                [style.width.%]="store.busyMeter"
                [style.background]="busyColor(store)"
              ></div>
            </div>
            <p class="text-xs mt-2" style="opacity: 0.6">{{ busyLabel(store) }}</p>
          </a>
        }
      </div>
    </section>

    <section class="max-w-6xl mx-auto px-4 pb-20">
      <h2 class="text-2xl mb-6" style="font-family: var(--font-display)">How it works</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        @for (step of steps; let i = $index; track step.title) {
          <article
            class="p-6"
            style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft)"
          >
            <span class="text-sm" style="color: var(--color-caramel); font-family: var(--font-mono)">0{{ i + 1 }}</span>
            <h3 class="text-xl mt-2" style="font-family: var(--font-display)">{{ step.title }}</h3>
            <p class="mt-2 text-sm" style="opacity: 0.7">{{ step.body }}</p>
          </article>
        }
      </div>
    </section>
  `,
})
export class HomePage implements OnInit {
  private readonly catalog = inject(CatalogService);

  readonly stores = signal<StoreListItem[]>([]);

  readonly steps = [
    { title: 'Choose when', body: 'Pick ASAP or a specific time — we start preparing to match.' },
    { title: 'We prepare', body: 'Track the live timer and status on your way over.' },
    { title: 'You walk in, we hand it over', body: 'Show your code, grab your bag, keep moving.' },
  ];

  ngOnInit(): void {
    this.catalog.listStores().subscribe({
      next: (list) => this.stores.set(list.slice(0, 6)),
    });
  }

  etaMinutes(store: StoreListItem): number {
    return Math.max(1, Math.round(store.currentEtaSeconds / 60));
  }

  etaColor(store: StoreListItem): string {
    if (store.busyMeter >= 75) return 'var(--color-berry)';
    if (store.busyMeter >= 40) return 'var(--color-amber-warn)';
    return 'var(--color-mint)';
  }

  busyColor(store: StoreListItem): string {
    if (store.busyMeter >= 75) return 'var(--color-berry)';
    if (store.busyMeter >= 40) return 'var(--color-amber-warn)';
    return 'var(--color-mint)';
  }

  busyLabel(store: StoreListItem): string {
    if (store.busyMeter >= 75) return 'Peak — expect longer waits';
    if (store.busyMeter >= 40) return 'Busy';
    return 'Fast';
  }
}
