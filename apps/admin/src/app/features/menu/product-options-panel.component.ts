import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { Observable } from 'rxjs';

import {
  AdminCatalogApi,
  type ModifierAdminDto,
  type VariationAdminDto,
  type VariationType,
} from '../../core/catalog/admin-catalog.service';
import { LocaleFormatService } from '@takeaway/i18n';
import { describeMenuError } from './menu-errors';
import { MENU_FORM_STYLES } from './menu-form.styles';
import { countValidator, formatMoneyInput, moneyValidator, parseCount, parseMoney } from './menu-input';

const VARIATION_TYPES: VariationType[] = ['SIZE', 'TEMPERATURE', 'MILK', 'CUP'];
const MAX_COUNT = 99;

/**
 * Options of one product. Variations are chosen one per group (size,
 * milk…), with at most one pre-selected default per group; modifiers are
 * extras a customer can add several of, between a minimum and a maximum.
 * Every row can be edited in place — before, a typo in "Большой" or a
 * wrong surcharge meant deleting the option and building it again.
 */
@Component({
  selector: 'app-product-options-panel',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  styles: [MENU_FORM_STYLES],
  template: `
    <div
      style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 16px; padding: 16px; background: var(--color-cream); border-radius: 14px; margin-top: 8px"
    >
      <!-- Variations -->
      <section class="flex flex-col" style="gap: 10px; min-width: 0">
        <div class="flex flex-col" style="gap: 2px">
          <h3 [style]="headingStyle">{{ 'admin.menu.options.variations' | translate }}</h3>
          <p class="hint" style="margin: 0">{{ 'admin.menu.options.variationsHint' | translate }}</p>
        </div>
        @if (loading()) {
          <p class="hint" style="margin: 0">{{ 'common.loading' | translate }}</p>
        }
        @for (group of variationGroups(); track group.type) {
          <div class="flex flex-col" style="gap: 6px">
            <span class="label" style="font-weight: 700">{{
              'admin.menu.options.types.' + group.type | translate
            }}</span>
            @for (v of group.items; track v.id) {
              @if (editingVariationId() === v.id) {
                <form [formGroup]="variationEdit" (ngSubmit)="saveVariation(v)" [style]="editBoxStyle">
                  <div class="form-row-tight">
                    <label class="field">
                      <span class="label">{{ 'admin.menu.options.name' | translate }}</span>
                      <input class="control small" formControlName="name" maxlength="60" />
                    </label>
                    <label class="field">
                      <span class="label">{{
                        'admin.menu.options.priceDelta' | translate: { currency: currencyLabel() }
                      }}</span>
                      <input class="control small" formControlName="price" inputmode="decimal" autocomplete="off" />
                    </label>
                    <label class="field">
                      <span class="label">{{ 'admin.menu.options.sortOrder' | translate }}</span>
                      <input class="control small" formControlName="sortOrder" inputmode="numeric" autocomplete="off" />
                    </label>
                  </div>
                  <label class="check">
                    <input type="checkbox" formControlName="isDefault" />
                    <span>{{ 'admin.menu.options.default' | translate }}</span>
                  </label>
                  @if (variationEditSubmitted() && optionError(variationEdit); as key) {
                    <span class="error">{{ key | translate }}</span>
                  }
                  <div class="flex items-center flex-wrap" style="gap: 8px 12px">
                    <button type="submit" class="primary small disabled:opacity-50" [disabled]="busy()">
                      {{ 'common.save' | translate }}
                    </button>
                    <button type="button" class="link muted" (click)="cancelEdit()">
                      {{ 'common.cancel' | translate }}
                    </button>
                  </div>
                </form>
              } @else {
                <div [style]="rowStyle">
                  <span [style]="nameStyle">{{ v.name }}</span>
                  @if (v.isDefault) {
                    <span [style]="badgeStyle">{{ 'admin.menu.options.default' | translate }}</span>
                  }
                  <span [style]="deltaStyle">{{ formatDelta(v.priceDeltaCents) }}</span>
                  <span class="flex items-center" style="gap: 10px">
                    <button type="button" class="link" [disabled]="busy()" (click)="editVariation(v)">
                      {{ 'admin.menu.options.edit' | translate }}
                    </button>
                    <button type="button" class="link danger" [disabled]="busy()" (click)="deleteVariation(v)">
                      {{ 'admin.menu.options.delete' | translate }}
                    </button>
                  </span>
                </div>
              }
            }
          </div>
        } @empty {
          @if (!loading()) {
            <p class="hint" style="margin: 0">{{ 'admin.menu.options.noVariations' | translate }}</p>
          }
        }

        <form [formGroup]="variationAdd" (ngSubmit)="addVariation()" class="flex flex-col" style="gap: 8px">
          <div class="form-row-tight">
            <label class="field">
              <span class="label">{{ 'admin.menu.options.type' | translate }}</span>
              <select class="control small" formControlName="type">
                @for (t of variationTypes; track t) {
                  <option [value]="t">{{ 'admin.menu.options.types.' + t | translate }}</option>
                }
              </select>
            </label>
            <label class="field">
              <span class="label">{{ 'admin.menu.options.name' | translate }}</span>
              <input
                class="control small"
                formControlName="name"
                maxlength="60"
                [placeholder]="'admin.menu.options.namePlaceholder' | translate"
              />
            </label>
            <label class="field">
              <span class="label">{{
                'admin.menu.options.priceDelta' | translate: { currency: currencyLabel() }
              }}</span>
              <input
                class="control small"
                formControlName="price"
                inputmode="decimal"
                autocomplete="off"
                placeholder="0"
              />
            </label>
          </div>
          <div class="flex items-center flex-wrap" style="gap: 8px 16px">
            <label class="check">
              <input type="checkbox" formControlName="isDefault" />
              <span>{{ 'admin.menu.options.default' | translate }}</span>
            </label>
            <button type="submit" class="primary small disabled:opacity-50" [disabled]="busy()">
              {{ 'admin.menu.options.addVariation' | translate }}
            </button>
          </div>
          @if (variationAddSubmitted() && optionError(variationAdd); as key) {
            <span class="error">{{ key | translate }}</span>
          }
        </form>
      </section>

      <!-- Modifiers -->
      <section class="flex flex-col" style="gap: 10px; min-width: 0">
        <div class="flex flex-col" style="gap: 2px">
          <h3 [style]="headingStyle">{{ 'admin.menu.options.modifiers' | translate }}</h3>
          <p class="hint" style="margin: 0">{{ 'admin.menu.options.modifiersHint' | translate }}</p>
        </div>
        @for (m of modifiers(); track m.id) {
          @if (editingModifierId() === m.id) {
            <form [formGroup]="modifierEdit" (ngSubmit)="saveModifier(m)" [style]="editBoxStyle">
              <div class="form-row-tight">
                <label class="field">
                  <span class="label">{{ 'admin.menu.options.name' | translate }}</span>
                  <input class="control small" formControlName="name" maxlength="80" />
                </label>
                <label class="field">
                  <span class="label">{{
                    'admin.menu.options.priceDelta' | translate: { currency: currencyLabel() }
                  }}</span>
                  <input class="control small" formControlName="price" inputmode="decimal" autocomplete="off" />
                </label>
              </div>
              <div class="form-row-tight">
                <label class="field">
                  <span class="label">{{ 'admin.menu.options.minCount' | translate }}</span>
                  <input class="control small" formControlName="minCount" inputmode="numeric" autocomplete="off" />
                </label>
                <label class="field">
                  <span class="label">{{ 'admin.menu.options.maxCount' | translate }}</span>
                  <input class="control small" formControlName="maxCount" inputmode="numeric" autocomplete="off" />
                </label>
                <label class="field">
                  <span class="label">{{ 'admin.menu.options.sortOrder' | translate }}</span>
                  <input class="control small" formControlName="sortOrder" inputmode="numeric" autocomplete="off" />
                </label>
              </div>
              <span class="hint">{{ 'admin.menu.options.countHint' | translate }}</span>
              @if (modifierEditSubmitted() && modifierEditError(); as key) {
                <span class="error">{{ key | translate }}</span>
              }
              <div class="flex items-center flex-wrap" style="gap: 8px 12px">
                <button type="submit" class="primary small disabled:opacity-50" [disabled]="busy()">
                  {{ 'common.save' | translate }}
                </button>
                <button type="button" class="link muted" (click)="cancelEdit()">
                  {{ 'common.cancel' | translate }}
                </button>
              </div>
            </form>
          } @else {
            <div [style]="rowStyle">
              <span [style]="nameStyle">{{ m.name }}</span>
              <span class="hint">{{
                'admin.menu.options.countRange' | translate: { min: m.minCount, max: m.maxCount }
              }}</span>
              <span [style]="deltaStyle">{{ formatDelta(m.priceDeltaCents) }}</span>
              <span class="flex items-center" style="gap: 10px">
                <button type="button" class="link" [disabled]="busy()" (click)="editModifier(m)">
                  {{ 'admin.menu.options.edit' | translate }}
                </button>
                <button type="button" class="link danger" [disabled]="busy()" (click)="deleteModifier(m)">
                  {{ 'admin.menu.options.delete' | translate }}
                </button>
              </span>
            </div>
          }
        } @empty {
          @if (!loading()) {
            <p class="hint" style="margin: 0">{{ 'admin.menu.options.noModifiers' | translate }}</p>
          }
        }

        <form [formGroup]="modifierAdd" (ngSubmit)="addModifier()" class="flex flex-col" style="gap: 8px">
          <div class="form-row-tight">
            <label class="field">
              <span class="label">{{ 'admin.menu.options.name' | translate }}</span>
              <input
                class="control small"
                formControlName="name"
                maxlength="80"
                [placeholder]="'admin.menu.options.modPlaceholder' | translate"
              />
            </label>
            <label class="field">
              <span class="label">{{
                'admin.menu.options.priceDelta' | translate: { currency: currencyLabel() }
              }}</span>
              <input
                class="control small"
                formControlName="price"
                inputmode="decimal"
                autocomplete="off"
                placeholder="0"
              />
            </label>
            <label class="field">
              <span class="label">{{ 'admin.menu.options.maxCount' | translate }}</span>
              <input class="control small" formControlName="maxCount" inputmode="numeric" autocomplete="off" />
            </label>
          </div>
          <div class="flex items-center flex-wrap" style="gap: 8px 16px">
            <button type="submit" class="primary small disabled:opacity-50" [disabled]="busy()">
              {{ 'admin.menu.options.addModifier' | translate }}
            </button>
          </div>
          @if (modifierAddSubmitted() && optionError(modifierAdd); as key) {
            <span class="error">{{ key | translate }}</span>
          }
        </form>
      </section>

      @if (error()) {
        <p role="alert" class="error" style="grid-column: 1 / -1; margin: 0; font-size: 13px">{{ error() }}</p>
      }
    </div>
  `,
})
export class ProductOptionsPanelComponent {
  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);

  readonly productId = input.required<string>();
  readonly currency = input<string | null>(null);

  readonly variationTypes = VARIATION_TYPES;
  readonly variations = signal<VariationAdminDto[]>([]);
  readonly modifiers = signal<ModifierAdminDto[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly editingVariationId = signal<string | null>(null);
  readonly editingModifierId = signal<string | null>(null);
  readonly variationAddSubmitted = signal(false);
  readonly variationEditSubmitted = signal(false);
  readonly modifierAddSubmitted = signal(false);
  readonly modifierEditSubmitted = signal(false);
  readonly currencyLabel = computed(() => this.currency() ?? '—');

  readonly variationGroups = computed(() =>
    VARIATION_TYPES.map((type) => ({
      type,
      items: this.variations()
        .filter((v) => v.type === type)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    })).filter((group) => group.items.length > 0),
  );

  readonly headingStyle =
    'margin: 0; font-family: var(--font-sans); font-size: 13px; font-weight: 700; color: var(--color-espresso)';
  readonly rowStyle =
    'display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 10px; padding: 8px 10px';
  readonly nameStyle =
    'flex: 1 1 120px; min-width: 0; overflow-wrap: anywhere; font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-primary)';
  readonly badgeStyle =
    'padding: 2px 8px; border-radius: 9999px; background: var(--color-caramel-light); color: var(--color-caramel); font-family: var(--font-sans); font-size: 10px; font-weight: 700';
  readonly deltaStyle = 'font-family: var(--font-mono); font-size: 12px; color: var(--color-text-secondary)';
  readonly editBoxStyle =
    'display: flex; flex-direction: column; gap: 8px; background: var(--color-foam); border: 1px solid var(--color-caramel); border-radius: 10px; padding: 10px';

  readonly variationAdd = new FormGroup({
    type: new FormControl<VariationType>('SIZE', { nonNullable: true }),
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(60)] }),
    price: new FormControl('', { nonNullable: true, validators: [moneyValidator()] }),
    isDefault: new FormControl(false, { nonNullable: true }),
  });

  readonly variationEdit = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(60)] }),
    price: new FormControl('', { nonNullable: true, validators: [moneyValidator()] }),
    sortOrder: new FormControl('', { nonNullable: true, validators: [countValidator(0, 10_000)] }),
    isDefault: new FormControl(false, { nonNullable: true }),
  });

  readonly modifierAdd = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] }),
    price: new FormControl('', { nonNullable: true, validators: [moneyValidator()] }),
    maxCount: new FormControl('1', { nonNullable: true, validators: [countValidator(1, MAX_COUNT)] }),
  });

  readonly modifierEdit = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] }),
    price: new FormControl('', { nonNullable: true, validators: [moneyValidator()] }),
    minCount: new FormControl('', { nonNullable: true, validators: [countValidator(0, MAX_COUNT)] }),
    maxCount: new FormControl('', { nonNullable: true, validators: [countValidator(1, MAX_COUNT)] }),
    sortOrder: new FormControl('', { nonNullable: true, validators: [countValidator(0, 10_000)] }),
  });

  constructor() {
    effect(() => {
      const id = this.productId();
      untracked(() => {
        this.cancelEdit();
        this.refresh(id);
      });
    });
  }

  formatDelta(cents: number): string {
    if (cents === 0) return this.translate.instant('admin.menu.options.noSurcharge');
    const sign = cents > 0 ? '+' : '−';
    return `${sign}${this.fmt.money(Math.abs(cents), this.currency())}`;
  }

  cancelEdit(): void {
    this.editingVariationId.set(null);
    this.editingModifierId.set(null);
    this.variationEditSubmitted.set(false);
    this.modifierEditSubmitted.set(false);
  }

  addVariation(): void {
    this.variationAddSubmitted.set(true);
    const v = this.variationAdd.getRawValue();
    const priceDeltaCents = v.price.trim() ? parseMoney(v.price) : 0;
    if (this.variationAdd.invalid || priceDeltaCents === null) return;
    this.mutate(
      this.api.createVariation(this.productId(), {
        type: v.type,
        name: v.name.trim(),
        priceDeltaCents,
        isDefault: v.isDefault,
      }),
      () => {
        this.variationAddSubmitted.set(false);
        // Keep the group: several sizes are usually added in a row.
        this.variationAdd.reset({ type: v.type, name: '', price: '', isDefault: false });
      },
    );
  }

  editVariation(v: VariationAdminDto): void {
    this.cancelEdit();
    this.editingVariationId.set(v.id);
    this.variationEdit.reset({
      name: v.name,
      price: formatMoneyInput(v.priceDeltaCents, this.separator()),
      sortOrder: String(v.sortOrder),
      isDefault: v.isDefault,
    });
  }

  saveVariation(v: VariationAdminDto): void {
    this.variationEditSubmitted.set(true);
    const f = this.variationEdit.getRawValue();
    const priceDeltaCents = f.price.trim() ? parseMoney(f.price) : 0;
    const sortOrder = f.sortOrder.trim() ? parseCount(f.sortOrder) : v.sortOrder;
    if (this.variationEdit.invalid || priceDeltaCents === null || sortOrder === null) return;
    this.mutate(
      this.api.updateVariation(v.id, { name: f.name.trim(), priceDeltaCents, sortOrder, isDefault: f.isDefault }),
      () => this.cancelEdit(),
    );
  }

  deleteVariation(v: VariationAdminDto): void {
    if (!confirm(this.translate.instant('admin.menu.options.deleteConfirm', { name: v.name }))) return;
    this.mutate(this.api.deleteVariation(v.id));
  }

  addModifier(): void {
    this.modifierAddSubmitted.set(true);
    const m = this.modifierAdd.getRawValue();
    const priceDeltaCents = m.price.trim() ? parseMoney(m.price) : 0;
    const maxCount = parseCount(m.maxCount, 1, MAX_COUNT);
    if (this.modifierAdd.invalid || priceDeltaCents === null || maxCount === null) return;
    this.mutate(this.api.createModifier(this.productId(), { name: m.name.trim(), priceDeltaCents, maxCount }), () => {
      this.modifierAddSubmitted.set(false);
      this.modifierAdd.reset({ name: '', price: '', maxCount: '1' });
    });
  }

  editModifier(m: ModifierAdminDto): void {
    this.cancelEdit();
    this.editingModifierId.set(m.id);
    this.modifierEdit.reset({
      name: m.name,
      price: formatMoneyInput(m.priceDeltaCents, this.separator()),
      minCount: String(m.minCount),
      maxCount: String(m.maxCount),
      sortOrder: String(m.sortOrder),
    });
  }

  /**
   * The translation key for the first field of an option form that needs
   * fixing. A surcharge cannot be negative — the API refuses it — so the
   * form says so before sending.
   */
  optionError(form: FormGroup): string | null {
    const invalid = (name: string) => form.get(name)?.invalid ?? false;
    if (invalid('name')) return 'admin.menu.errors.name';
    if (invalid('price')) return 'admin.menu.errors.surcharge';
    if (invalid('minCount') || invalid('maxCount') || invalid('sortOrder')) return 'admin.menu.errors.count';
    return null;
  }

  /** The translation key of what is wrong with the modifier being edited, if anything. */
  modifierEditError(): string | null {
    const invalid = this.optionError(this.modifierEdit);
    if (invalid) return invalid;
    const f = this.modifierEdit.getRawValue();
    const min = parseCount(f.minCount);
    const max = parseCount(f.maxCount);
    return min !== null && max !== null && min > max ? 'admin.menu.errors.MODIFIER_RANGE' : null;
  }

  saveModifier(m: ModifierAdminDto): void {
    this.modifierEditSubmitted.set(true);
    if (this.modifierEditError()) return;
    const f = this.modifierEdit.getRawValue();
    const priceDeltaCents = f.price.trim() ? parseMoney(f.price) : 0;
    const minCount = parseCount(f.minCount, 0, MAX_COUNT) ?? m.minCount;
    const maxCount = parseCount(f.maxCount, 1, MAX_COUNT) ?? m.maxCount;
    const sortOrder = parseCount(f.sortOrder) ?? m.sortOrder;
    if (priceDeltaCents === null) return;
    this.mutate(
      this.api.updateModifier(m.id, { name: f.name.trim(), priceDeltaCents, minCount, maxCount, sortOrder }),
      () => this.cancelEdit(),
    );
  }

  deleteModifier(m: ModifierAdminDto): void {
    if (!confirm(this.translate.instant('admin.menu.options.deleteConfirm', { name: m.name }))) return;
    this.mutate(this.api.deleteModifier(m.id));
  }

  /**
   * Runs a change and reloads the product: a new default clears the old
   * one server-side, and a new option gets its position there too, so the
   * server's list is the one worth showing.
   */
  private mutate(request: Observable<unknown>, onSuccess?: () => void): void {
    this.busy.set(true);
    this.error.set(null);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        onSuccess?.();
        this.refresh(this.productId());
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(describeMenuError(err, this.translate));
      },
    });
  }

  private refresh(productId: string): void {
    this.loading.set(true);
    this.api.getProduct(productId).subscribe({
      next: (p) => {
        this.loading.set(false);
        this.variations.set(p.variations ?? []);
        this.modifiers.set(p.modifiers ?? []);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(describeMenuError(err, this.translate));
      },
    });
  }

  private separator(): string {
    return this.translate.getCurrentLang() === 'en' ? '.' : ',';
  }
}
