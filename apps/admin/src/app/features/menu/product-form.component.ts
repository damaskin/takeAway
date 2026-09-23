import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import {
  AdminCatalogApi,
  type CategoryAdminDto,
  type DietTag,
  type ProductAdminDto,
  type ProductFieldsInput,
} from '../../core/catalog/admin-catalog.service';
import { describeMenuError } from './menu-errors';
import {
  allergensValidator,
  amountValidator,
  countValidator,
  formatAmountInput,
  formatMinutesInput,
  formatMoneyInput,
  minutesValidator,
  moneyValidator,
  parseAllergens,
  parseAmount,
  parseCount,
  parseMinutes,
  parseMoney,
  slugValidator,
} from './menu-input';
import { MENU_FORM_STYLES } from './menu-form.styles';
import { ProductImagesComponent } from './product-images.component';

const DIET_TAGS: DietTag[] = ['VEGAN', 'VEGETARIAN', 'GLUTEN_FREE', 'LACTOSE_FREE', 'DECAF', 'SUGAR_FREE'];
const CAFFEINE_LEVELS = ['0', '1', '2', '3', '4'] as const;
const NUTRITION = ['calories', 'proteins', 'fats', 'carbs'] as const;

export interface ProductSavedEvent {
  product: ProductAdminDto;
  created: boolean;
}

type ProductControls = ProductFormComponent['form']['controls'];

