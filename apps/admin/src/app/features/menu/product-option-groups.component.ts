import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import {
  type BrandOptionCatalog,
  type CatalogGroup,
  type CatalogOption,
  type CategoryKind,
  OPTION_GROUP_KINDS,
  type ProductOptionGroupsConfig,
} from '@takeaway/shared-types';
import { scopeFitsKind } from '@takeaway/utils';
import { forkJoin } from 'rxjs';

import {
  type ProductGroupsDraft,
  attachableGroups,
  attachedGroups,
  configFromDraft,
  configShowsProduct,
  draftFromConfig,
  effectiveDefault,
  groupsOfKind,
  isOptionOn,
  offeredOptions,
  sameConfig,
  settingFor,
  settingsById,
  sortCatalog,
  withDefault,
  withGroup,
  withGroupMoved,
  withOptionOn,
  withPrice,
  withPriceForGroup,
  withoutGroup,
} from '../../core/catalog/option-catalog';
import { OptionCatalogApi } from '../../core/catalog/option-catalog.service';
import { describeOptionError } from '../option-catalog/option-errors';
import { MENU_FORM_STYLES } from './menu-form.styles';
import { formatMoneyInput, parseMoney } from './menu-input';

interface AttachedView {
  group: CatalogGroup;
  /** The options the brand has, in catalog order. */
  options: CatalogOption[];
  /** Of those, offered on this product. */
  on: number;
  canUp: boolean;
  canDown: boolean;
  /** Meant for drinks while the product is food, or the other way round (attached before the scope said so). */
  otherScope: boolean;
}

const EMPTY_DRAFT: ProductGroupsDraft = { groupIds: [], prices: {}, defaults: {}, off: {} };

/**
 * «Варианты и добавки» of one product: the catalog groups it is sold with
 * (`docs/option-groups.md`). Each attached group is a drawer — a click on
 * «Размер» slides its options out. Per option:
 *
 * - a switch: offered on this product or not (a shawarma's «Основа»
 *   without «Булка» and «Пита»);
 * - a variant's surcharge: empty or 0 — none, the base price; a sum — added
 *   to the order (Maxim, 2026-11-18). Variant prices live here only;
 * - an add-on's price: empty — the brand's from «Добавки» (shown under the
 *   field), a sum — this product's own, 0 — free here;
 * - «Ко всем»: the option's price for every option of the group;
 * - a default for a list or yes/no group (a dish's signature sauce).
 *
 * Offered to attach are the groups of the product's category kind (drinks or
 * food, `scopeFitsKind`) with an option the brand has; a group attached
 * before keeps its place, marked. Everything goes in one `PUT` with
 * «Сохранить». A product saved without a variant and an add-on it offers is
 * not shown to customers — the block says so at the top.
 */
