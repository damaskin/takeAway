import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { StoreListItem } from '@takeaway/shared-types';

import { CatalogService } from '../../core/catalog/catalog.service';
import { TmaTabBarComponent } from '../../shared/tab-bar.component';

/**
 * TMA Store Selector — pencil POOLf.
 *
 * Body (gap 16):
 *   searchBar (44px, foam)
 *   mapFrame  (160px, aerial photo)
 *   "Nearby" section label
 *   store cards — caramel 2px stroke on selected, foam otherwise
 */
@Component({
  selector: 'app-tma-stores',
  standalone: true,
  imports: [RouterLink, TmaTabBarComponent],
  template: `
    <section style="padding: 16px; padding-bottom: 88px; display: flex; flex-direction: column; gap: 16px">
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        Pick a store
      </h1>

      <!-- Search bar -->
      <div
        class="flex items-center"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); height: 44px; padding: 0 14px; gap: 10px"
      >
        <span style="color: var(--color-text-secondary); font-size: 16px">🔍</span>
        <input
          type="search"
          placeholder="District, landmark…"
          class="flex-1 outline-none bg-transparent"
          style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
        />
      </div>

      <!-- Map tile -->
      <div
        class="relative"
        style="height: 160px; border-radius: 16px; overflow: hidden; background: var(--color-latte)"
      >
        <div
          style="position: absolute; inset: 0; background-image:
            linear-gradient(180deg, rgba(213, 201, 181, 0.8) 1px, transparent 1px),
            linear-gradient(90deg, rgba(213, 201, 181, 0.8) 1px, transparent 1px);
            background-size: 90px 90px, 70px 70px; opacity: 0.7"
        ></div>
        <div
          class="absolute flex items-center justify-center"
          style="top: 40%; left: 30%; width: 28px; height: 28px; border-radius: 9999px; background: var(--color-caramel); color: white; font-size: 14px; transform: translate(-50%, -100%)"
        >
          ☕
        </div>
        <div
          class="absolute flex items-center justify-center"
          style="top: 60%; left: 60%; width: 28px; height: 28px; border-radius: 9999px; background: #7bc4a4; color: white; font-size: 14px; transform: translate(-50%, -100%)"
        >
          ☕
        </div>
      </div>

      <span
        style="font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--color-espresso); margin-top: 4px"
        >Nearby</span
      >

      <div class="flex flex-col" style="gap: 12px">
        @for (s of stores(); track s.id; let i = $index) {
          <a
            [routerLink]="['/stores', s.slug]"
            class="flex flex-col"
            [style.border]="i === 0 ? '2px solid var(--color-caramel)' : '1px solid var(--color-border-light)'"
            style="background: var(--color-foam); border-radius: 16px; padding: 16px; gap: 8px"
          >
            <div class="flex items-center justify-between">
              <span
                style="font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--color-espresso)"
                >{{ s.name }}</span
              >
              <span
                [style.background]="statusBg(s.status)"
                [style.color]="statusColor(s.status)"
                style="padding: 3px 10px; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700"
                >{{ statusLabel(s.status) }}</span
              >
            </div>
            <p style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary); margin: 0">
              {{ s.addressLine }}, {{ s.city }}
            </p>
            <div class="flex items-center" style="gap: 14px">
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
                >⏱ {{ minutes(s.currentEtaSeconds) }} min</span
              >
              @if (s.distanceMeters !== null) {
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
                  >🚶 {{ distanceLabel(s.distanceMeters) }}</span
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
export class TmaStoresPage implements OnInit {
  private readonly catalog = inject(CatalogService);

  readonly stores = signal<StoreListItem[]>([]);

  ngOnInit(): void {
    this.catalog.listStores().subscribe({ next: (s) => this.stores.set(s) });
  }

  minutes(seconds: number): number {
    return Math.max(1, Math.round(seconds / 60));
  }

  distanceLabel(meters: number): string {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  }

  statusLabel(status: StoreListItem['status']): string {
    if (status === 'OPEN') return 'Open';
    if (status === 'OVERLOADED') return 'Busy';
    return 'Closed';
  }

  statusBg(status: StoreListItem['status']): string {
    if (status === 'OPEN') return '#7BC4A433';
    if (status === 'OVERLOADED') return '#E9A84B33';
    return '#D94B5E22';
  }

  statusColor(status: StoreListItem['status']): string {
    if (status === 'OPEN') return '#3E8868';
    if (status === 'OVERLOADED') return '#8A6720';
    return '#8F2F3C';
  }
}