/**
 * Create / edit one product: the price in the brand's currency, the
 * preparation time in minutes, everything the customer's product page can
 * show (description, nutrition, caffeine, diet tags, allergens) and, once
 * the product exists, its photos. Labels stay visible — placeholders used
 * to be the only labels and vanished as soon as someone started typing.
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
            }
          </label>
        </div>

        <label class="field">
          <span class="label">{{ 'admin.menu.product.description' | translate }}</span>
          <textarea class="control" formControlName="description" rows="3"></textarea>
          <span class="hint">{{ 'admin.menu.product.descriptionHint' | translate }}</span>
        </label>

        <fieldset class="box">
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
            <label class="field">
              <span class="label">{{ 'admin.menu.product.caffeine' | translate }}</span>
              <select class="control" formControlName="caffeineLevel">
                <option value="">{{ 'admin.menu.product.caffeineUnset' | translate }}</option>
                @for (level of caffeineLevels; track level) {
                  <option [value]="level">{{ 'admin.menu.product.caffeineLevel.' + level | translate }}</option>
                }
              </select>
            </label>
          </div>
          @if (showNutritionError()) {
            <span class="error">{{ 'admin.menu.errors.number' | translate }}</span>
          }

          <div class="field">
            <span class="label">{{ 'admin.menu.product.dietTags' | translate }}</span>
            <div class="flex flex-wrap" style="gap: 8px 16px">
              @for (tag of dietTagOptions; track tag) {
                <label class="check">
                  <input type="checkbox" [checked]="hasDietTag(tag)" (change)="toggleDietTag(tag, $event)" />
                  <span>{{ 'admin.menu.product.diet.' + tag | translate }}</span>
                </label>
              }
            </div>
          </div>

          <label class="field">
            <span class="label">{{ 'admin.menu.product.allergens' | translate }}</span>
            <input class="control" formControlName="allergens" autocomplete="off" />
            @if (showError('allergens')) {
              <span class="error">{{ 'admin.menu.errors.allergens' | translate }}</span>
            } @else {
              <span class="hint">{{ 'admin.menu.product.allergensHint' | translate }}</span>
            }
          </label>
        </fieldset>

        <label class="check">
          <input type="checkbox" formControlName="visible" />
          <span>{{ 'admin.menu.product.visible' | translate }}</span>
        </label>

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
          (changed)="imagesChanged.emit({ productId: p.id, imageUrls: $event })"
        />
      } @else {
        <p class="hint" style="margin: 0">{{ 'admin.menu.product.photosAfterCreate' | translate }}</p>
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

  readonly dietTagOptions = DIET_TAGS;
  readonly caffeineLevels = CAFFEINE_LEVELS;
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly submitted = signal(false);
  readonly currencyLabel = computed(() => this.currency() ?? '—');
  readonly createdNotice = computed(() => this.justCreated() && !!this.product());

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
    description: new FormControl('', { nonNullable: true }),
    calories: new FormControl('', { nonNullable: true, validators: [countValidator(0, 100_000)] }),
    proteins: new FormControl('', { nonNullable: true, validators: [amountValidator] }),
    fats: new FormControl('', { nonNullable: true, validators: [amountValidator] }),
    carbs: new FormControl('', { nonNullable: true, validators: [amountValidator] }),
    caffeineLevel: new FormControl('', { nonNullable: true }),
    dietTags: new FormControl<DietTag[]>([], { nonNullable: true }),
    allergens: new FormControl('', { nonNullable: true, validators: [allergensValidator] }),
    visible: new FormControl(true, { nonNullable: true }),
    slug: new FormControl('', { nonNullable: true, validators: [slugValidator] }),
  });

  constructor() {
    effect(() => {
      this.productId();
      const categoryId = this.categoryId();
      untracked(() => this.fill(this.product(), categoryId));
    });
  }

  showError(name: keyof ProductControls): boolean {
    const control = this.form.controls[name];
    return control.invalid && (control.touched || this.submitted());
  }

  showNutritionError(): boolean {
    return NUTRITION.some((name) => this.showError(name));
  }

  hasDietTag(tag: DietTag): boolean {
    return this.form.controls.dietTags.value.includes(tag);
  }

  toggleDietTag(tag: DietTag, event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    const rest = this.form.controls.dietTags.value.filter((t) => t !== tag);
    this.form.controls.dietTags.setValue(on ? [...rest, tag] : rest);
    this.form.controls.dietTags.markAsDirty();
  }

  submit(): void {
    this.submitted.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    const basePriceCents = parseMoney(v.price);
    if (this.form.invalid || basePriceCents === null) return;

    const fields: ProductFieldsInput = {
      name: v.name.trim(),
      description: v.description.trim() || null,
      basePriceCents,
      prepTimeSeconds: parseMinutes(v.prepMinutes) ?? undefined,
      visible: v.visible,
      caffeineLevel: v.caffeineLevel === '' ? null : Number(v.caffeineLevel),
      calories: parseCount(v.calories),
      proteinsGrams: parseAmount(v.proteins),
      fatsGrams: parseAmount(v.fats),
      carbsGrams: parseAmount(v.carbs),
      allergens: parseAllergens(v.allergens),
      dietTags: v.dietTags,
    };

    const existing = this.product();
    const slug = v.slug.trim();
    const request = existing
      ? this.api.updateProduct(existing.id, {
          ...fields,
          ...(v.categoryId && v.categoryId !== existing.categoryId ? { categoryId: v.categoryId } : {}),
        })
      : this.api.createProduct({
          ...withoutNulls(fields),
          brandId: this.brandId(),
          categoryId: this.categoryId(),
          name: fields.name,
          basePriceCents,
          ...(slug ? { slug } : {}),
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
    const separator = this.translate.getCurrentLang() === 'en' ? '.' : ',';
    this.submitted.set(false);
    this.error.set(null);
    this.form.reset({
      name: product?.name ?? '',
      categoryId: product?.categoryId ?? categoryId,
      price: product ? formatMoneyInput(product.basePriceCents, separator) : '',
      prepMinutes: formatMinutesInput(product?.prepTimeSeconds ?? 180, separator),
      description: product?.description ?? '',
      calories: product?.calories == null ? '' : String(product.calories),
      proteins: formatAmountInput(product?.proteinsGrams ?? null, separator),
      fats: formatAmountInput(product?.fatsGrams ?? null, separator),
      carbs: formatAmountInput(product?.carbsGrams ?? null, separator),
      caffeineLevel: product?.caffeineLevel == null ? '' : String(product.caffeineLevel),
      dietTags: product?.dietTags ?? [],
      allergens: (product?.allergens ?? []).join(', '),
      visible: product?.visible ?? true,
      slug: product?.slug ?? '',
    });
  }
}

/** A create sends only what was filled in; there `null` just means "not set". */
function withoutNulls<T extends object>(input: T): { [K in keyof T]?: Exclude<T[K], null> } {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null)) as {
    [K in keyof T]?: Exclude<T[K], null>;
  };
}
