import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { StoreListItem } from '@takeaway/shared-types';
import { LeafletMapComponent, type MapMarker } from '@takeaway/ui-kit';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

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
  imports: [RouterLink, TmaTabBarComponent, TranslatePipe, LeafletMapComponent],
  template: `
    <section style="padding: 16px; padding-bottom: 88px; display: flex; flex-direction: column; gap: 16px">
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'tma.stores.title' | translate }}
      </h1>

      <!-- Search bar -->
      <div
        class="flex items-center"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); height: 44px; padding: 0 14px; gap: 10px"
      >
        <span style="color: var(--color-text-secondary); font-size: 16px">🔍</span>
        <input
          type="search"
          [placeholder]="'tma.stores.search' | translate"
          class="flex-1 outline-none bg-transparent"
          style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
        />
      </div>

      <!-- Map -->
      @if (storeMarkers().length > 0) {
        <div style="height: 160px; border-radius: 16px; overflow: hidden">
          <lib-leaflet-map [markers]="storeMarkers()" />
        </div>
      }

      <span
        style="font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--color-espresso); margin-top: 4px"
        >{{ 'tma.stores.nearby' | translate }}</span
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
                >{{ statusLabel(s.status) | translate }}</span
              >
            </div>
            <p style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary); margin: 0">
              {{ s.addressLine }}, {{ s.city }}
            </p>
            <div class="flex items-center" style="gap: 14px">
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
                >⏱ {{ minutes(s.currentEtaSeconds) }} {{ 'common.units.min' | translate }}</span
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
  private readonly translate = inject(TranslateService);

  readonly stores = signal<StoreListItem[]>([]);

  readonly storeMarkers = computed<MapMarker[]>(() =>
    this.stores().map((s) => ({ id: s.id, lat: s.latitude, lng: s.longitude, label: s.name, kind: 'store' })),
  );

  ngOnInit(): void {
    this.catalog.listStores().subscribe({ next: (s) => this.stores.set(s) });
  }

  minutes(seconds: number): number {
    return Math.max(1, Math.round(seconds / 60));
  }

  distanceLabel(meters: number): string {
    if (meters < 1000) return `${Math.round(meters)} ${this.translate.instant('common.units.mShort')}`;
    return `${(meters / 1000).toFixed(1)} ${this.translate.instant('common.units.kmShort')}`;
  }

  /** Returns a translation key — resolved via | translate in the template. */
  statusLabel(status: StoreListItem['status']): string {
    if (status === 'OPEN') return 'web.stores.status.OPEN';
    if (status === 'OVERLOADED') return 'web.stores.status.OVERLOADED';
    return 'web.stores.status.CLOSED';
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