@Component({
  selector: 'app-product-option-groups',
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
      .group[open] > summary {
        border-bottom: 1px solid var(--color-border-light);
      }
      .group-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .chip {
        padding: 1px 8px;
        border-radius: 9999px;
        background: var(--color-cream);
        color: var(--color-text-secondary);
        font-size: 11px;
      }
      .tools {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 8px 14px 0;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 14px;
        padding: 10px 14px;
        font-family: var(--font-sans);
        font-size: 13px;
      }
      .row + .row {
        border-top: 1px solid var(--color-border-light);
      }
      .row.off .opt-name {
        color: var(--color-text-tertiary);
        text-decoration: line-through;
      }
      .opt-name {
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .arrow {
        width: 26px;
        height: 26px;
        border-radius: 6px;
        border: 1px solid var(--color-border-light);
        background: transparent;
        color: var(--color-text-secondary);
      }
      .hidden-warning {
        margin: 0;
        padding: 10px 12px;
        border-radius: 8px;
        background: #d94b5e1a;
        border-left: 3px solid var(--color-berry);
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        color: var(--color-berry);
      }
    `,
  ],
  template: `
    <section
      class="flex flex-col"
      style="gap: 12px; padding: 16px; background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: 16px"
      data-testid="product-option-groups"
    >
      <div class="flex flex-col" style="gap: 4px">
        <h3 style="margin: 0; font-family: var(--font-display); font-size: 18px; color: var(--color-espresso)">
          {{ 'admin.optionsCatalog.product.title' | translate }}
        </h3>
        <p class="hint" style="margin: 0">{{ 'admin.optionsCatalog.product.hint' | translate }}</p>
      </div>

      @if (hiddenFromCustomers()) {
        <p class="hidden-warning" role="alert" data-testid="product-hidden-warning">
          {{ 'admin.optionsCatalog.product.hidden' | translate }}
        </p>
      }
      @if (loading()) {
        <p class="hint" style="margin: 0">{{ 'common.loading' | translate }}</p>
      }

      @for (section of sections(); track section.kind) {
        @if (section.views.length > 0) {
          <h4 style="margin: 4px 0 0; font-family: var(--font-sans); font-size: 14px; color: var(--color-espresso)">
            {{ 'admin.optionsCatalog.kindsPlural.' + section.kind | translate }}
          </h4>
          @if (section.kind === 'VARIANT') {
            <p class="hint" style="margin: 0" data-testid="product-option-groups-base">
              {{ 'admin.optionsCatalog.product.base' | translate: { price: money(basePriceCents()) } }}
            </p>
          }
          @for (view of section.views; track view.group.id) {
            <details
              class="group"
              [open]="opened().has(view.group.id)"
              (toggle)="onToggle(view.group.id, $event)"
              data-testid="product-option-group"
              [attr.data-group]="view.group.name"
            >
              <summary data-testid="product-option-group-toggle">
                <span class="group-name">{{ view.group.name }}</span>
                <span class="hint">
                  {{ 'admin.optionsCatalog.types.' + view.group.type | translate }} ·
                  {{ 'admin.optionsCatalog.product.count' | translate: { on: view.on, total: view.options.length } }}
                </span>
                @if (view.otherScope) {
                  <span class="chip">{{ 'admin.optionsCatalog.product.otherScope' | translate }}</span>
                }
              </summary>
              <div class="tools">
                <button
                  type="button"
                  class="arrow disabled:opacity-30"
                  [disabled]="!view.canUp || saving()"
                  [attr.aria-label]="'admin.optionsCatalog.catalog.moveUp' | translate"
                  (click)="move(view.group, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="arrow disabled:opacity-30"
                  [disabled]="!view.canDown || saving()"
                  [attr.aria-label]="'admin.optionsCatalog.catalog.moveDown' | translate"
                  (click)="move(view.group, 1)"
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="link danger"
                  style="margin-left: auto"
                  [disabled]="saving()"
                  (click)="detach(view.group)"
                >
                  {{ 'admin.optionsCatalog.product.detach' | translate }}
                </button>
              </div>
              @for (o of view.options; track o.id) {
                @let on = isOn(o.id);
                <div class="row" [class.off]="!on" data-testid="product-option-row">
                  <label class="check" style="flex: 1 1 170px; min-width: 0; align-items: flex-start">
                    <input
                      type="checkbox"
                      [checked]="on"
                      [disabled]="saving()"
                      (change)="setOn(o, $any($event.target).checked)"
                      [attr.aria-label]="'admin.optionsCatalog.product.onProduct' | translate: { name: o.name }"
                      data-testid="option-on"
                    />
                    <span class="flex flex-col" style="gap: 2px; min-width: 0">
                      <span class="opt-name">{{ o.name }}</span>
                      @if (o.note) {
                        <span class="hint">{{ o.note }}</span>
                      }
                    </span>
                  </label>
                  @if (on) {
                    <label class="field" style="flex: 0 1 150px">
                      <span class="label">{{ priceLabel(view.group, o) }}</span>
                      <input
                        class="control small"
                        inputmode="decimal"
                        autocomplete="off"
                        [placeholder]="pricePlaceholder(view.group, o)"
                        [value]="priceText(o.id)"
                        [disabled]="saving()"
                        (change)="setPrice(view.group, o, $event)"
                        (keydown.enter)="$any($event.target).blur()"
                        [attr.aria-label]="priceLabel(view.group, o) + ' ' + o.name"
                        [attr.data-testid]="view.group.kind === 'VARIANT' ? 'variant-price' : 'addon-price'"
                      />
                      <span class="hint" data-testid="option-price-hint">{{ priceHint(view.group, o) }}</span>
                    </label>
                    @if (view.options.length > 1) {
                      <button
                        type="button"
                        class="link"
                        [disabled]="saving()"
                        [title]="'admin.optionsCatalog.applyAllHint' | translate"
                        (click)="applyToAll(view.group, o)"
                        data-testid="price-apply-all"
                      >
                        {{ 'admin.optionsCatalog.applyAll' | translate }}
                      </button>
                    }
                    @if (view.group.type !== 'C') {
                      <label class="check">
                        <input
                          type="checkbox"
                          [checked]="isDefault(o)"
                          [disabled]="saving()"
                          (change)="setDefault(view.group, o, $any($event.target).checked)"
                          data-testid="option-product-default"
                        />
                        <span>{{ 'admin.optionsCatalog.product.isDefault' | translate }}</span>
                      </label>
                    }
                  }
                </div>
              } @empty {
                <p class="hint" style="margin: 0; padding: 10px 14px">
                  {{ 'admin.optionsCatalog.product.noOptions' | translate }}
                </p>
              }
            </details>
          }
        }
      }
      @if (!loading() && attached().length === 0) {
        <p class="hint" style="margin: 0">{{ 'admin.optionsCatalog.product.none' | translate }}</p>
      }

      @if (attachable().VARIANT.length + attachable().ADDON.length > 0) {
        <label class="field" style="max-width: 360px">
          <span class="label">{{ 'admin.optionsCatalog.product.attach' | translate }}</span>
          <select class="control" [disabled]="saving()" (change)="attach($event)" data-testid="option-group-attach">
            <option value="">{{ 'admin.optionsCatalog.product.attachPlaceholder' | translate }}</option>
            @for (kind of kinds; track kind) {
              @if (attachable()[kind].length > 0) {
                <optgroup [label]="'admin.optionsCatalog.kindsPlural.' + kind | translate">
                  @for (g of attachable()[kind]; track g.id) {
                    <option [value]="g.id">{{ g.name }}</option>
                  }
                </optgroup>
              }
            }
          </select>
        </label>
      }

      @if (error(); as message) {
        <p role="alert" class="error" style="margin: 0; font-size: 13px">{{ message }}</p>
      }
      <div class="flex items-center flex-wrap" style="gap: 8px 12px">
        <button
          type="button"
          class="primary disabled:opacity-50"
          [disabled]="!dirty() || saving() || !catalog()"
          (click)="save()"
          data-testid="product-option-groups-save"
        >
          {{ 'admin.optionsCatalog.product.save' | translate }}
        </button>
        @if (savedNotice()) {
          <span class="hint" role="status">{{ 'admin.optionsCatalog.product.saved' | translate }}</span>
        }
      </div>
    </section>
  `,
})
export class ProductOptionGroupsComponent {
  readonly productId = input.required<string>();
  readonly brandId = input.required<string>();
  readonly basePriceCents = input(0);
  readonly currency = input<string | null>(null);
  /** The product's category kind: which groups it is offered (drinks, food, or all for OTHER). */
  readonly categoryKind = input<CategoryKind | null>(null);
  /** After every save: whether customers can see the product now. */
  readonly saved = output<boolean>();

  private readonly api = inject(OptionCatalogApi);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);

  readonly kinds = OPTION_GROUP_KINDS;
  readonly catalog = signal<BrandOptionCatalog | null>(null);
  private readonly savedConfig = signal<ProductOptionGroupsConfig>({ groups: [], overrides: [] });
  readonly draft = signal<ProductGroupsDraft>(EMPTY_DRAFT);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly savedNotice = signal(false);
  /** Drawers open: the ones opened by hand and every group attached on this visit. */
  readonly opened = signal<ReadonlySet<string>>(new Set());

  private readonly groups = computed(() => sortCatalog(this.catalog()?.groups ?? []));
  private readonly settings = computed(() => settingsById(this.catalog()?.settings ?? []));

  readonly attached = computed<AttachedView[]>(() => {
    const list = attachedGroups(this.draft(), this.groups());
    const kind = this.categoryKind();
    return list.map((group) => {
      const sameKind = groupsOfKind(list, group.kind);
      const index = sameKind.indexOf(group);
      const options = offeredOptions(group, this.settings());
      return {
        group,
        options,
        on: options.filter((o) => isOptionOn(this.draft(), o.id)).length,
        canUp: index > 0,
        canDown: index < sameKind.length - 1,
        otherScope: !!kind && !scopeFitsKind(group.scope, kind),
      };
    });
  });
  readonly sections = computed(() =>
    OPTION_GROUP_KINDS.map((kind) => ({ kind, views: this.attached().filter((v) => v.group.kind === kind) })),
  );
  /** Saved without a variant and an add-on it offers: customers do not see it. */
  readonly hiddenFromCustomers = computed(
    () =>
      !this.loading() && !!this.catalog() && !configShowsProduct(this.savedConfig(), this.groups(), this.settings()),
  );
  readonly attachable = computed(() => {
    const list = attachableGroups(this.groups(), this.settings(), new Set(this.draft().groupIds), this.categoryKind());
    return { VARIANT: groupsOfKind(list, 'VARIANT'), ADDON: groupsOfKind(list, 'ADDON') };
  });
  private readonly config = computed(() => configFromDraft(this.draft(), this.groups()));
  readonly dirty = computed(
    () => !sameConfig(this.config(), configFromDraft(draftFromConfig(this.savedConfig()), this.groups())),
  );

  constructor() {
    effect(() => {
      const productId = this.productId();
      const brandId = this.brandId();
      untracked(() => this.load(productId, brandId));
    });
  }

  money(cents: number): string {
    return this.fmt.money(cents, this.currency());
  }

  isOn(optionId: string): boolean {
    return isOptionOn(this.draft(), optionId);
  }

  isDefault(option: CatalogOption): boolean {
    return effectiveDefault(this.draft(), option);
  }

  onToggle(groupId: string, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    if (open === this.opened().has(groupId)) return;
    this.opened.update((set) => {
      const next = new Set(set);
      if (open) next.add(groupId);
      else next.delete(groupId);
      return next;
    });
  }

  /** «Доплата, ₽» for a variant, «Цена, ₽» for an add-on (a counter's: per unit above what is included). */
  priceLabel(group: CatalogGroup, option: CatalogOption): string {
    const currency = this.currency() ?? '—';
    if (group.kind === 'VARIANT') return this.translate.instant('admin.optionsCatalog.product.surcharge', { currency });
    if (group.type === 'C' && (option.defaultQty ?? 0) > 0) {
      return this.translate.instant('admin.optionsCatalog.brand.priceAbove', { qty: option.defaultQty, currency });
    }
    return this.translate.instant('admin.optionsCatalog.brand.price', { currency });
  }

  /** Empty field: a variant adds nothing; an add-on costs what the brand charges. */
  pricePlaceholder(group: CatalogGroup, option: CatalogOption): string {
    if (group.kind === 'VARIANT') return '0';
    return formatMoneyInput(settingFor(this.settings(), option.id).priceCents, this.separator());
  }

  /** The product's own price as typed; empty when it has none (variant: none or 0). */
  priceText(optionId: string): string {
    const cents = this.draft().prices[optionId];
    return cents === undefined ? '' : formatMoneyInput(cents, this.separator());
  }

  /** «итого 55 ₽» under a variant; «бренд: +5 ₽» or «своя цена · бренд: +5 ₽» under an add-on. */
  priceHint(group: CatalogGroup, option: CatalogOption): string {
    const own = this.draft().prices[option.id];
    if (group.kind === 'VARIANT') {
      return this.translate.instant('admin.optionsCatalog.product.total', {
        price: this.money(this.basePriceCents() + (own ?? 0)),
      });
    }
    const cents = settingFor(this.settings(), option.id).priceCents;
    const brand =
      cents === 0
        ? this.translate.instant('admin.optionsCatalog.product.brandFree')
        : this.translate.instant('admin.optionsCatalog.product.brandPrice', { price: this.money(cents) });
    return own === undefined ? brand : `${this.translate.instant('admin.optionsCatalog.product.ownPrice')} · ${brand}`;
  }

  /** Saved with «Сохранить»; empty clears the product's own price, an unreadable one goes back. */
  setPrice(group: CatalogGroup, option: CatalogOption, event: Event): void {
    const field = event.target as HTMLInputElement;
    const text = field.value.trim();
    const cents = text === '' ? null : parseMoney(text);
    if (cents === null && text !== '') {
      field.value = this.priceText(option.id);
      this.error.set(this.translate.instant('admin.optionsCatalog.product.badPrice', { name: option.name }));
      return;
    }
    this.error.set(null);
    this.edit((d) => withPrice(d, group, option.id, cents));
    // A variant typed as 0 reads back empty.
    field.value = this.priceText(option.id);
  }

  applyToAll(group: CatalogGroup, option: CatalogOption): void {
    this.edit((d) => withPriceForGroup(d, group, option.id));
  }

  setOn(option: CatalogOption, on: boolean): void {
    this.edit((d) => withOptionOn(d, option.id, on));
  }

  setDefault(group: CatalogGroup, option: CatalogOption, on: boolean): void {
    this.edit((d) => withDefault(d, group, option.id, on));
  }

  attach(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const id = select.value;
    select.value = '';
    if (!id) return;
    this.edit((d) => withGroup(d, id));
    this.opened.update((set) => new Set([...set, id]));
  }

  detach(group: CatalogGroup): void {
    this.edit((d) => withoutGroup(d, group.id));
  }

  move(group: CatalogGroup, delta: -1 | 1): void {
    this.edit((d) => withGroupMoved(d, this.groups(), group.id, delta));
  }

  save(): void {
    if (this.saving() || !this.dirty()) return;
    const config = this.config();
    this.saving.set(true);
    this.error.set(null);
    this.api.saveProductGroups(this.productId(), config).subscribe({
      next: (answer) => {
        this.saving.set(false);
        this.apply(isConfig(answer) ? answer : config);
        this.savedNotice.set(true);
        this.saved.emit(!this.hiddenFromCustomers());
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(describeOptionError(err, this.translate));
      },
    });
  }

  private edit(change: (draft: ProductGroupsDraft) => ProductGroupsDraft): void {
    this.savedNotice.set(false);
    this.draft.update(change);
  }

  private apply(config: ProductOptionGroupsConfig): void {
    this.savedConfig.set(config);
    this.draft.set(draftFromConfig(config));
  }

  private load(productId: string, brandId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.savedNotice.set(false);
    forkJoin({ catalog: this.api.brandCatalog(brandId), config: this.api.productGroups(productId) }).subscribe({
      next: ({ catalog, config }) => {
        this.loading.set(false);
        this.catalog.set(catalog);
        this.apply(isConfig(config) ? config : { groups: [], overrides: [] });
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(describeOptionError(err, this.translate));
      },
    });
  }

  private separator(): string {
    return this.translate.getCurrentLang() === 'en' ? '.' : ',';
  }
}

function isConfig(value: unknown): value is ProductOptionGroupsConfig {
  const v = value as Partial<ProductOptionGroupsConfig> | null;
  return !!v && Array.isArray(v.groups) && Array.isArray(v.overrides);
}
