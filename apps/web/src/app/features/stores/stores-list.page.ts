import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { StoreListItem } from '@takeaway/shared-types';
import { TranslatePipe } from '@ngx-translate/core';

import { CatalogService } from '../../core/catalog/catalog.service';

type Filter = 'ALL' | 'OPEN' | 'NEAR' | 'FAV';

const FILTER_LABELS: Record<Filter, string> = {
  ALL: 'web.stores.filters.all',
  OPEN: 'web.stores.filters.open',
  NEAR: 'web.stores.filters.near',
  FAV: 'web.stores.filters.fav',
};

const PIN_COLORS = ['var(--color-caramel)', '#7BC4A4', '#E9A84B', '#A39888', '#D94B5E'];

/**
 * Web Store Locator — pencil A11 (0BWUe).
 *
 * Layout:
 *   mapArea (fill, latte tint) — faux street grid + color-coded pins
 *   sidebar (480px, foam, 24px padding) — title + count, filter chips, store cards
 */
@Component({
  selector: 'app-stores-list',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <section class="flex" style="height: calc(100vh - 72px); overflow: hidden">
      <!-- Map area -->
      <div class="relative flex-1" style="background: var(--color-latte); overflow: hidden">
        <!-- Street grid pattern -->
        <div
          style="position: absolute; inset: 0; background-image:
            linear-gradient(180deg, rgba(213, 201, 181, 0.8) 1px, transparent 1px),
            linear-gradient(90deg, rgba(213, 201, 181, 0.8) 1px, transparent 1px);
            background-size: 180px 180px, 150px 150px; opacity: 0.7"
        ></div>

        <!-- Map top bar -->
        <div
          class="absolute flex items-center"
          style="top: 20px; left: 20px; right: 20px; height: 56px; padding: 0 20px; gap: 12px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px; box-shadow: var(--shadow-soft)"
        >
          <span style="color: var(--color-text-secondary); font-size: 18px">🔍</span>
          <input
            type="search"
            [placeholder]="'web.stores.searchPlaceholder' | translate"
            class="flex-1 outline-none bg-transparent"
            style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
          />
          <button
            type="button"
            class="flex items-center justify-center"
            style="height: 36px; padding: 0 16px; background: var(--color-caramel); color: white; border-radius: 10px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
          >
            {{ 'web.stores.useLocation' | translate }}
          </button>
        </div>

        <!-- Pins — positioned on a 960×700 virtual canvas -->
        @for (store of stores(); track store.id; let i = $index) {
          <button
            type="button"
            (click)="selectStore(store)"
            class="absolute flex items-center justify-center"
            [style.top.%]="pinPosition(i).y"
            [style.left.%]="pinPosition(i).x"
            [style.background]="pinColor(i)"
            [style.transform]="
              selectedId() === store.id ? 'translate(-50%, -100%) scale(1.15)' : 'translate(-50%, -100%)'
            "
            [style.boxShadow]="selectedId() === store.id ? '0 6px 16px rgba(0,0,0,0.25)' : 'var(--shadow-soft)'"
            style="width: 40px; height: 40px; border-radius: 9999px; color: white; font-size: 16px; transition: transform 150ms ease"
          >
            ☕
          </button>
        }
      </div>

      <!-- Sidebar -->
      <aside
        class="flex flex-col"
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
              <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
                {{ store.addressLine }}, {{ store.city }}
              </p>
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
})
export class StoresListPage implements OnInit {
  private readonly catalog = inject(CatalogService);

  readonly stores = signal<StoreListItem[]>([]);
  readonly filter = signal<Filter>('ALL');
  readonly selectedId = signal<string | null>(null);
  readonly filters: Filter[] = ['ALL', 'OPEN', 'NEAR', 'FAV'];

  readonly filteredStores = computed(() => {
    const list = this.stores();
    const f = this.filter();
    if (f === 'OPEN') return list.filter((s) => s.status === 'OPEN');
    if (f === 'NEAR') {
      return [...list].sort((a, b) => (a.currentEtaSeconds ?? 0) - (b.currentEtaSeconds ?? 0));
    }
    // FAV is a stub — show all until we have favorites wired up.
    return list;
  });

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

  selectStore(store: StoreListItem): void {
    this.selectedId.set(store.id);
  }

  filterLabel(f: Filter): string {
    return FILTER_LABELS[f];
  }

  etaMinutes(store: StoreListItem): number {
    return Math.max(1, Math.round(store.currentEtaSeconds / 60));
  }

  distanceLabel(meters: number): string {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  }

  pinColor(idx: number): string {
    return PIN_COLORS[idx % PIN_COLORS.length] ?? 'var(--color-caramel)';
  }

  /** Deterministic "map" coordinates so pins don't jump between renders. */
  pinPosition(idx: number): { x: number; y: number } {
    // Pseudo-random but stable spread across 15-85% of map width/height.
    const xs = [22, 44, 66, 34, 58, 78, 18, 52, 70, 28];
    const ys = [34, 20, 58, 70, 44, 26, 60, 72, 40, 54];
    return {
      x: xs[idx % xs.length] ?? 50,
      y: ys[idx % ys.length] ?? 50,
    };
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
