import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import type {
  BrandOptionCatalog,
  CatalogGroup,
  CatalogOption,
  ProductOptionGroupsConfig,
} from '@takeaway/shared-types';
import { forkJoin } from 'rxjs';

import {
  type ProductGroupsDraft,
  attachableGroups,
  attachedGroups,
  configFromDraft,
  draftFromConfig,
  effectiveDefault,
  groupsOfKind,
  offeredOptions,
  sameConfig,
  settingFor,
  settingsById,
  sortCatalog,
  withDefault,
  withDelta,
  withGroup,
  withGroupMoved,
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
  canUp: boolean;
  canDown: boolean;
}

const EMPTY_DRAFT: ProductGroupsDraft = { groupIds: [], deltas: {}, defaults: {} };

/**
 * «Варианты и добавки» of one product: the catalog groups it is sold with
 * (`docs/option-groups.md`). Attach a group from the catalog — offered are
 * the groups with at least one option the brand has — order and detach
 * them; variants always come before add-ons. For a variant the price «в
 * этом варианте» is typed as the whole price and stored as what it adds to
 * the base price (the base price is the default variant's). A list or
 * yes/no group may start picked differently on this product (a dish's
 * signature sauce). Everything goes in one `PUT` with «Сохранить».
 *
 * A product with catalog groups is ordered through them only; its older
 * options stop working — the page around says so.
 */
