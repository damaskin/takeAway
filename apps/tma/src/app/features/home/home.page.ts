import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { StoreListItem } from '@takeaway/shared-types';

import { CatalogService } from '../../core/catalog/catalog.service';
import { TmaTabBarComponent } from '../../shared/tab-bar.component';

/**
 * TMA Home — entry screen. Mirrors pencil TMA — Menu hero: store selector row,
 * then a prompt to pick a nearby store. Uses the shared bottom tab bar.
 */
@Component({
  selector: 'app-tma-home',
  standalone: true,
  imports: [RouterLink, TmaTabBarComponent],
  template: `
    <section style="padding: 24px 16px 88px 16px; display: flex; flex-direction: column; gap: 16px">
      <div class="flex flex-col" style="gap: 4px">
        <h1
          style="font-family: var(--font-display); font-size: 26px; font-weight: 700; color: var(--color-espresso); margin: 0"
        >
          Pre-order
        </h1>
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
          Skip the queue. Pick it up.
        </p>
      </div>

      <h2
        style="font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--color-espresso); margin: 8px 0 0 0"
      >
        Nearby stores
      </h2>

      @if (stores().length === 0) {
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)">Loading…</p>
      }

      <div class="flex flex-col" style="gap: 12px">
        @for (s of stores(); track s.id) {
          <a
            [routerLink]="['/stores', s.slug]"
            class="flex flex-col"
            style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; padding: 16px; gap: 8px"
          >
            <div class="flex items-start justify-between" style="gap: 12px">
              <div class="flex flex-col" style="gap: 4px">
                <span
                  style="font-family: var(--font-sans); font-size: 16px; font-weight: 600; color: var(--color-espresso)"
                  >{{ s.name }}</span
                >
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
                  >{{ s.addressLine }}, {{ s.city }}</span
                >
              </div>
              <span
                class="flex items-center justify-center"
                [style.background]="etaColor(s.busyMeter)"
                style="height: 26px; padding: 0 10px; color: white; border-radius: 9999px; font-family: var(--font-sans); font-size: 12px; font-weight: 600"
                >⏱ {{ minutes(s.currentEtaSeconds) }} min</span
              >
            </div>
          </a>
        }
      </div>
    </section>

    <app-tma-tab-bar />
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

  etaColor(busy: number): string {
    if (busy >= 75) return 'var(--color-berry)';
    if (busy >= 40) return 'var(--color-amber)';
    return 'var(--color-mint)';
  }
}
