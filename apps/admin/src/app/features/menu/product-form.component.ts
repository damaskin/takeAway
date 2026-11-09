import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { CategoryKind } from '@takeaway/shared-types';
import { productPlaceholderSrc } from '@takeaway/ui-kit';
import { showsNutrition } from '@takeaway/utils';

import {
  AdminCatalogApi,
  type CategoryAdminDto,
  type ProductAdminDto,
  type ProductFieldsInput,
  type ProductStoreOptionDto,
} from '../../core/catalog/admin-catalog.service';
import { describeMenuError } from './menu-errors';
import {
  amountValidator,
  countValidator,
  formatAmountInput,
  formatMinutesInput,
  formatMoneyInput,
  minutesValidator,
  moneyValidator,
  parseAmount,
  parseCount,
  parseMinutes,
  parseMoney,
  slugValidator,
} from './menu-input';
import { MENU_FORM_STYLES } from './menu-form.styles';
import { ProductImagesComponent } from './product-images.component';

const NUTRITION = ['calories', 'proteins', 'fats', 'carbs'] as const;

export interface ProductSavedEvent {
  product: ProductAdminDto;
  created: boolean;
}

type ProductControls = ProductFormComponent['form']['controls'];

/**
 * Create / edit one product: the price in the brand's currency, the
 * preparation time in minutes, what the customer's product page shows
 * (description and, for a meal, energy and nutrition) and, once the product
 * exists, its photos. Labels stay visible — placeholders used to be the only
 * labels and vanished as soon as someone started typing.
 *
 * Caffeine, diet tags («Особенности») and allergens were dropped from the
 * menu on 2026-11-05; the form neither shows nor sends them, and what a
 * product had stays in the database untouched. Since 2026-11-06 «Для
 * покупателя» (calories and nutrition) is asked of a meal only — a FOOD
 * category — and follows the category picked in the form; saving anything
 * else sends them empty (the API clears them too). The kind of the category
 * also picks the placeholder; a new product starts at the category's
 * default preparation time and with its option set (which can be left off).
 */
