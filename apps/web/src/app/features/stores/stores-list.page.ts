import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { StoreListItem } from '@takeaway/shared-types';
import { LeafletMapComponent, type LatLng, type MapMarker } from '@takeaway/ui-kit';
import { TranslatePipe } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';

import { CatalogService } from '../../core/catalog/catalog.service';
import { hasLocation, storeAddress } from '../../core/catalog/store-place';

type Filter = 'ALL' | 'OPEN' | 'NEAR';

const FILTER_LABELS: Record<Filter, string> = {
  ALL: 'web.stores.filters.all',
  OPEN: 'web.stores.filters.open',
  NEAR: 'web.stores.filters.near',
};

/**
 * Web Store Locator — pencil A11 (0BWUe).
 *
 * Layout:
 *   mapArea (fill) — Leaflet/OSM map with a marker per store
 *   sidebar (480px, foam, 24px padding) — title + count, filter chips, store cards
 */
@Component({
  selector: 'app-stores-list',
  standalone: true,
  imports: [RouterLink, TranslatePipe, LeafletMapComponent],
  template: `
    <section class="stores-shell flex" style="height: calc(100vh - 72px); overflow: hidden">
      <!-- Map area -->
      <div class="stores-map relative flex-1" style="background: var(--color-latte); overflow: hidden">
        <lib-leaflet-map
          [markers]="storeMarkers()"
          [userPosition]="userPosition()"
          (markerClicked)="selectedId.set($event)"
        />

        <!-- Map top bar (overlay) -->
        <div
          class="absolute flex items-center"
          style="top: 20px; left: 20px; right: 20px; height: 56px; padding: 0 20px; gap: 12px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px; box-shadow: var(--shadow-soft); z-index: 400"
        >
          <span style="color: var(--color-text-secondary); font-size: 18px">🔍</span>
          <input
            #search
            type="search"
            [value]="query()"
            (input)="query.set(search.value)"
            [placeholder]="'web.stores.searchPlaceholder' | translate"
            class="flex-1 min-w-0 outline-none bg-transparent"
            style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
          />
          <button
            type="button"
            (click)="locate()"
            [disabled]="locating()"
            class="flex items-center justify-center disabled:opacity-60"
            style="height: 36px; padding: 0 16px; background: var(--color-caramel); color: white; border-radius: 10px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
          >
            {{ 'web.stores.useLocation' | translate }}
          </button>
        </div>
      </div>

      <!-- Sidebar -->
      <aside
        class="stores-sidebar flex flex-col"
        style="width: 480px; background: var(--color-foam); border-left: 1px solid var(--color-border-light); padding: 24px; gap: 20px; overflow-y: auto"
      >
        <!-- Head -->
        <header class="flex items-center justify-between">
          <h1
            style="font-family: var(--font-display); font-size: 24px; font-weight: 600; color: var(--color-espresso); margin: 0"
          >
            {{ 'web.stores.title' | translate }}
          </h1>
          <span style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)">{{
            'web.stores.found' | translate: { count: filteredStores().length }
          }}</span>
        </header>

        <!-- Filters -->
        <div class="flex flex-wrap" style="gap: 8px">
          @for (f of filters; track f) {
            <button
              type="button"
              (click)="setFilter(f)"
              [style.background]="filter() === f ? 'var(--color-caramel)' : 'var(--color-cream)'"
              [style.color]="filter() === f ? 'white' : 'var(--color-text-primary)'"
              [style.border]="filter() === f ? '1px solid transparent' : '1px solid var(--color-border)'"
              style="padding: 8px 16px; border-radius: 9999px; font-family: var(--font-sans); font-size: 13px; font-weight: 500"
            >
              {{ filterLabel(f) | translate }}
            </button>
          }
        </div>

        <!-- Store list -->
        <div class="flex flex-col" style="gap: 12px">
          @for (store of filteredStores(); track store.id) {
            <a
              [routerLink]="['/stores', store.slug]"
              (mouseenter)="selectedId.set(store.id)"
              class="flex flex-col"
              [style.border]="
                selectedId() === store.id ? '2px solid var(--color-caramel)' : '1px solid var(--color-border-light)'
              "
              style="background: var(--color-cream); border-radius: 16px; padding: 16px; gap: 10px"
            >
              <div class="flex items-center justify-between">
                <span
                  style="font-family: var(--font-sans); font-size: 16px; font-weight: 600; color: var(--color-espresso)"
                  >{{ store.name }}</span
                >
                <span
                  [style.background]="statusBg(store.status)"
                  [style.color]="statusColor(store.status)"
                  style="padding: 4px 10px; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 600"
                  >{{ statusLabel(store.status) | translate }}</span
                >
              </div>
              @if (address(store); as a) {
                <p
                  style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0"
                >
                  {{ a }}
                </p>
              }
              <div class="flex items-center" style="gap: 16px">
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
                  >⏱ {{ 'common.readyIn' | translate: { min: etaMinutes(store) } }}</span
                >
                @if (store.distanceMeters !== null) {
                  <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
                    >🚶 {{ distanceLabel(store.distanceMeters) }}</span
                  >
                }
              </div>
              @if (selectedId() === store.id) {
                <button
                  type="button"
                  class="flex items-center justify-center"
                  style="height: 36px; background: var(--color-caramel); color: white; border-radius: 10px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
                >
                  {{ 'web.stores.orderHere' | translate }}
                </button>
              }
            </a>
          }
          @if (filteredStores().length === 0) {
            <p
              style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); text-align: center; padding: 40px 0"
            >
              {{ 'web.stores.empty' | translate }}
            </p>
          }
        </div>
      </aside>
    </section>
  `,
  styles: [
    `
      @media (max-width: 900px) {
        .stores-shell {
          flex-direction: column;
          height: auto;
          min-height: calc(100vh - 72px);
        }
        .stores-map {
          flex: 0 0 240px !important;
          min-height: 240px;
        }
        .stores-sidebar {
          width: 100% !important;
          border-left: none !important;
          border-top: 1px solid var(--color-border-light);
          padding: 16px !important;
        }
      }
    `,
  ],
})
export class StoresListPage implements OnInit {
  private readonly catalog = inject(CatalogService);
  private readonly fmt = inject(LocaleFormatService);

