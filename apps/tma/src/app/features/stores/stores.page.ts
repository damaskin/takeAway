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
import {
  LeafletMapComponent,
  STORE_KIND_GLYPHS,
  StoreLogoComponent,
  type LatLng,
  type MapMarker,
} from '@takeaway/ui-kit';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService, storeHoursText } from '@takeaway/i18n';

import { CatalogService } from '../../core/catalog/catalog.service';
import { refreshStoresWhileVisible } from '../../core/catalog/live-store-refresh';
import { hasLocation, sortStoresByDistance, storeAddress, storeMatchesQuery } from '../../core/catalog/store-place';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';
import { TmaTabBarComponent } from '../../shared/tab-bar.component';

/** What went wrong with «Рядом со мной», as a translation key. */
type LocationNote =
  | 'tma.stores.locationDenied'
  | 'tma.stores.locationDeniedSettings'
  | 'tma.stores.locationUnavailable';

const KIND_LABELS: Record<StoreKindFilter, string> = {
  ALL: 'common.storeKinds.all',
  COFFEE: 'common.storeKinds.coffee',
  FOOD: 'common.storeKinds.food',
};

/**
 * TMA Store Selector — pencil POOLf.
 *
 * Body (gap 16):
 *   searchBar (44px, foam) — narrows the map and the list by name or address
 *   mapFrame  (160px) — a tap on a pin selects that store's card below and
 *             scrolls it into view
 *   "Nearby" section label + «Рядом со мной»: where the customer is (Telegram's
 *             LocationManager, else the browser), then the stores by distance
 *             with the customer's own dot on the map
 *   store cards — caramel 2px stroke on the selected one, foam otherwise
 *
 * Closed stores (switched off, or nothing bookable in the next 24 hours)
 * come last, dimmed, and do not open: there is nothing to order there. A
 * store closed for an order now but taking pre-orders (overnight, before the
 * shift) opens as usual and says when it opens instead of the wait. The list
 * refreshes itself while on screen, so a store that starts its shift lights
 * up without a reload.
 *
 * The pins show what each place sells (cup, fork and knife, or both); the
 * «Все / Кофе / Еда» chips above the map narrow the map and the list.
 */
