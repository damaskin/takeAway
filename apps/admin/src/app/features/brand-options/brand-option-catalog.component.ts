import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import {
  type BrandOptionCatalog,
  type BrandOptionSetting,
  type CatalogGroup,
  type CatalogOption,
  OPTION_GROUP_KINDS,
} from '@takeaway/shared-types';
import type { Observable } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { groupsOfKind, settingFor, settingsById, sortCatalog } from '../../core/catalog/option-catalog';
import { type BrandOptionChange, OptionCatalogApi } from '../../core/catalog/option-catalog.service';
import { type AdminRole, canAccess } from '../../core/permissions/permissions';
import { MENU_FORM_STYLES } from '../menu/menu-form.styles';
import { formatMoneyInput, parseMoney } from '../menu/menu-input';
import { formatStoreTime, nextMidnightIn } from '../menu/stock';
import { describeOptionError } from '../option-catalog/option-errors';

type Filter = 'all' | 'on' | 'off';
type Until = 'manual' | 'endOfDay';

interface GroupView {
  group: CatalogGroup;
  /** The options shown under the current filter and search. */
  options: CatalogOption[];
  on: number;
  stopped: number;
}

/**
 * The options catalog as one brand has it (`GET /admin/brands/:id/options`):
 * every group of the platform's catalog with its options. Per option the
 * brand says whether it has it («Есть у нас» — off hides it from its
 * customers and its product editor), prices an add-on once for the whole
 * brand (a variant's price lives on each product), and — for those who run
 * the stop-list — stops it in one of its stores, for the same durations as
 * the stop-list: until put back, or until the store's midnight.
 *
 * Groups fold: the catalog runs to a couple of hundred options. A search
 * opens every group that matches.
 */