  readonly stores = signal<StoreListItem[]>([]);
  readonly filter = signal<Filter>('ALL');
  readonly selectedId = signal<string | null>(null);
  readonly filters: Filter[] = ['ALL', 'OPEN', 'NEAR'];
  readonly query = signal('');
  readonly userPosition = signal<LatLng | null>(null);
  readonly locating = signal(false);

  readonly filteredStores = computed(() => {
    const words = this.query().toLowerCase().split(/s+/).filter(Boolean);
    const list = this.stores().filter((s) => {
      const text = `${s.name} ${storeAddress(s)}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    const f = this.filter();
    if (f === 'OPEN') return list.filter((s) => s.status === 'OPEN');
    if (f === 'NEAR') {
      // By distance once the customer has shared where they are, by wait until then.
      return [...list].sort(
        (a, b) =>
          (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity) ||
          (a.currentEtaSeconds ?? 0) - (b.currentEtaSeconds ?? 0),
      );
    }
    return list;
  });

  /** Stores without a pin yet stay in the list but off the map. */
  readonly storeMarkers = computed<MapMarker[]>(() =>
    this.filteredStores()
      .filter(hasLocation)
      .map((s) => ({ id: s.id, lat: s.latitude, lng: s.longitude, label: s.name, kind: 'store' })),
  );

  ngOnInit(): void {
    this.catalog.listStores().subscribe({
      next: (list) => {
        this.stores.set(list);
        const first = list[0];
        if (first) this.selectedId.set(first.id);
      },
    });
  }

  setFilter(f: Filter): void {
    this.filter.set(f);
  }

  address(store: StoreListItem): string {
    return storeAddress(store);
  }

  /** Asks the browser where the customer is, then lists the stores by distance from there. */
  locate(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    this.locating.set(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        this.userPosition.set(here);
        this.catalog.listStores(here).subscribe({
          next: (list) => {
            this.stores.set(list);
            this.filter.set('NEAR');
            this.locating.set(false);
          },
          error: () => this.locating.set(false),
        });
      },
      () => this.locating.set(false),
      { timeout: 10_000, maximumAge: 300_000 },
    );
  }

  filterLabel(f: Filter): string {
    return FILTER_LABELS[f];
  }

  etaMinutes(store: StoreListItem): number {
    return Math.max(1, Math.round(store.currentEtaSeconds / 60));
  }

  distanceLabel(meters: number): string {
    return this.fmt.distance(meters);
  }

  /** Returns a translation key; the template runs it through the translate pipe. */
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
