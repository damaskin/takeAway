import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { StoreListItem } from '@takeaway/shared-types';
import { isStoreInactive, sortStoresByAvailability } from '@takeaway/utils';
import { TranslatePipe } from '@ngx-translate/core';
import { StoreLogoComponent } from '@takeaway/ui-kit';

import { CatalogService } from '../../core/catalog/catalog.service';
import { refreshStoresWhileVisible } from '../../core/catalog/live-store-refresh';
import { TmaTabBarComponent } from '../../shared/tab-bar.component';

/**
 * TMA Home — entry screen. Mirrors pencil TMA — Menu hero: store selector row,
 * then a prompt to pick a nearby store. Uses the shared bottom tab bar.
 * Closed stores sit at the end, dimmed and not tappable.
 */
@Component({
  selector: 'app-tma-home',
  standalone: true,
  imports: [RouterLink, TmaTabBarComponent, TranslatePipe, StoreLogoComponent],
  template: `
    <section style="padding: 24px 16px 88px 16px; display: flex; flex-direction: column; gap: 16px">
      <div class="flex flex-col" style="gap: 4px">
        <h1
          style="font-family: var(--font-display); font-size: 26px; font-weight: 700; color: var(--color-espresso); margin: 0"
        >
          {{ 'tma.home.title' | translate }}
        </h1>
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
          {{ 'tma.home.subtitle' | translate }}
        </p>
      </div>

      <h2
        style="font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--color-espresso); margin: 8px 0 0 0"
      >
        {{ 'tma.home.nearby' | translate }}
      </h2>

      @if (stores().length === 0) {
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)">
          {{ 'common.loading' | translate }}
        </p>
      }

      <div class="flex flex-col" style="gap: 12px">
        @for (s of stores(); track s.id) {
          <a
            [routerLink]="closed(s) ? null : ['/stores', s.slug]"
            class="flex flex-col"
            [style.opacity]="closed(s) ? 0.55 : 1"
            [style.cursor]="closed(s) ? 'default' : null"
            [attr.aria-disabled]="closed(s) || null"
            [attr.data-inactive]="closed(s) || null"
            style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; padding: 16px; gap: 8px"
          >
            <div class="flex items-start justify-between" style="gap: 12px">
              <lib-store-logo [photo]="s.heroImageUrl" [url]="s.logoUrl" [name]="s.brandName ?? s.name" [size]="44" />
              <div class="flex flex-col flex-1" style="gap: 4px">
                <span
                  style="font-family: var(--font-sans); font-size: 16px; font-weight: 600; color: var(--color-espresso)"
                  >{{ s.name }}</span
                >
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
                  >{{ s.addressLine }}, {{ s.city }}</span
                >
              </div>
              @if (closed(s)) {
                <span
                  class="flex items-center justify-center"
                  style="height: 26px; padding: 0 10px; background: #d94b5e22; color: #8f2f3c; border-radius: 9999px; font-family: var(--font-sans); font-size: 12px; font-weight: 700"
                  >{{ 'common.storeClosed.badge' | translate }}</span
                >
              } @else {
                <span
                  class="flex items-center justify-center"
                  [style.background]="etaColor(s.busyMeter)"
                  style="height: 26px; padding: 0 10px; color: white; border-radius: 9999px; font-family: var(--font-sans); font-size: 12px; font-weight: 600"
                  >⏱ {{ minutes(s.currentEtaSeconds) }} {{ 'common.units.min' | translate }}</span
                >
              }
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

  constructor() {
    refreshStoresWhileVisible(() => this.load());
  }

  ngOnInit(): void {
    this.load();
  }

  closed(store: StoreListItem): boolean {
    return isStoreInactive(store);
  }

  private load(): void {
    this.catalog
      .listStores()
      .subscribe({ next: (s) => this.stores.set(sortStoresByAvailability(s)), error: () => undefined });
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