@Component({
  selector: 'app-product-option-groups',
  standalone: true,
  imports: [TranslatePipe],
  styles: [
    MENU_FORM_STYLES,
    `
      .group {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 12px;
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: 12px;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 14px;
        padding: 6px 0;
        border-top: 1px solid var(--color-border-light);
        font-family: var(--font-sans);
        font-size: 13px;
      }
      .arrow {
        width: 26px;
        height: 26px;
        border-radius: 6px;
        border: 1px solid var(--color-border-light);
        background: transparent;
        color: var(--color-text-secondary);
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

      @if (hasLegacyOptions() && savedCount() === 0) {
        <p class="notice" data-testid="product-option-groups-legacy-hint">
          {{ 'admin.optionsCatalog.product.legacyHint' | translate }}
        </p>
      }
      @if (loading()) {
        <p class="hint" style="margin: 0">{{ 'common.loading' | translate }}</p>
      }

      @if (hasVariants()) {
        <p class="hint" style="margin: 0" data-testid="product-option-groups-base">
          {{ 'admin.optionsCatalog.product.base' | translate: { price: money(basePriceCents()) } }}
        </p>
      }

      @for (view of attached(); track view.group.id) {
        <article class="group" data-testid="product-option-group" [attr.data-group]="view.group.name">
          <div class="flex items-center flex-wrap" style="gap: 6px 12px">
            <strong style="font-family: var(--font-sans); font-size: 14px; flex: 1 1 200px; min-width: 0">
              {{ view.group.name }}
              <span class="hint" style="font-weight: 400">
                · {{ 'admin.optionsCatalog.kinds.' + view.group.kind | translate }} ·
                {{ 'admin.optionsCatalog.types.' + view.group.type | translate }}
              </span>
            </strong>
            <span class="flex items-center" style="gap: 8px">
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
              <button type="button" class="link danger" [disabled]="saving()" (click)="detach(view.group)">
                {{ 'admin.optionsCatalog.product.detach' | translate }}
              </button>
            </span>
          </div>
          @for (o of view.options; track o.id) {
            <div class="row" data-testid="product-option-row">
              <span class="flex flex-col" style="gap: 2px; flex: 1 1 160px; min-width: 0">
                <span style="font-weight: 600">{{ o.name }}</span>
                @if (o.note) {
                  <span class="hint">{{ o.note }}</span>
                }
              </span>
              @if (view.group.kind === 'VARIANT') {
                <label class="field" style="flex: 0 1 170px">
                  <span class="label">{{
                    'admin.optionsCatalog.product.variantPrice' | translate: { currency: currency() ?? '—' }
                  }}</span>
                  <input
                    class="control small"
                    inputmode="decimal"
                    autocomplete="off"
                    [value]="variantPriceText(o.id)"
                    [disabled]="saving()"
                    (change)="setVariantPrice(o, $event)"
                    (keydown.enter)="$any($event.target).blur()"
                    [attr.aria-label]="o.name"
                    data-testid="variant-price"
                  />
                  <span class="hint" data-testid="variant-delta">{{ deltaText(o.id) }}</span>
                </label>
              } @else {
                <span class="hint" style="white-space: nowrap">{{ brandPrice(o.id) }}</span>
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
            </div>
          } @empty {
            <p class="hint" style="margin: 0">{{ 'admin.optionsCatalog.product.noOptions' | translate }}</p>
          }
        </article>
      } @empty {
        @if (!loading()) {
          <p class="hint" style="margin: 0">{{ 'admin.optionsCatalog.product.none' | translate }}</p>
        }
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
  /** The product still has older options (sizes, extras): attaching a group switches it over. */
  readonly hasLegacyOptions = input(false);
  /** How many groups the product is saved with — after loading and after every save. */
  readonly attachedCount = output<number>();

  private readonly api = inject(OptionCatalogApi);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);

  readonly kinds = ['VARIANT', 'ADDON'] as const;
  readonly catalog = signal<BrandOptionCatalog | null>(null);
  private readonly saved = signal<ProductOptionGroupsConfig>({ groups: [], overrides: [] });
  readonly draft = signal<ProductGroupsDraft>(EMPTY_DRAFT);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly savedNotice = signal(false);

  private readonly groups = computed(() => sortCatalog(this.catalog()?.groups ?? []));
  private readonly settings = computed(() => settingsById(this.catalog()?.settings ?? []));

  readonly savedCount = computed(() => this.saved().groups.length);
  readonly attached = computed<AttachedView[]>(() => {
    const list = attachedGroups(this.draft(), this.groups());
    return list.map((group) => {
      const kind = groupsOfKind(list, group.kind);
      const index = kind.indexOf(group);
      return {
        group,
        options: offeredOptions(group, this.settings()),
        canUp: index > 0,
        canDown: index < kind.length - 1,
      };
    });
  });
  readonly hasVariants = computed(() => this.attached().some((v) => v.group.kind === 'VARIANT'));
  readonly attachable = computed(() => {
    const list = attachableGroups(this.groups(), this.settings(), new Set(this.draft().groupIds));
    return { VARIANT: groupsOfKind(list, 'VARIANT'), ADDON: groupsOfKind(list, 'ADDON') };
  });
  private readonly config = computed(() => configFromDraft(this.draft(), this.groups()));
  readonly dirty = computed(
    () => !sameConfig(this.config(), configFromDraft(draftFromConfig(this.saved()), this.groups())),
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

  isDefault(option: CatalogOption): boolean {
    return effectiveDefault(this.draft(), option);
  }

  /** «+8 MDL» — an add-on's brand-wide price. */
  brandPrice(optionId: string): string {
    const cents = settingFor(this.settings(), optionId).priceCents;
    return cents === 0
      ? this.translate.instant('admin.optionsCatalog.product.brandFree')
      : this.translate.instant('admin.optionsCatalog.product.brandPrice', { price: this.money(cents) });
  }

  variantPriceText(optionId: string): string {
    return formatMoneyInput(this.basePriceCents() + (this.draft().deltas[optionId] ?? 0), this.separator());
  }

  deltaText(optionId: string): string {
    const delta = this.draft().deltas[optionId] ?? 0;
    if (delta === 0) return this.translate.instant('admin.optionsCatalog.product.deltaZero');
    const sign = delta > 0 ? '+' : '−';
    return this.translate.instant('admin.optionsCatalog.product.delta', {
      delta: `${sign}${this.money(Math.abs(delta))}`,
    });
  }

  /** The whole price is typed; what it adds to the base price is kept. */
  setVariantPrice(option: CatalogOption, event: Event): void {
    const field = event.target as HTMLInputElement;
    const cents = parseMoney(field.value.trim());
    if (cents === null) {
      field.value = this.variantPriceText(option.id);
      this.error.set(this.translate.instant('admin.optionsCatalog.product.badPrice', { name: option.name }));
      return;
    }
    this.error.set(null);
    this.edit((d) => withDelta(d, option.id, cents - this.basePriceCents()));
  }

  setDefault(group: CatalogGroup, option: CatalogOption, on: boolean): void {
    this.edit((d) => withDefault(d, group, option.id, on));
  }

  attach(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const id = select.value;
    select.value = '';
    if (id) this.edit((d) => withGroup(d, id));
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
    this.saved.set(config);
    this.draft.set(draftFromConfig(config));
    this.attachedCount.emit(config.groups.length);
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