@Component({
  selector: 'app-tma-stores',
  standalone: true,
  imports: [RouterLink, TmaTabBarComponent, TranslatePipe, LeafletMapComponent, StoreLogoComponent],
  template: `
    <section
      style="padding: 16px; padding-bottom: var(--tma-tab-page-bottom); display: flex; flex-direction: column; gap: 16px"
    >
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
          data-testid="store-search"
          enterkeyhint="search"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
          [placeholder]="'tma.stores.search' | translate"
          [attr.aria-label]="'common.search' | translate"
          class="flex-1 outline-none bg-transparent"
          style="min-width: 0; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
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

      <!-- Map: a tap on a pin picks that store below -->
      @if (storeMarkers().length > 0) {
        <div style="height: 160px; border-radius: 16px; overflow: hidden">
          <lib-leaflet-map
            [markers]="storeMarkers()"
            [userPosition]="userPosition()"
            (markerClicked)="selectFromMap($event)"
          />
        </div>
      }

      <div class="flex items-center justify-between" style="gap: 12px; margin-top: 4px">
        <span style="font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--color-espresso)">{{
          'tma.stores.nearby' | translate
        }}</span>
        <button
          type="button"
          data-testid="near-me"
          (click)="locate()"
          [disabled]="locating()"
          [attr.aria-pressed]="userPosition() !== null"
          class="flex items-center"
          [style.opacity]="locating() ? 0.6 : 1"
          style="gap: 6px; height: 34px; padding: 0 14px; border-radius: 9999px; background: var(--color-caramel); color: white; font-family: var(--font-sans); font-size: 13px; font-weight: 600; white-space: nowrap"
        >
          <span aria-hidden="true">📍</span>
          {{ (locating() ? 'tma.stores.locating' : 'tma.stores.nearMe') | translate }}
        </button>
      </div>
      @if (locationNote(); as note) {
        <div
          role="status"
          data-testid="location-note"
          class="flex items-center flex-wrap"
          style="gap: 8px 12px; padding: 10px 14px; border-radius: 12px; background: var(--color-foam); border: 1px solid var(--color-border-light); font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
        >
          <span class="flex-1" style="min-width: 180px">{{ note | translate }}</span>
          @if (note === 'tma.stores.locationDeniedSettings') {
            <button
              type="button"
              (click)="openLocationSettings()"
              style="font-size: 13px; font-weight: 600; color: var(--color-caramel)"
            >
              {{ 'tma.stores.openSettings' | translate }}
            </button>
          }
        </div>
      }

      <div class="flex flex-col" style="gap: 12px">
        @for (s of visibleStores(); track s.id) {
          <a
            [routerLink]="inactive(s) ? null : ['/stores', s.slug]"
            [attr.id]="'tma-store-' + s.id"
            [attr.data-selected]="selectedId() === s.id || null"
            class="flex flex-col"
            [style.border]="
              selectedId() === s.id && !inactive(s)
                ? '2px solid var(--color-caramel)'
                : '1px solid var(--color-border-light)'
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
            @if (address(s); as line) {
              <p style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary); margin: 0">
                {{ line }}
              </p>
            }
            <div class="flex items-center flex-wrap" style="gap: 4px 14px">
              @if (preorderOnly(s)) {
                <span
                  data-testid="store-hours"
                  style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
                  >🕘 {{ hoursLine(s) }}</span
                >
              } @else {
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
                  >⏱ {{ minutes(s.currentEtaSeconds) }} {{ 'common.units.min' | translate }}
                  @if (hoursLine(s); as until) {
                    · {{ until }}
                  }
                </span>
              }
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
  private readonly translate = inject(TranslateService);
  private readonly tg = inject(TelegramBridgeService);

  readonly stores = signal<StoreListItem[]>([]);
  readonly kind = signal<StoreKindFilter>('ALL');
  readonly kinds: StoreKindFilter[] = ['ALL', 'COFFEE', 'FOOD'];
  /** What the customer typed into the search bar. */
  readonly query = signal('');
  /** Where the customer is, once they shared it: the stores come by distance and the map shows a dot. */
  readonly userPosition = signal<LatLng | null>(null);
  readonly locating = signal(false);
  readonly locationNote = signal<LocationNote | null>(null);
  /** The store picked on the map. */
  private readonly pickedId = signal<string | null>(null);

  constructor() {
    refreshStoresWhileVisible(() => this.load());
  }

  /** The stores under the chosen chip that match the search. */
  readonly visibleStores = computed(() =>
    this.stores().filter((s) => storeMatchesKind(s, this.kind()) && storeMatchesQuery(s, this.query())),
  );

  /** The highlighted card: the one picked on the map while it is listed, else the first that takes orders. */
  readonly selectedId = computed(() => {
    const visible = this.visibleStores();
    const picked = this.pickedId();
    if (picked && visible.some((s) => s.id === picked)) return picked;
    return visible.find((s) => !this.inactive(s))?.id ?? null;
  });

  /** Stores without a pin yet stay in the list but off the map. */
  readonly storeMarkers = computed<MapMarker[]>(() =>
    this.visibleStores()
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

  ngOnInit(): void {
    this.load();
  }

  /** The list, from where the customer is once they have shared it. */
  private load(): void {
    this.catalog.listStores(this.userPosition() ?? {}).subscribe({
      next: (list) => this.stores.set(this.ordered(list)),
      error: () => undefined,
    });
  }

  /** Open ones first; nearest first once the customer's position is known. */
  private ordered(list: StoreListItem[]): StoreListItem[] {
    return sortStoresByAvailability(this.userPosition() ? sortStoresByDistance(list) : list);
  }

  /** A pin was tapped: that store's card lights up and comes into view. */
  selectFromMap(storeId: string): void {
    this.pickedId.set(storeId);
    this.tg.haptic('light');
    // After the highlight renders, so the scroll lands on the card as it now looks.
    setTimeout(() =>
      document.getElementById('tma-store-' + storeId)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
  }

  /**
   * «Рядом со мной»: asks Telegram (or the browser) where the customer is,
   * then lists the stores by distance from there, nearest first.
   */
  async locate(): Promise<void> {
    if (this.locating()) return;
    this.locating.set(true);
    this.locationNote.set(null);
    this.tg.haptic('light');
    const found = await this.tg.requestLocation();
    if (found.kind !== 'ok') {
      this.locating.set(false);
      this.locationNote.set(
        found.kind === 'unavailable'
          ? 'tma.stores.locationUnavailable'
          : found.canOpenSettings
            ? 'tma.stores.locationDeniedSettings'
            : 'tma.stores.locationDenied',
      );
      return;
    }
    const here = { lat: found.lat, lng: found.lng };
    this.userPosition.set(here);
    this.catalog.listStores(here).subscribe({
      next: (list) => {
        this.stores.set(this.ordered(list));
        // The nearest open store is the one to look at now.
        this.pickedId.set(null);
        this.locating.set(false);
      },
      error: () => this.locating.set(false),
    });
  }

  /** Telegram's settings for the bot, where location access is switched back on. */
  openLocationSettings(): void {
    this.tg.openLocationSettings();
  }

  address(store: StoreListItem): string {
    return storeAddress(store);
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

  /** Closed for an order now, open for a pre-order: the card says when it opens instead of the wait. */
  preorderOnly(store: StoreListItem): boolean {
    return storeAvailability(store) === 'scheduledOnly';
  }

  /** «Сейчас закрыто · откроется в 9:00 · можно заказать ко времени», or «до 21:00» while open. */
  hoursLine(store: StoreListItem): string | null {
    return storeHoursText(store, this.translate, this.fmt);
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