@Component({
  selector: 'app-brand-option-catalog',
  standalone: true,
  imports: [TranslatePipe],
  styles: [
    MENU_FORM_STYLES,
    `
      .group {
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: 12px;
      }
      .group > summary {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 4px 10px;
        padding: 12px 14px;
        cursor: pointer;
        font-family: var(--font-sans);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 14px;
        padding: 10px 14px;
        border-top: 1px solid var(--color-border-light);
      }
      .row.off .name {
        color: var(--color-text-tertiary);
      }
      .name {
        font-family: var(--font-sans);
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        overflow-wrap: anywhere;
      }
      .switch,
      .stop {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        padding: 0 12px;
        border-radius: 9999px;
        font-family: var(--font-sans);
        font-size: 12px;
        font-weight: 600;
        border: 1px solid transparent;
        background: #7bc4a42e;
        color: #2f7d5b;
      }
      .switch.off,
      .stop.out {
        background: #d94b5e1a;
        color: var(--color-berry);
      }
      .switch:disabled,
      .stop:disabled {
        opacity: 0.5;
      }
      .tab {
        height: 32px;
        padding: 0 12px;
        border-radius: 9999px;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-secondary);
        background: transparent;
        border: 1px solid var(--color-border-light);
      }
      .tab.active {
        background: var(--color-caramel-light);
        color: var(--color-caramel);
        border-color: transparent;
      }
    `,
  ],
  template: `
    <div class="flex flex-col" style="gap: 14px" data-testid="brand-option-catalog">
      <p class="hint" style="margin: 0; font-size: 13px; color: var(--color-text-secondary)">
        {{ 'admin.optionsCatalog.brand.hint' | translate }}
      </p>

      <div class="flex items-center flex-wrap" style="gap: 8px">
        <button type="button" class="tab" [class.active]="filter() === 'all'" (click)="filter.set('all')">
          {{ 'admin.optionsCatalog.brand.filterAll' | translate: { count: counts().all } }}
        </button>
        <button type="button" class="tab" [class.active]="filter() === 'on'" (click)="filter.set('on')">
          {{ 'admin.optionsCatalog.brand.filterOn' | translate: { count: counts().on } }}
        </button>
        <button type="button" class="tab" [class.active]="filter() === 'off'" (click)="filter.set('off')">
          {{ 'admin.optionsCatalog.brand.filterOff' | translate: { count: counts().off } }}
        </button>
        <input
          class="control small"
          style="flex: 1 1 180px; max-width: 280px; margin-left: auto"
          type="search"
          enterkeyhint="search"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
          [placeholder]="'admin.optionsCatalog.brand.search' | translate"
          [attr.aria-label]="'admin.optionsCatalog.brand.search' | translate"
        />
      </div>
      @if (canStop() && stores().length > 0) {
        <label class="field" style="align-self: flex-start; width: 220px; max-width: 100%">
          <span class="label">{{ 'admin.optionsCatalog.brand.stopUntil' | translate }}</span>
          <select class="control small" [value]="until()" (change)="pickUntil($any($event.target).value)">
            <option value="manual">{{ 'admin.menu.stock.untilManual' | translate }}</option>
            <option value="endOfDay">{{ 'admin.menu.stock.untilEndOfDay' | translate }}</option>
          </select>
        </label>
      }

      @if (error(); as message) {
        <p role="alert" class="error" style="margin: 0; font-size: 13px" data-testid="brand-options-error">
          {{ message }}
        </p>
      }
      @if (loading() && !catalog()) {
        <p class="hint" style="margin: 0">{{ 'common.loading' | translate }}</p>
      }

      @for (section of sections(); track section.kind) {
        @if (section.groups.length > 0) {
          <h2 style="margin: 4px 0 0; font-family: var(--font-display); font-size: 18px; color: var(--color-espresso)">
            {{ 'admin.optionsCatalog.kindsPlural.' + section.kind | translate }}
          </h2>
          @for (view of section.groups; track view.group.id) {
            <details
              class="group"
              [open]="isOpen(view.group.id)"
              (toggle)="onToggle(view.group.id, $event)"
              data-testid="brand-option-group"
            >
              <summary>
                <span class="name">{{ view.group.name }}</span>
                <span class="hint">
                  {{ 'admin.optionsCatalog.types.' + view.group.type | translate }} ·
                  {{
                    'admin.optionsCatalog.brand.groupCount'
                      | translate: { on: view.on, total: view.group.options.length }
                  }}
                  @if (view.stopped > 0) {
                    · {{ 'admin.optionsCatalog.brand.groupStopped' | translate: { count: view.stopped } }}
                  }
                </span>
              </summary>
              @for (o of view.options; track o.id) {
                @let s = setting(o.id);
                <div class="row" [class.off]="!s.enabled" data-testid="brand-option-row">
                  <div class="flex flex-col" style="gap: 2px; flex: 1 1 180px; min-width: 0">
                    <span class="name">{{ o.name }}</span>
                    @if (o.note) {
                      <span class="hint">{{ o.note }}</span>
                    }
                  </div>
                  @if (view.group.kind === 'ADDON') {
                    <label class="field" style="flex: 0 1 170px">
                      <span class="label">{{ priceLabel(view.group, o) }}</span>
                      <input
                        class="control small"
                        inputmode="decimal"
                        autocomplete="off"
                        placeholder="0"
                        [value]="priceText(s.priceCents)"
                        [disabled]="pending().has(o.id)"
                        (change)="savePrice(o, $event)"
                        (keydown.enter)="$any($event.target).blur()"
                        data-testid="brand-option-price"
                      />
                    </label>
                  } @else {
                    <span class="hint">{{ 'admin.optionsCatalog.brand.variantPrice' | translate }}</span>
                  }
                  <button
                    type="button"
                    class="switch"
                    [class.off]="!s.enabled"
                    role="switch"
                    [attr.aria-checked]="s.enabled"
                    [attr.aria-label]="o.name"
                    [disabled]="pending().has(o.id)"
                    (click)="toggle(o)"
                    data-testid="brand-option-toggle"
                  >
                    {{
                      (s.enabled ? 'admin.optionsCatalog.brand.have' : 'admin.optionsCatalog.brand.haveNot') | translate
                    }}
                  </button>
                  @if (canStop() && s.enabled && stores().length > 0) {
                    <div class="flex flex-wrap" style="gap: 6px; flex-basis: 100%">
                      @for (store of stores(); track store.id) {
                        @let out = s.stoppedStoreIds.includes(store.id);
                        <button
                          type="button"
                          class="stop"
                          [class.out]="out"
                          role="switch"
                          [attr.aria-checked]="!out"
                          [disabled]="pending().has(o.id + '@' + store.id)"
                          (click)="toggleStop(o, store)"
                          data-testid="brand-option-stop"
                        >
                          {{ stopText(o.id, store, out) }}
                        </button>
                      }
                    </div>
                  }
                </div>
              }
            </details>
          }
        }
      } @empty {
        @if (catalog()) {
          <p class="hint" style="margin: 0">{{ 'admin.optionsCatalog.brand.empty' | translate }}</p>
        }
      }
      @if (catalog() && nothingShown()) {
        <p class="hint" style="margin: 0">{{ 'admin.optionsCatalog.brand.nothingFound' | translate }}</p>
      }
    </div>
  `,
})
export class BrandOptionCatalogComponent {
  readonly brandId = input.required<string>();
  readonly currency = input<string | null>(null);

