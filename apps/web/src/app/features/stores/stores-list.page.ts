import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { StoreListItem } from '@takeaway/shared-types';
import {
  sortStoresByAvailability,
  storeAvailability,
  storeKinds,
  storeMatchesKind,
  type StoreKindFilter,
} from '@takeaway/utils';
import {
  LeafletMapComponent,
  STORE_KIND_GLYPHS,
  StoreLogoComponent,
  type LatLng,
  type MapMarker,
} from '@takeaway/ui-kit';
import { TranslatePipe } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';

import { CatalogService } from '../../core/catalog/catalog.service';
import { LastStoreService } from '../../core/catalog/last-store.service';
import { refreshStoresWhileVisible } from '../../core/catalog/live-store-refresh';
import { hasLocation, storeAddress } from '../../core/catalog/store-place';

type Filter = 'ALL' | 'OPEN' | 'NEAR';

const FILTER_LABELS: Record<Filter, string> = {
  ALL: 'web.stores.filters.all',
  OPEN: 'web.stores.filters.open',
  NEAR: 'web.stores.filters.near',
};

const KIND_LABELS: Record<StoreKindFilter, string> = {
  ALL: 'common.storeKinds.all',
  COFFEE: 'common.storeKinds.coffee',
  FOOD: 'common.storeKinds.food',
};

/**
 * Web Store Locator — pencil A11 (0BWUe).
 *
 * Layout:
 *   mapArea (fill) — Leaflet/OSM map with a marker per store
 *   sidebar (480px, foam, 24px padding) — title + count, filter chips, store cards
 *
 * Closed stores (no shift, or switched off) come last, dimmed, and do not
 * open — there is nothing to order there. The list refreshes itself while
 * the tab is in view, so a store that starts its shift lights up by itself.
 *
 * Also the page behind «Меню» (`/menu`, `intent: 'menu'`): the site is a
 * marketplace, so the menu starts with choosing a place. The store whose
 * menu the customer opened last is offered on top — «Продолжить в …» — with
 * the whole choice still below it.
 *
 * The pins show what each place sells (cup, fork and knife, or both), and
 * the «Все / Кофе / Еда» chips over the map narrow the map and the list.
 */
