import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { map, type Observable } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import {
  AdminCatalogApi,
  type AvailabilityIngredientDto,
  type AvailabilityProductDto,
  type AvailabilityStopDto,
  type StoreAdminDto,
  type StoreAvailabilityDto,
} from '../../core/catalog/admin-catalog.service';
import { KITCHEN_STORE_KEY, read } from '../../core/kitchen/kitchen-mode.service';
import { describeMenuError } from '../menu/menu-errors';
import { MENU_FORM_STYLES } from '../menu/menu-form.styles';
import { formatStoreTime, isStopActive, nextMidnightIn } from '../menu/stock';

type Tab = 'products' | 'addons';
type Until = 'manual' | 'endOfDay';

/** A row the page can switch: a product or an add-in, with its stop in this store. */
interface Row {
  id: string;
  name: string;
  /** Category for a product, "used in …" for an add-in. */
  detail: string;
  stop: AvailabilityStopDto | null;
  /** An add-in switched off for the whole brand — nothing to switch here. */
  brandOff: boolean;
}

/**
 * The stop-list of one store, for the people at the counter: every dish and
 * drink the store sells and every add-in it uses, each with one switch.
 * "In stop" takes it off sale in this store only — the site, the Telegram
 * app and the mobile app stop offering it, the cart refuses it — and the
 * same switch puts it back. Kitchen staff can do exactly this and nothing
 * more: creating, editing and deleting stays in the menu editor.
 * Laid out as one column of big rows so it works on the kitchen tablet and
 * on a phone.
 */
