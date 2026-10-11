import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { StoreListItem } from '@takeaway/shared-types';
import {
  sortStoresByAvailability,
  storeAvailability,
  storeKinds,
  storeMatchesKind,
  type StoreKindFilter,
} from '@takeaway/utils';
import { LeafletMapComponent, STORE_KIND_GLYPHS, StoreLogoComponent, type MapMarker } from '@takeaway/ui-kit';
import { TranslatePipe } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';

import { CatalogService } from '../../core/catalog/catalog.service';
import { refreshStoresWhileVisible } from '../../core/catalog/live-store-refresh';
import { TmaTabBarComponent } from '../../shared/tab-bar.component';

const KIND_LABELS: Record<StoreKindFilter, string> = {
  ALL: 'common.storeKinds.all',
  COFFEE: 'common.storeKinds.coffee',
  FOOD: 'common.storeKinds.food',
};

/**
 * TMA Store Selector — pencil POOLf.
 *
 * Body (gap 16):
 *   searchBar (44px, foam)
 *   mapFrame  (160px, aerial photo)
 *   "Nearby" section label
 *   store cards — caramel 2px stroke on selected, foam otherwise
 *
 * Closed stores (no shift, or switched off) come last, dimmed, and do not
 * open: there is nothing to order there. The list refreshes itself while on
 * screen, so a store that starts its shift lights up without a reload.
 *
 * The pins show what each place sells (cup, fork and knife, or both); the
 * «Все / Кофе / Еда» chips above the map narrow the map and the list.
 */
@Component({
  selector: 'app-tma-stores',
  standalone: true,
  imports: [RouterLink, TmaTabBarComponent, TranslatePipe, LeafletMapComponent, StoreLogoComponent],
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

      <!-- What the places sell: the map's legend and filter in one -->
      <div class="flex" role="group" [attr.aria-label]="'common.storeKinds.label' | translate" style="gap: 8px">
        @for (k of kinds; track k) {
          <button
            type="button"
            (click)="kind.set(k)"
            [attr.aria-pressed]="kind() === k"
            [attr.data-kind]="k"
            class="flex items-center"
            [style.background]="kind() === k ? 'var(--color-caramel)' : 'var(--color-foam)'"
            [style.color]="kind() === k ? 'white' : 'var(--color-text-primary)'"
            style="gap: 6px; height: 34px; padding: 0 14px; border: 1px solid var(--color-border-light); border-radius: 9999px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
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
        @for (s of visibleStores(); track s.id; let i = $index) {
          <a
            [routerLink]="inactive(s) ? null : ['/stores', s.slug]"
            class="flex flex-col"
            [style.border]="
              i === 0 && !inactive(s) ? '2px solid var(--color-caramel)' : '1px solid var(--color-border-light)'
            "
            [style.opacity]="inactive(s) ? 0.55 : 1"
            [style.cursor]="inactive(s) ? 'default' : null"
            [attr.aria-disabled]="inactive(s) || null"
            [attr.data-inactive]="inactive(s) || null"
            style="background: var(--color-foam); border-radius: 16px; padding: 16px; gap: 8px"
          >
            <div class="flex items-center justify-between" style="gap: 10px">
              <span class="flex items-center" style="gap: 10px; min-width: 0">
                <lib-store-logo [photo]="s.heroImageUrl" [url]="s.logoUrl" [name]="s.brandName ?? s.name" [size]="40" />
                <span
                  style="font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--color-espresso)"
                  >{{ s.name }}</span
                >
              </span>
              <span
                [style.background]="statusBg(inactive(s) ? 'CLOSED' : s.status)"
                [style.color]="statusColor(inactive(s) ? 'CLOSED' : s.status)"
                style="padding: 3px 10px; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700"
                >{{ badge(s) | translate }}</span
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
        @if (stores().length > 0 && visibleStores().length === 0) {
          <p
            style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); text-align: center; padding: 32px 0; margin: 0"
          >
            {{ 'web.stores.empty' | translate }}
          </p>
        }
      </div>
    </section>

    <app-tma-tab-bar />
  `,
})
export class TmaStoresPage implements OnInit {
  private readonly catalog = inject(CatalogService);
  private readonly fmt = inject(LocaleFormatService);

  readonly stores = signal<StoreListItem[]>([]);
  readonly kind = signal<StoreKindFilter>('ALL');
  readonly kinds: StoreKindFilter[] = ['ALL', 'COFFEE', 'FOOD'];

  constructor() {
    refreshStoresWhileVisible(() => this.load());
  }

  /** The stores under the chosen chip. */
  readonly visibleStores = computed(() => this.stores().filter((s) => storeMatchesKind(s, this.kind())));

  readonly storeMarkers = computed<MapMarker[]>(() =>
    this.visibleStores().map((s) => ({
      id: s.id,
      lat: s.latitude,
      lng: s.longitude,
      label: s.name,
      kind: 'store',
      sells: storeKinds(s),
    })),
  );

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.catalog
      .listStores()
      .subscribe({ next: (s) => this.stores.set(sortStoresByAvailability(s)), error: () => undefined });
  }

  minutes(seconds: number): number {
    return Math.max(1, Math.round(seconds / 60));
  }

  kindLabel(k: StoreKindFilter): string {
    return KIND_LABELS[k];
  }

  /** The chip's glyph — the same one the pins draw; none for «Все». */
  glyph(k: StoreKindFilter): string | null {
    return k === 'ALL' ? null : STORE_KIND_GLYPHS[k];
  }

  distanceLabel(meters: number): string {
    return this.fmt.distance(meters);
  }

  inactive(store: StoreListItem): boolean {
    return storeAvailability(store) === 'closed';
  }

  /** Returns a translation key — resolved via | translate in the template. */
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