@Component({
  selector: 'app-stores-list',
  standalone: true,
  imports: [RouterLink, TranslatePipe, LeafletMapComponent, StoreLogoComponent],
  template: `
    <section class="stores-shell flex" style="height: calc(100vh - 72px); overflow: hidden">
      <!-- Map area -->
      <div class="stores-map relative flex-1" style="background: var(--color-latte); overflow: hidden">
        <lib-leaflet-map
          [markers]="storeMarkers()"
          [userPosition]="userPosition()"
          (markerClicked)="selectedId.set($event)"
        />

        <!-- What the places sell: the map's legend and filter in one -->
        <div
          class="stores-kinds absolute flex"
          role="group"
          [attr.aria-label]="'common.storeKinds.label' | translate"
          style="top: 88px; left: 20px; gap: 8px; z-index: 400; flex-wrap: wrap"
        >
          @for (k of kinds; track k) {
            <button
              type="button"
              (click)="kind.set(k)"
              [attr.aria-pressed]="kind() === k"
              [attr.data-kind]="k"
              class="flex items-center"
              [style.background]="kind() === k ? 'var(--color-caramel)' : 'var(--color-foam)'"
              [style.color]="kind() === k ? 'white' : 'var(--color-text-primary)'"
              style="gap: 6px; height: 34px; padding: 0 14px; border: 1px solid var(--color-border-light); border-radius: 9999px; box-shadow: var(--shadow-soft); font-family: var(--font-sans); font-size: 13px; font-weight: 600"
            >
              @if (glyph(k); as d) {
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="fill: currentColor">
                  <path [attr.d]="d" />
                </svg>
              }
              {{ kindLabel(k) | translate }}
            </button>
          }
        </div>

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
        <!-- The place the customer was at last time, one tap away -->
        @if (lastStore(); as last) {
          <a
            [routerLink]="['/stores', last.slug]"
            data-testid="continue-store"
            class="flex items-center"
            style="gap: 12px; padding: 14px 16px; background: var(--color-caramel); color: white; border-radius: 16px"
          >
            <lib-store-logo
              [photo]="last.heroImageUrl"
              [url]="last.logoUrl"
              [name]="last.brandName ?? last.name"
              [size]="40"
            />
            <span class="flex flex-col flex-1" style="gap: 2px; min-width: 0">
              <span class="truncate" style="font-family: var(--font-sans); font-size: 15px; font-weight: 600">{{
                'web.stores.continueIn' | translate: { store: last.name }
              }}</span>
              <span style="font-family: var(--font-sans); font-size: 12px; opacity: 0.85">{{
                'web.stores.continueHint' | translate
              }}</span>
            </span>
            <span aria-hidden="true" style="font-size: 18px">→</span>
          </a>
        }

        <!-- Head -->
        <header class="flex items-center justify-between">
          <h1
            style="font-family: var(--font-display); font-size: 24px; font-weight: 600; color: var(--color-espresso); margin: 0"
          >
            {{ (intent() === 'menu' ? 'web.stores.chooseTitle' : 'web.stores.title') | translate }}
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
              [routerLink]="inactive(store) ? null : ['/stores', store.slug]"
              (mouseenter)="inactive(store) || selectedId.set(store.id)"
              class="flex flex-col"
              [style.border]="
                selectedId() === store.id ? '2px solid var(--color-caramel)' : '1px solid var(--color-border-light)'
              "
              [style.opacity]="inactive(store) ? 0.55 : 1"
              [style.cursor]="inactive(store) ? 'default' : null"
              [attr.aria-disabled]="inactive(store) || null"
              [attr.data-inactive]="inactive(store) || null"
              style="background: var(--color-cream); border-radius: 16px; padding: 16px; gap: 10px"
            >
              <div class="flex items-center justify-between" style="gap: 12px">
                <span class="flex items-center" style="gap: 12px; min-width: 0">
                  <lib-store-logo
                    [photo]="store.heroImageUrl"
                    [url]="store.logoUrl"
                    [name]="store.brandName ?? store.name"
                    [size]="44"
                  />
                  <span
                    style="font-family: var(--font-sans); font-size: 16px; font-weight: 600; color: var(--color-espresso)"
                    >{{ store.name }}</span
                  >
                </span>
                <span
                  [style.background]="statusBg(inactive(store) ? 'CLOSED' : store.status)"
                  [style.color]="statusColor(inactive(store) ? 'CLOSED' : store.status)"
                  style="padding: 4px 10px; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 600"
                  >{{ badge(store) | translate }}</span
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
        /* The map is short on a phone: the chips sit at its foot, clear of the search bar. */
        .stores-kinds {
          top: auto !important;
          bottom: 12px;
          left: 16px !important;
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
  private readonly lastStoreSlug = inject(LastStoreService).slug;

  /** `menu` when opened from «Меню» (route data): the heading asks the customer to choose a place. */
  readonly intent = input<'menu' | 'stores'>('stores');

  readonly stores = signal<StoreListItem[]>([]);
  readonly filter = signal<Filter>('ALL');
  readonly kind = signal<StoreKindFilter>('ALL');
  readonly selectedId = signal<string | null>(null);
  readonly filters: Filter[] = ['ALL', 'OPEN', 'NEAR'];
  readonly kinds: StoreKindFilter[] = ['ALL', 'COFFEE', 'FOOD'];
  readonly query = signal('');
  readonly userPosition = signal<LatLng | null>(null);
  readonly locating = signal(false);

  /** The store whose menu the customer opened last, while it takes orders. */
  readonly lastStore = computed(() => {
    const slug = this.lastStoreSlug();
    const store = slug ? this.stores().find((s) => s.slug === slug) : undefined;
    return store && !this.inactive(store) ? store : null;
  });

  readonly filteredStores = computed(() => {
    const words = this.query().toLowerCase().split(/\s+/).filter(Boolean);
    const kind = this.kind();
    const list = this.stores().filter((s) => {
      const text = `${s.name} ${storeAddress(s)}`.toLowerCase();
      return words.every((w) => text.includes(w)) && storeMatchesKind(s, kind);
    });
    const f = this.filter();
    if (f === 'OPEN') return list.filter((s) => s.status === 'OPEN' && storeAvailability(s) !== 'closed');
    if (f === 'NEAR') {
      // By distance once the customer has shared where they are, by wait until then.
      return sortStoresByAvailability(
        [...list].sort(
          (a, b) =>
            (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity) ||
            (a.currentEtaSeconds ?? 0) - (b.currentEtaSeconds ?? 0),
        ),
      );
    }
    return sortStoresByAvailability(list);
  });

  /** Stores without a pin yet stay in the list but off the map. */
  readonly storeMarkers = computed<MapMarker[]>(() =>
    this.filteredStores()
      .filter(hasLocation)
      .map((s) => ({
        id: s.id,
        lat: s.latitude,
        lng: s.longitude,
        label: s.name,
        kind: 'store',
        sells: storeKinds(s),
      })),
  );

  constructor() {
    refreshStoresWhileVisible(() => this.load());
  }

  ngOnInit(): void {
    this.load();
  }

  /** The list, from where the customer is once they have shared it. */
  private load(): void {
    this.catalog.listStores(this.userPosition() ?? {}).subscribe({
      next: (list) => {
        this.stores.set(list);
        const selected = list.find((s) => s.id === this.selectedId());
        if (!selected || this.inactive(selected)) {
          this.selectedId.set(sortStoresByAvailability(list).find((s) => !this.inactive(s))?.id ?? null);
        }
      },
      error: () => undefined,
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

  kindLabel(k: StoreKindFilter): string {
    return KIND_LABELS[k];
  }

  /** The chip's glyph — the same one the pins draw; none for «Все». */
  glyph(k: StoreKindFilter): string | null {
    return k === 'ALL' ? null : STORE_KIND_GLYPHS[k];
  }

  etaMinutes(store: StoreListItem): number {
    return Math.max(1, Math.round(store.currentEtaSeconds / 60));
  }

  distanceLabel(meters: number): string {
    return this.fmt.distance(meters);
  }

  inactive(store: StoreListItem): boolean {
    return storeAvailability(store) === 'closed';
  }

  /** Returns a translation key; the template runs it through the translate pipe. */
  badge(store: StoreListItem): string {
    const availability = storeAvailability(store);
    if (availability === 'closed') return 'common.storeClosed.badge';
    if (availability === 'scheduledOnly') return 'common.storeLater.badge';
    return this.statusLabel(store.status);
  }

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