@Component({
  selector: 'app-stop-list',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  styles: [
    MENU_FORM_STYLES,
    `
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 14px;
        padding: 12px 14px;
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: 12px;
      }
      .row.out {
        border-left: 4px solid var(--color-berry);
      }
      .name {
        font-family: var(--font-sans);
        font-size: 15px;
        font-weight: 600;
        color: var(--color-text-primary);
        overflow-wrap: anywhere;
      }
      .switch {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-width: 132px;
        height: 40px;
        padding: 0 14px;
        margin-left: auto;
        border-radius: 9999px;
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        border: 1px solid transparent;
      }
      .switch.on {
        background: #7bc4a42e;
        color: #2f7d5b;
      }
      .switch.off {
        background: #d94b5e1a;
        color: var(--color-berry);
      }
      .switch:disabled {
        opacity: 0.5;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 9999px;
        background: currentColor;
      }
      .tab {
        height: 36px;
        padding: 0 14px;
        border-radius: 9999px;
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text-secondary);
        background: transparent;
        border: 1px solid var(--color-border-light);
      }
      .tab.active {
        background: var(--color-caramel-light);
        color: var(--color-caramel);
        border-color: transparent;
      }
      .group {
        margin: 8px 0 0;
        font-family: var(--font-sans);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: var(--color-text-tertiary);
      }
    `,
  ],
  template: `
    <div
      class="flex items-center flex-wrap"
      style="min-height: 64px; padding: 12px clamp(12px, 3vw, 24px); background: var(--color-foam); border-bottom: 1px solid var(--color-border-light); gap: 8px 16px"
    >
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'admin.stopList.title' | translate }}
      </h1>
      <a
        routerLink="/kitchen"
        [queryParams]="storeId() ? { store: storeId() } : {}"
        class="link"
        style="margin-left: auto; font-size: 13px; text-decoration: none"
        >{{ 'admin.stopList.backToKitchen' | translate }}</a
      >
    </div>

    <section
      class="flex flex-col"
      style="padding: clamp(16px, 3vw, 24px); gap: 14px; max-width: 880px"
      data-testid="stop-list"
    >
      <p class="hint" style="margin: 0; font-size: 13px; color: var(--color-text-secondary)">
        {{ 'admin.stopList.hint' | translate }}
      </p>

      <div class="flex items-end flex-wrap" style="gap: 10px 16px">
        @if (stores().length > 1) {
          <label class="field" style="flex: 1 1 200px">
            <span class="label">{{ 'admin.stopList.store' | translate }}</span>
            <select class="control" [value]="storeId()" (change)="pickStore($any($event.target).value)">
              @for (s of stores(); track s.id) {
                <option [value]="s.id" [selected]="s.id === storeId()">{{ s.name }}</option>
              }
            </select>
          </label>
        } @else if (stores().length === 1) {
          <div class="field" style="flex: 1 1 200px">
            <span class="label">{{ 'admin.stopList.store' | translate }}</span>
            <span class="name">{{ stores()[0]?.name }}</span>
          </div>
        }
        <label class="field" style="flex: 0 1 200px">
          <span class="label">{{ 'admin.stopList.until' | translate }}</span>
          <select class="control" [value]="until()" (change)="pickUntil($any($event.target).value)">
            <option value="manual">{{ 'admin.menu.stock.untilManual' | translate }}</option>
            <option value="endOfDay">{{ 'admin.menu.stock.untilEndOfDay' | translate }}</option>
          </select>
        </label>
      </div>

      <div class="flex items-center flex-wrap" style="gap: 8px">
        <button type="button" class="tab" [class.active]="tab() === 'products'" (click)="tab.set('products')">
          {{ 'admin.stopList.tabs.products' | translate: { count: productRows().length } }}
        </button>
        <button type="button" class="tab" [class.active]="tab() === 'addons'" (click)="tab.set('addons')">
          {{ 'admin.stopList.tabs.addons' | translate: { count: addonRows().length } }}
        </button>
        <label class="check" style="margin-left: 4px">
          <input type="checkbox" [checked]="onlyStopped()" (change)="onlyStopped.set($any($event.target).checked)" />
          <span>{{ 'admin.stopList.onlyStopped' | translate: { count: stoppedCount() } }}</span>
        </label>
        <input
          class="control small"
          style="flex: 1 1 180px; max-width: 280px; margin-left: auto"
          type="search"
          enterkeyhint="search"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
          [placeholder]="'admin.stopList.search' | translate"
          [attr.aria-label]="'admin.stopList.search' | translate"
        />
      </div>

      @if (error()) {
        <p role="alert" class="error" style="margin: 0; font-size: 13px">{{ error() }}</p>
      }
      @if (loaded() && stores().length === 0) {
        <p class="hint" style="margin: 0">{{ 'admin.stopList.noStores' | translate }}</p>
      }
      @if (loading() && !view()) {
        <p class="hint" style="margin: 0">{{ 'common.loading' | translate }}</p>
      }

      <div class="flex flex-col" style="gap: 8px">
        @for (row of shown(); track row.id; let i = $index) {
          @if (tab() === 'products' && row.detail !== shown()[i - 1]?.detail) {
            <h2 class="group">{{ row.detail }}</h2>
          }
          <div class="row" [class.out]="stopped(row)" data-testid="stop-row">
            <div class="flex flex-col" style="gap: 2px; flex: 1 1 200px; min-width: 0">
              <span class="name">{{ row.name }}</span>
              @if (tab() === 'addons') {
                <span class="hint">{{ row.detail }}</span>
              }
              @if (row.brandOff) {
                <span class="error">{{ 'admin.stopList.brandOff' | translate }}</span>
              }
            </div>
            <button
              type="button"
              class="switch"
              [class.on]="!stopped(row)"
              [class.off]="stopped(row)"
              role="switch"
              [attr.aria-checked]="!stopped(row)"
              [attr.aria-label]="row.name"
              [disabled]="pending().has(row.id) || row.brandOff"
              (click)="toggle(row)"
              data-testid="stop-toggle"
            >
              <span class="dot"></span>
              {{ status(row) }}
            </button>
          </div>
        } @empty {
          @if (view()) {
            <p class="hint" style="margin: 0">
              {{ (rows().length === 0 ? emptyKey() : 'admin.stopList.nothingFound') | translate }}
            </p>
          }
        }
      </div>
    </section>
  `,
})
export class StopListPage {
  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly stores = signal<StoreAdminDto[]>([]);
  readonly storeId = signal<string | null>(null);
  readonly view = signal<StoreAvailabilityDto | null>(null);
  readonly loaded = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly pending = signal<ReadonlySet<string>>(new Set());
  readonly tab = signal<Tab>('products');
  readonly until = signal<Until>('manual');
  readonly query = signal('');
  readonly onlyStopped = signal(false);

  readonly productRows = computed<Row[]>(() =>
    (this.view()?.products ?? []).map((p: AvailabilityProductDto) => ({
      id: p.id,
      name: p.name,
      detail: p.categoryName,
      stop: p.stop,
      brandOff: false,
    })),
  );
  readonly addonRows = computed<Row[]>(() =>
    (this.view()?.ingredients ?? []).map((i: AvailabilityIngredientDto) => ({
      id: i.id,
      name: i.name,
      detail: this.translate.instant('admin.stopList.usedIn', { products: i.productNames.join(', ') }),
      stop: i.stop,
      brandOff: !i.isAvailable,
    })),
  );
  readonly rows = computed(() => (this.tab() === 'products' ? this.productRows() : this.addonRows()));
  readonly stoppedCount = computed(() => this.rows().filter((r) => this.stopped(r)).length);
  readonly shown = computed(() => {
    const q = this.query().trim().toLocaleLowerCase();
    return this.rows().filter(
      (r) => (!this.onlyStopped() || this.stopped(r)) && (!q || r.name.toLocaleLowerCase().includes(q)),
    );
  });
  readonly emptyKey = computed(() =>
    this.tab() === 'products' ? 'admin.stopList.emptyProducts' : 'admin.stopList.emptyAddons',
  );