@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ProductImagesComponent],
  styles: [MENU_FORM_STYLES],
  template: `
    <section
      class="flex flex-col"
      style="gap: 16px; padding: 16px; background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: 16px"
    >
      <header class="flex items-center justify-between" style="gap: 12px; flex-wrap: wrap">
        <h3
          style="margin: 0; min-width: 0; font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso); overflow-wrap: anywhere"
        >
          @if (product(); as p) {
            {{ 'admin.menu.product.editTitle' | translate: { name: p.name } }}
          } @else {
            {{ 'admin.menu.product.newTitle' | translate }}
          }
        </h3>
        <button
          type="button"
          (click)="closed.emit()"
          style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
        >
          {{ 'common.close' | translate }}
        </button>
      </header>

      @if (createdNotice()) {
        <p class="notice">{{ 'admin.menu.product.created' | translate }}</p>
      }

      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col" style="gap: 14px">
        <div class="form-row">
          <label class="field">
            <span class="label">{{ 'admin.menu.product.name' | translate }}</span>
            <input class="control" formControlName="name" maxlength="160" />
            @if (showError('name')) {
              <span class="error">{{ 'admin.menu.errors.name' | translate }}</span>
            }
          </label>
          @if (product()) {
            <label class="field">
              <span class="label">{{ 'admin.menu.product.category' | translate }}</span>
              <select class="control" formControlName="categoryId">
                @for (c of categories(); track c.id) {
                  <option [value]="c.id">{{ c.name }}</option>
                }
              </select>
            </label>
          }
        </div>

        <div class="form-row-tight">
          <label class="field">
            <span class="label">{{ 'admin.menu.product.price' | translate: { currency: currencyLabel() } }}</span>
            <input
              class="control"
              formControlName="price"
              inputmode="decimal"
              autocomplete="off"
              [placeholder]="'admin.menu.product.pricePlaceholder' | translate"
            />
            @if (showError('price')) {
              <span class="error">{{ 'admin.menu.errors.price' | translate }}</span>
            }
          </label>
          <label class="field">
            <span class="label">{{ 'admin.menu.product.prep' | translate }}</span>
            <input class="control" formControlName="prepMinutes" inputmode="decimal" autocomplete="off" />
            @if (showError('prepMinutes')) {
              <span class="error">{{ 'admin.menu.errors.minutes' | translate }}</span>
            } @else if (prepFromCategory()) {
              <span class="hint">{{ 'admin.menu.product.prepFromCategory' | translate }}</span>
            }
          </label>
        </div>

        <label class="field">
          <span class="label">{{ 'admin.menu.product.description' | translate }}</span>
          <textarea class="control" formControlName="description" rows="3"></textarea>
          <span class="hint">{{ 'admin.menu.product.descriptionHint' | translate }}</span>
        </label>

        @if (hasNutrition()) {
          <fieldset class="box" data-testid="product-details">
            <legend>{{ 'admin.menu.product.details' | translate }}</legend>
            <div class="form-row-tight">
              <label class="field">
                <span class="label">{{ 'admin.menu.product.calories' | translate }}</span>
                <input class="control" formControlName="calories" inputmode="numeric" autocomplete="off" />
              </label>
              <label class="field">
                <span class="label">{{ 'admin.menu.product.proteins' | translate }}</span>
                <input class="control" formControlName="proteins" inputmode="decimal" autocomplete="off" />
              </label>
              <label class="field">
                <span class="label">{{ 'admin.menu.product.fats' | translate }}</span>
                <input class="control" formControlName="fats" inputmode="decimal" autocomplete="off" />
              </label>
              <label class="field">
                <span class="label">{{ 'admin.menu.product.carbs' | translate }}</span>
                <input class="control" formControlName="carbs" inputmode="decimal" autocomplete="off" />
              </label>
            </div>
            @if (showNutritionError()) {
              <span class="error">{{ 'admin.menu.errors.number' | translate }}</span>
            } @else {
              <span class="hint" data-testid="product-details-hint">{{
                'admin.menu.product.detailsHint' | translate
              }}</span>
            }
          </fieldset>
        }

        <div class="flex flex-col" style="gap: 4px">
          <label class="check">
            <input type="checkbox" formControlName="prepParallel" data-testid="product-prep-parallel" />
            <span>{{ 'admin.menu.product.prepParallel' | translate }}</span>
          </label>
          <span class="hint" style="padding-left: 22px">{{ 'admin.menu.product.prepParallelHint' | translate }}</span>
        </div>

        <label class="check">
          <input type="checkbox" formControlName="visible" />
          <span>{{ 'admin.menu.product.visible' | translate }}</span>
        </label>

        @if (!product() && categoryOptionCount() > 0) {
          <div class="flex flex-col" style="gap: 4px">
            <label class="check">
              <input
                type="checkbox"
                formControlName="applyCategoryOptions"
                data-testid="product-apply-category-options"
              />
              <span>{{ 'admin.menu.product.applyCategoryOptions' | translate: { count: categoryOptionCount() } }}</span>
            </label>
            <span class="hint" style="padding-left: 22px">{{
              'admin.menu.product.applyCategoryOptionsHint' | translate
            }}</span>
          </div>
        }

        @if (pickStores()) {
          <fieldset class="box">
            <legend>{{ 'admin.menu.product.stores' | translate }}</legend>
            <div class="flex flex-wrap" style="gap: 8px 16px">
              @for (s of storeOptions(); track s.id) {
                <label class="check">
                  <input type="checkbox" [checked]="sellsIn(s.id)" (change)="toggleStore(s.id, $event)" />
                  <span>{{ s.name }}</span>
                </label>
              }
            </div>
            @if (soldNowhere()) {
              <span class="error">{{ 'admin.menu.product.storesNone' | translate }}</span>
            } @else {
              <span class="hint">{{ 'admin.menu.product.storesHint' | translate }}</span>
            }
          </fieldset>
        }

        <details>
          <summary class="hint" style="cursor: pointer; font-size: 13px; color: var(--color-text-secondary)">
            {{ 'admin.menu.slug.advanced' | translate }}
          </summary>
          <label class="field" style="margin-top: 10px">
            <span class="label">{{ 'admin.menu.slug.label' | translate }}</span>
            <input class="control mono" formControlName="slug" autocomplete="off" [readonly]="!!product()" />
            @if (showError('slug')) {
              <span class="error">{{ 'admin.menu.errors.slug' | translate }}</span>
            } @else {
              <span class="hint">{{
                (product() ? 'admin.menu.slug.locked' : 'admin.menu.slug.hint') | translate
              }}</span>
            }
          </label>
        </details>

        <div class="flex items-center flex-wrap" style="gap: 8px 12px">
          <button type="submit" [disabled]="saving()" class="primary disabled:opacity-50">
            {{ (saving() ? 'common.loading' : product() ? 'common.save' : 'admin.menu.product.createCta') | translate }}
          </button>
          <button
            type="button"
            (click)="closed.emit()"
            style="padding: 0 12px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)"
          >
            {{ 'common.cancel' | translate }}
          </button>
        </div>
        @if (error()) {
          <p role="alert" class="error" style="margin: 0; font-size: 13px">{{ error() }}</p>
        }
      </form>

      @if (product(); as p) {
        <app-product-images
          [productId]="p.id"
          [imageUrls]="p.imageUrls"
          [categoryKind]="kind()"
          (changed)="imagesChanged.emit({ productId: p.id, imageUrls: $event })"
        />
      } @else {
        <div class="flex items-center flex-wrap" style="gap: 12px" data-testid="product-placeholder">
          <img
            [src]="placeholder()"
            alt=""
            width="72"
            height="72"
            style="border-radius: 12px; background: white; border: 1px solid var(--color-border-light)"
          />
          <div class="flex flex-col" style="gap: 4px; flex: 1 1 240px; min-width: 0">
            <span class="hint">{{ 'admin.images.placeholder' | translate }}.</span>
            <span class="hint">{{ 'admin.menu.product.photosAfterCreate' | translate }}</span>
            <span class="hint">{{ 'admin.images.productStyle' | translate }}</span>
          </div>
        </div>
      }
    </section>
  `,
})
export class ProductFormComponent {
  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);

  /** `null` creates a product in {@link categoryId}. */
  readonly product = input<ProductAdminDto | null>(null);
  readonly categoryId = input.required<string>();
  readonly categories = input.required<CategoryAdminDto[]>();
  readonly brandId = input.required<string>();
  readonly currency = input<string | null>(null);
  /** Shows the "now add photos" note after a create hands the form over to editing. */
  readonly justCreated = input(false);

  readonly saved = output<ProductSavedEvent>();
  readonly closed = output<void>();
  readonly imagesChanged = output<{ productId: string; imageUrls: string[] }>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly submitted = signal(false);
  readonly currencyLabel = computed(() => this.currency() ?? '—');
  readonly createdNotice = computed(() => this.justCreated() && !!this.product());

  /** The brand's stores. With one (or none) there is nothing to choose: the product is sold there. */
  readonly storeOptions = signal<ProductStoreOptionDto[]>([]);
  readonly pickStores = computed(() => this.storeOptions().length > 1);
  /** Where the product is sold; `null` = untouched default (every store for a new product). */
  readonly storeIds = signal<string[] | null>(null);
  readonly soldNowhere = computed(() => this.storeIds()?.length === 0);

  /**
   * Only a different product refills the form. The same product coming back
   * with new photos must not wipe a price someone is halfway through typing.
   */
  private readonly productId = computed(() => this.product()?.id ?? null);

  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(160)] }),
    categoryId: new FormControl('', { nonNullable: true }),
    price: new FormControl('', { nonNullable: true, validators: [Validators.required, moneyValidator()] }),
    prepMinutes: new FormControl('3', { nonNullable: true, validators: [minutesValidator] }),
    /** «Готовится параллельно»: takes no station in the order queue. */
    prepParallel: new FormControl(false, { nonNullable: true }),
    description: new FormControl('', { nonNullable: true }),
    calories: new FormControl('', { nonNullable: true, validators: [countValidator(0, 100_000)] }),
    proteins: new FormControl('', { nonNullable: true, validators: [amountValidator] }),
    fats: new FormControl('', { nonNullable: true, validators: [amountValidator] }),
    carbs: new FormControl('', { nonNullable: true, validators: [amountValidator] }),
    visible: new FormControl(true, { nonNullable: true }),
    slug: new FormControl('', { nonNullable: true, validators: [slugValidator] }),
    /** New product only: copy the category's option set onto it. */
    applyCategoryOptions: new FormControl(true, { nonNullable: true }),
  });

  private readonly pickedCategoryId = toSignal(this.form.controls.categoryId.valueChanges, {
    initialValue: this.form.controls.categoryId.value,
  });
  readonly category = computed(() => {
    const id = this.pickedCategoryId() || this.categoryId();
    return this.categories().find((c) => c.id === id) ?? null;
  });
  /** The kind of the category picked in the form: the placeholder follows it as soon as it changes. */
  readonly kind = computed<CategoryKind>(() => this.category()?.kind ?? 'OTHER');
  readonly placeholder = computed(() => productPlaceholderSrc(this.kind()));
  /** Calories and nutrition are asked of a meal only. */
  readonly hasNutrition = computed(() => showsNutrition(this.kind()));
  readonly categoryOptionCount = computed(() => this.category()?._count?.options ?? 0);
  /** A new product's time was filled in from its category. */
  readonly prepFromCategory = signal(false);

  constructor() {
    effect(() => {
      this.productId();
      const categoryId = this.categoryId();
      untracked(() => this.fill(this.product(), categoryId));
    });

    // Calories and nutrition hidden for a drink must not hold the form back
    // with a typo nobody can see any more.
    effect(() => {
      const on = this.hasNutrition();
      untracked(() => {
        for (const name of NUTRITION) {
          const control = this.form.controls[name];
          if (on) control.enable({ emitEvent: false });
          else control.disable({ emitEvent: false });
        }
      });
    });

    // A new product starts at its category's time (the categories may load
    // after the form) unless someone already typed one.
    effect(() => {
      const seconds = this.category()?.defaultPrepTimeSeconds ?? null;
      untracked(() => {
        const control = this.form.controls.prepMinutes;
        if (this.product() || seconds === null || control.dirty) return;
        control.setValue(formatMinutesInput(seconds, this.separator()));
        this.prepFromCategory.set(true);
      });
    });

    effect(() => {
      const brandId = this.brandId();
      untracked(() => {
        this.storeOptions.set([]);
        this.api.listProductStores(brandId).subscribe({
          next: (stores) => {
            if (this.brandId() === brandId) this.storeOptions.set(stores);
          },
          // Without the list the picker stays hidden and the listing is left as it is.
          error: () => this.storeOptions.set([]),
        });
      });
    });
  }

  sellsIn(storeId: string): boolean {
    const ids = this.storeIds();
    return ids === null || ids.includes(storeId);
  }

  toggleStore(storeId: string, event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    const current = this.storeIds() ?? this.storeOptions().map((s) => s.id);
    const rest = current.filter((id) => id !== storeId);
    this.storeIds.set(on ? [...rest, storeId] : rest);
  }

  showError(name: keyof ProductControls): boolean {
    const control = this.form.controls[name];
    return control.invalid && (control.touched || this.submitted());
  }

  showNutritionError(): boolean {
    return NUTRITION.some((name) => this.showError(name));
  }

  submit(): void {
    this.submitted.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    const basePriceCents = parseMoney(v.price);
    if (this.form.invalid || basePriceCents === null) return;

    // Not a meal: sent empty, so an edited drink keeps no figures (a create
    // leaves the nulls out).
    const nutrition = this.hasNutrition();
    const fields: ProductFieldsInput = {
      name: v.name.trim(),
      description: v.description.trim() || null,
      basePriceCents,
      prepTimeSeconds: parseMinutes(v.prepMinutes) ?? undefined,
      // Only when ticked or unticked here: the API keeps (or defaults) it otherwise.
      ...(this.form.controls.prepParallel.dirty ? { prepParallel: v.prepParallel } : {}),
      visible: v.visible,
      calories: nutrition ? parseCount(v.calories) : null,
      proteinsGrams: nutrition ? parseAmount(v.proteins) : null,
      fatsGrams: nutrition ? parseAmount(v.fats) : null,
      carbsGrams: nutrition ? parseAmount(v.carbs) : null,
    };

    const existing = this.product();
    const slug = v.slug.trim();
    // Only sent when there was a choice to make and it was made; otherwise a
    // new product goes to every store and an edited one keeps its listing.
    const storeIds = this.storeIds();
    const listing = this.pickStores() && storeIds !== null ? { storeIds } : {};
    const request = existing
      ? this.api.updateProduct(existing.id, {
          ...fields,
          ...(v.categoryId && v.categoryId !== existing.categoryId ? { categoryId: v.categoryId } : {}),
          ...listing,
        })
      : this.api.createProduct({
          ...withoutNulls(fields),
          brandId: this.brandId(),
          categoryId: this.categoryId(),
          name: fields.name,
          basePriceCents,
          ...(slug ? { slug } : {}),
          ...listing,
          // Only said when the owner left the category's options off.
          ...(this.categoryOptionCount() > 0 && !v.applyCategoryOptions ? { applyCategoryOptions: false } : {}),
        });
    this.saving.set(true);
    request.subscribe({
      next: (product) => {
        this.saving.set(false);
        this.submitted.set(false);
        this.saved.emit({ product, created: !existing });
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(describeMenuError(err, this.translate));
      },
    });
  }

  private fill(product: ProductAdminDto | null, categoryId: string): void {
    const separator = this.separator();
    this.submitted.set(false);
    this.error.set(null);
    this.storeIds.set(product?.storeIds ?? null);
    const categoryPrep = product
      ? null
      : (this.categories().find((c) => c.id === categoryId)?.defaultPrepTimeSeconds ?? null);
    this.prepFromCategory.set(categoryPrep !== null);
    this.form.reset({
      name: product?.name ?? '',
      categoryId: product?.categoryId ?? categoryId,
      price: product ? formatMoneyInput(product.basePriceCents, separator) : '',
      prepMinutes: formatMinutesInput(product?.prepTimeSeconds ?? categoryPrep ?? 180, separator),
      prepParallel: product?.prepParallel ?? false,
      description: product?.description ?? '',
      calories: product?.calories == null ? '' : String(product.calories),
      proteins: formatAmountInput(product?.proteinsGrams ?? null, separator),
      fats: formatAmountInput(product?.fatsGrams ?? null, separator),
      carbs: formatAmountInput(product?.carbsGrams ?? null, separator),
      visible: product?.visible ?? true,
      slug: product?.slug ?? '',
      applyCategoryOptions: true,
    });
  }

  private separator(): string {
    return this.translate.getCurrentLang() === 'en' ? '.' : ',';
  }
}

/** A create sends only what was filled in; there `null` just means "not set". */
function withoutNulls<T extends object>(input: T): { [K in keyof T]?: Exclude<T[K], null> } {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null)) as {
    [K in keyof T]?: Exclude<T[K], null>;
  };
}