  private readonly api = inject(OptionCatalogApi);
  private readonly catalogApi = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);
  private readonly auth = inject(AuthStore);

  /** The stop-list roles: a menu editor prices and switches, but does not stop in a store. */
  readonly canStop = computed(() => canAccess(this.auth.user()?.role as AdminRole | undefined, 'stopList'));
  readonly catalog = signal<BrandOptionCatalog | null>(null);
  readonly stores = signal<StoreAdminDto[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly pending = signal<ReadonlySet<string>>(new Set());
  readonly filter = signal<Filter>('all');
  readonly query = signal('');
  readonly until = signal<Until>('manual');
  /** Groups opened by hand. */
  private readonly opened = signal<ReadonlySet<string>>(new Set());
  /** When the stops made on this page lift, by `optionId@storeId` (the catalog answer does not say). */
  private readonly stopEnds = signal<ReadonlyMap<string, string>>(new Map());

  private readonly groups = computed(() => sortCatalog(this.catalog()?.groups ?? []));
  private readonly settings = computed(() => settingsById(this.catalog()?.settings ?? []));

  readonly counts = computed(() => {
    const all = this.groups().flatMap((g) => g.options);
    const on = all.filter((o) => settingFor(this.settings(), o.id).enabled).length;
    return { all: all.length, on, off: all.length - on };
  });

  readonly sections = computed(() => {
    const q = this.query().trim().toLocaleLowerCase();
    const filter = this.filter();
    const settings = this.settings();
    const narrowed = q !== '' || filter !== 'all';
    return OPTION_GROUP_KINDS.map((kind) => ({
      kind,
      groups: groupsOfKind(this.groups(), kind)
        .map<GroupView>((group) => {
          const groupMatches = q !== '' && group.name.toLocaleLowerCase().includes(q);
          const options = group.options.filter((o) => {
            const enabled = settingFor(settings, o.id).enabled;
            if (filter === 'on' && !enabled) return false;
            if (filter === 'off' && enabled) return false;
            return !q || groupMatches || o.name.toLocaleLowerCase().includes(q);
          });
          return {
            group,
            options,
            on: group.options.filter((o) => settingFor(settings, o.id).enabled).length,
            stopped: group.options.filter((o) => settingFor(settings, o.id).stoppedStoreIds.length > 0).length,
          };
        })
        .filter((view) => !narrowed || view.options.length > 0),
    }));
  });

  readonly nothingShown = computed(
    () => this.counts().all > 0 && this.sections().every((section) => section.groups.length === 0),
  );

  constructor() {
    effect(() => {
      const brandId = this.brandId();
      untracked(() => this.load(brandId));
    });
  }

  setting(optionId: string): BrandOptionSetting {
    return settingFor(this.settings(), optionId);
  }

  isOpen(groupId: string): boolean {
    return this.query().trim() !== '' || this.opened().has(groupId);
  }

  onToggle(groupId: string, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    if (this.query().trim() !== '') return;
    this.opened.update((set) => {
      const next = new Set(set);
      if (open) next.add(groupId);
      else next.delete(groupId);
      return next;
    });
  }

  pickUntil(value: string): void {
    this.until.set(value === 'endOfDay' ? 'endOfDay' : 'manual');
  }

  /** An add-on's price; a counter's is per unit, above what the dish includes. */
  priceLabel(group: CatalogGroup, option: CatalogOption): string {
    const currency = this.currency() ?? '—';
    if (group.type !== 'C') return this.translate.instant('admin.optionsCatalog.brand.price', { currency });
    const included = option.defaultQty ?? 0;
    return included > 0
      ? this.translate.instant('admin.optionsCatalog.brand.priceAbove', { qty: included, currency })
      : this.translate.instant('admin.optionsCatalog.brand.priceUnit', { currency });
  }

  priceText(cents: number): string {
    return cents === 0 ? '' : formatMoneyInput(cents, this.separator());
  }

  stopText(optionId: string, store: StoreAdminDto, out: boolean): string {
    if (!out) return this.translate.instant('admin.optionsCatalog.brand.storeOn', { store: store.name });
    const end = this.stopEnds().get(`${optionId}@${store.id}`);
    if (!end) return this.translate.instant('admin.optionsCatalog.brand.storeOff', { store: store.name });
    const time = formatStoreTime(end, store.timezone, this.translate.getCurrentLang() || 'ru');
    return this.translate.instant('admin.optionsCatalog.brand.storeOffUntil', { store: store.name, time });
  }

  toggle(option: CatalogOption): void {
    const enabled = !this.setting(option.id).enabled;
    this.change(option.id, { enabled });
  }

  /** Saved when the field is left or Enter is pressed; an unreadable price goes back to the saved one. */
  savePrice(option: CatalogOption, event: Event): void {
    const field = event.target as HTMLInputElement;
    const text = field.value.trim();
    const cents = text === '' ? 0 : parseMoney(text);
    const current = this.setting(option.id).priceCents;
    if (cents === null) {
      field.value = this.priceText(current);
      this.error.set(this.translate.instant('admin.menu.errors.surcharge'));
      return;
    }
    if (cents === current) return;
    this.change(option.id, { priceCents: cents }, () => (field.value = this.priceText(current)));
  }

  toggleStop(option: CatalogOption, store: StoreAdminDto): void {
    const key = `${option.id}@${store.id}`;
    const stopped = this.setting(option.id).stoppedStoreIds.includes(store.id);
    const expiresAt = !stopped && this.until() === 'endOfDay' ? nextMidnightIn(store.timezone).toISOString() : null;
    const request: Observable<unknown> = stopped
      ? this.api.resumeInStore(store.id, option.id)
      : this.api.stopInStore(store.id, option.id, expiresAt);
    this.track(key, request, () => {
      this.patch(option.id, (s) => ({
        ...s,
        stoppedStoreIds: stopped ? s.stoppedStoreIds.filter((id) => id !== store.id) : [...s.stoppedStoreIds, store.id],
      }));
      this.stopEnds.update((map) => {
        const next = new Map(map);
        if (expiresAt) next.set(key, expiresAt);
        else next.delete(key);
        return next;
      });
    });
  }

  private change(optionId: string, change: BrandOptionChange, onError?: () => void): void {
    this.track(
      optionId,
      this.api.updateBrandOption(this.brandId(), optionId, change),
      () => this.patch(optionId, (s) => ({ ...s, ...change })),
      onError,
    );
  }

  private patch(optionId: string, update: (setting: BrandOptionSetting) => BrandOptionSetting): void {
    this.catalog.update((catalog) => {
      if (!catalog) return catalog;
      const next = update(settingFor(this.settings(), optionId));
      const others = catalog.settings.filter((s) => s.optionId !== optionId);
      return { ...catalog, settings: [...others, next] };
    });
  }

  private track(key: string, request: Observable<unknown>, onSuccess: () => void, onError?: () => void): void {
    if (this.pending().has(key)) return;
    this.setPending(key, true);
    this.error.set(null);
    request.subscribe({
      next: () => {
        this.setPending(key, false);
        onSuccess();
      },
      error: (err: unknown) => {
        this.setPending(key, false);
        onError?.();
        this.error.set(describeOptionError(err, this.translate));
      },
    });
  }

  private setPending(key: string, on: boolean): void {
    this.pending.update((set) => {
      const next = new Set(set);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  private load(brandId: string): void {
    this.catalog.set(null);
    this.stores.set([]);
    this.loading.set(true);
    this.error.set(null);
    this.api.brandCatalog(brandId).subscribe({
      next: (catalog) => {
        this.loading.set(false);
        if (this.brandId() === brandId) this.catalog.set(catalog);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(describeOptionError(err, this.translate));
      },
    });
    // The stores this account may stop things in — narrowed by the API for a manager.
    if (this.canStop()) {
      this.catalogApi.listStores(brandId).subscribe({
        next: (stores) => {
          if (this.brandId() === brandId) this.stores.set(stores);
        },
        error: () => this.stores.set([]),
      });
    }
  }

  private separator(): string {
    return this.translate.getCurrentLang() === 'en' ? '.' : ',';
  }
}