  constructor() {
    if (!this.activeBrand.loaded()) this.activeBrand.refresh();

    effect(() => {
      const brandId = this.activeBrand.activeId();
      untracked(() => this.loadStores(brandId));
    });
    effect(() => {
      const storeId = this.storeId();
      untracked(() => this.load(storeId));
    });
  }

  pickStore(id: string): void {
    if (!this.stores().some((s) => s.id === id)) return;
    this.storeId.set(id);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { store: id }, replaceUrl: true });
  }

  pickUntil(value: string): void {
    this.until.set(value === 'endOfDay' ? 'endOfDay' : 'manual');
  }

  stopped(row: Row): boolean {
    return row.stop !== null && isStopActive(row.stop);
  }

  status(row: Row): string {
    if (!this.stopped(row)) return this.translate.instant('admin.stopList.onSale');
    const expiresAt = row.stop?.expiresAt;
    if (!expiresAt) return this.translate.instant('admin.stopList.stopped');
    const time = formatStoreTime(expiresAt, this.view()?.timezone, this.translate.getCurrentLang() || 'ru');
    return this.translate.instant('admin.stopList.stoppedUntil', { time });
  }

  toggle(row: Row): void {
    const view = this.view();
    if (!view || this.pending().has(row.id)) return;
    const storeId = view.storeId;
    const stop = !this.stopped(row);
    const expiresAt = stop && this.until() === 'endOfDay' ? nextMidnightIn(view.timezone).toISOString() : undefined;
    const kind = this.tab();

    let request: Observable<AvailabilityStopDto | null>;
    if (kind === 'products') {
      request = stop
        ? this.api
            .addStopListEntry(storeId, { productId: row.id, ...(expiresAt ? { expiresAt } : {}) })
            .pipe(map((entry) => ({ expiresAt: entry.expiresAt })))
        : this.api.removeStopListEntry(storeId, row.id).pipe(map(() => null));
    } else {
      request = stop
        ? this.api.stopIngredientInStore(storeId, row.id, expiresAt).pipe(map((s) => ({ expiresAt: s.expiresAt })))
        : this.api.resumeIngredientInStore(storeId, row.id).pipe(map(() => null));
    }

    this.setPending(row.id, true);
    this.error.set(null);
    request.subscribe({
      next: (next) => {
        this.setPending(row.id, false);
        this.patch(kind, row.id, next);
      },
      error: (err: unknown) => {
        this.setPending(row.id, false);
        // Nothing to lift: someone already put it back on sale.
        if (!stop && (err as { status?: number }).status === 404) {
          this.patch(kind, row.id, null);
          return;
        }
        this.error.set(describeMenuError(err, this.translate));
      },
    });
  }

  private patch(kind: Tab, id: string, stop: AvailabilityStopDto | null): void {
    this.view.update((view) => {
      if (!view) return view;
      return kind === 'products'
        ? { ...view, products: view.products.map((p) => (p.id === id ? { ...p, stop } : p)) }
        : { ...view, ingredients: view.ingredients.map((i) => (i.id === id ? { ...i, stop } : i)) };
    });
  }

  private setPending(id: string, on: boolean): void {
    this.pending.update((set) => {
      const next = new Set(set);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /**
   * The stores this account works at — the API narrows the list to them for
   * staff and managers. The one the kitchen board is on comes first.
   */
  private loadStores(brandId: string | null): void {
    this.api.listStores(brandId ?? undefined).subscribe({
      next: (stores) => {
        this.stores.set(stores);
        this.loaded.set(true);
        const wanted = [this.route.snapshot.queryParamMap.get('store'), this.storeId(), read(KITCHEN_STORE_KEY)];
        const start = wanted.map((id) => stores.find((s) => s.id === id)).find(Boolean) ?? stores[0] ?? null;
        this.storeId.set(start?.id ?? null);
      },
      error: (err: unknown) => {
        this.loaded.set(true);
        this.error.set(describeMenuError(err, this.translate));
      },
    });
  }

  private load(storeId: string | null): void {
    this.view.set(null);
    if (!storeId) return;
    this.loading.set(true);
    this.api.getStoreAvailability(storeId).subscribe({
      next: (view) => {
        this.loading.set(false);
        if (this.storeId() === storeId) this.view.set(view);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(describeMenuError(err, this.translate));
      },
    });
  }
}
