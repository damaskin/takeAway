import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import { CATEGORY_KINDS, type CategoryKind, MODIFIER_GROUP_MAX_LENGTH } from '@takeaway/shared-types';
import type { Observable } from 'rxjs';

import { AdminCatalogApi, type CategoryOptionDto, type IngredientDto } from '../../core/catalog/admin-catalog.service';
import {
  buildPresetPreview,
  groupOptions,
  presetPreviewOptions,
  type PresetPreviewRow,
} from './category-preset-preview';
import { describeMenuError } from './menu-errors';
import { MENU_FORM_STYLES } from './menu-form.styles';
import { formatMoneyInput, moneyValidator, parseMoney } from './menu-input';

/** Kinds that have a ready-made set: what an OTHER category may borrow from. */
const PRESET_KINDS = CATEGORY_KINDS.filter((k) => k !== 'OTHER');

/**
 * «Опции категории»: the options a category's products are meant to have,
 * set up once instead of on every product. It usually starts from the
 * platform preset of the category's kind — previewed, unticked where the
 * business does not sell something, priced, then saved; add-ons the brand
 * library has are reused at their price, missing ones join the library.
 *
 * Saving the set changes no product. A new product of the category gets a
 * copy when it is created; «Применить к товарам категории» copies what each
 * existing product lacks, never removing or repricing what it has.
 */
@Component({
  selector: 'app-category-options-panel',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  styles: [
    MENU_FORM_STYLES,
    `
      .panel {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: clamp(16px, 2.5vw, 24px);
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: 18px;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 10px;
        padding: 8px 10px;
        background: var(--color-cream);
        border-radius: 10px;
      }
      .name {
        flex: 1 1 140px;
        min-width: 0;
        overflow-wrap: anywhere;
        font: 500 13px var(--font-sans);
        color: var(--color-text-primary);
      }
      .delta {
        font: 12px var(--font-mono);
        color: var(--color-text-secondary);
      }
      .badge {
        padding: 2px 8px;
        border-radius: 9999px;
        background: var(--color-caramel-light);
        color: var(--color-caramel);
        font: 700 10px var(--font-sans);
      }
      .badge.muted {
        background: var(--color-foam);
        color: var(--color-text-tertiary);
      }
      .badge.out {
        background: #d94b5e1a;
        color: var(--color-berry);
      }
      .group-label {
        font: 700 12px var(--font-sans);
        color: var(--color-espresso);
      }
      .price-input {
        width: 96px;
      }
      .preview {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 14px;
        border: 1px solid var(--color-caramel);
        border-radius: 14px;
      }
    `,
  ],
  template: `
    <section class="panel" data-testid="category-options">
      <div class="flex flex-col" style="gap: 4px">
        <h2 style="margin: 0; font: 700 18px var(--font-display); color: var(--color-espresso)">
          {{ 'admin.menu.categoryOptions.title' | translate }}
        </h2>
        <p class="hint" style="margin: 0">{{ 'admin.menu.categoryOptions.hint' | translate }}</p>
      </div>

      @if (loading()) {
        <p class="hint" style="margin: 0">{{ 'common.loading' | translate }}</p>
      } @else if (options().length === 0 && !preview()) {
        <p class="hint" style="margin: 0">{{ 'admin.menu.categoryOptions.empty' | translate }}</p>
      }

      @for (group of setGroups(); track group.key) {
        <div class="flex flex-col" style="gap: 6px" data-testid="category-option-group">
          <span class="group-label">{{ groupLabel(group.variationType, group.group) }}</span>
          @for (o of group.items; track o.id) {
            @if (editingId() === o.id) {
              <form [formGroup]="edit" (ngSubmit)="saveEdit(o)" class="row" style="background: var(--color-foam)">
                <span class="name">{{ o.name }}</span>
                <label class="field">
                  <span class="label">{{
                    'admin.menu.options.priceDelta' | translate: { currency: currencyLabel() }
                  }}</span>
                  <input class="control small price-input" formControlName="price" inputmode="decimal" />
                </label>
                @if (o.kind === 'MODIFIER') {
                  <label class="field" style="flex: 1 1 140px">
                    <span class="label">{{ 'admin.menu.options.group' | translate }}</span>
                    <input
                      class="control small"
                      formControlName="group"
                      [attr.maxlength]="groupMaxLength"
                      [placeholder]="'admin.menu.options.defaultGroup' | translate"
                    />
                  </label>
                } @else {
                  <label class="check">
                    <input type="checkbox" formControlName="isDefault" />
                    <span>{{ 'admin.menu.options.default' | translate }}</span>
                  </label>
                }
                <button type="submit" class="primary small" [disabled]="busy()">{{ 'common.save' | translate }}</button>
                <button type="button" class="link muted" (click)="editingId.set(null)">
                  {{ 'common.cancel' | translate }}
                </button>
                @if (edit.controls.price.invalid) {
                  <span class="error" style="flex-basis: 100%">{{ 'admin.menu.errors.surcharge' | translate }}</span>
                }
              </form>
            } @else {
              <div class="row" data-testid="category-option">
                <span class="name">{{ o.name }}</span>
                @if (o.isDefault) {
                  <span class="badge">{{ 'admin.menu.options.default' | translate }}</span>
                }
                @if (o.ingredient && !o.ingredient.isAvailable) {
                  <span class="badge out">{{ 'admin.menu.options.outOfStock' | translate }}</span>
                }
                <span class="delta">{{ formatDelta(o.priceDeltaCents) }}</span>
                <span class="flex items-center" style="gap: 10px">
                  <button type="button" class="link" [disabled]="busy()" (click)="startEdit(o)">
                    {{ 'admin.menu.options.edit' | translate }}
                  </button>
                  <button type="button" class="link danger" [disabled]="busy()" (click)="remove(o)">
                    {{ 'admin.menu.options.delete' | translate }}
                  </button>
                </span>
              </div>
            }
          }
        </div>
      }

      @if (preview(); as rows) {
        <div class="preview" data-testid="category-preset-preview">
          <div class="flex flex-col" style="gap: 2px">
            <strong style="font: 700 14px var(--font-sans); color: var(--color-espresso)">
              {{ 'admin.menu.categoryOptions.previewTitle' | translate: { kind: kindName(previewKind()) } }}
            </strong>
            <span class="hint">{{ 'admin.menu.categoryOptions.previewHint' | translate }}</span>
          </div>
          @for (group of previewGroups(); track group.key) {
            <div class="flex flex-col" style="gap: 6px">
              <span class="group-label">{{ previewGroupLabel(group.items[0]) }}</span>
              @for (row of group.items; track row.key) {
                <label class="row" [style.opacity]="row.inSet ? 0.6 : 1">
                  <input
                    type="checkbox"
                    [checked]="row.include"
                    [disabled]="row.inSet"
                    (change)="toggleRow(row.key, $event)"
                    [attr.aria-label]="row.name"
                  />
                  <span class="name">{{ row.name }}</span>
                  @if (row.isDefault) {
                    <span class="badge">{{ 'admin.menu.options.default' | translate }}</span>
                  }
                  @if (row.inSet) {
                    <span class="badge muted">{{ 'admin.menu.categoryOptions.inSet' | translate }}</span>
                  } @else {
                    @if (row.ingredientId) {
                      <span class="badge muted">{{ 'admin.menu.categoryOptions.fromLibrary' | translate }}</span>
                    }
                    <input
                      class="control small price-input"
                      inputmode="decimal"
                      autocomplete="off"
                      [value]="row.price"
                      [disabled]="!row.include"
                      (input)="priceRow(row.key, $event)"
                      [attr.aria-label]="'admin.menu.options.priceDelta' | translate: { currency: currencyLabel() }"
                    />
                  }
                </label>
              }
            </div>
          }
          @if (previewError()) {
            <span class="error">{{ 'admin.menu.errors.surcharge' | translate }}</span>
          }
          <div class="flex items-center flex-wrap" style="gap: 8px 12px">
            <button
              type="button"
              class="primary small disabled:opacity-50"
              [disabled]="busy() || picked() === 0"
              (click)="savePreview()"
              data-testid="category-preset-save"
            >
              {{ 'admin.menu.categoryOptions.save' | translate: { count: picked() } }}
            </button>
            <button type="button" class="link muted" (click)="preview.set(null)">
              {{ 'common.cancel' | translate }}
            </button>
          </div>
        </div>
      } @else {
        <div class="flex items-end flex-wrap" style="gap: 8px 12px">
          @if (kind() === 'OTHER') {
            <label class="field">
              <span class="label">{{ 'admin.menu.categoryOptions.presetKind' | translate }}</span>
              <select class="control small" [value]="borrowKind()" (change)="borrowKind.set($any($event.target).value)">
                @for (k of presetKinds; track k) {
                  <option [value]="k" [selected]="k === borrowKind()">
                    {{ 'admin.menu.kinds.' + k + '.name' | translate }}
                  </option>
                }
              </select>
            </label>
          }
          <button
            type="button"
            class="primary small disabled:opacity-50"
            [disabled]="busy() || loading()"
            (click)="startPreview()"
            data-testid="category-preset-start"
          >
            {{ 'admin.menu.categoryOptions.addPreset' | translate: { kind: kindName(presetKind()) } }}
          </button>
          @if (options().length > 0) {
            <button
              type="button"
              class="primary small disabled:opacity-50"
              style="background: var(--color-espresso)"
              [disabled]="busy()"
              (click)="apply()"
              data-testid="category-options-apply"
            >
              {{ 'admin.menu.categoryOptions.apply' | translate }}
            </button>
          }
        </div>
        @if (kind() === 'OTHER') {
          <span class="hint">{{ 'admin.menu.categoryOptions.noPreset' | translate }}</span>
        }
      }

      @if (options().length > 0) {
        <span class="hint">
          {{ 'admin.menu.categoryOptions.sizesNote' | translate }}
          @if (productCount() === 0) {
            {{ 'admin.menu.categoryOptions.noProducts' | translate }}
          }
        </span>
      }
      @if (notice(); as text) {
        <p class="notice" role="status" data-testid="category-options-notice">{{ text }}</p>
      }
      @if (error(); as text) {
        <p role="alert" class="error" style="margin: 0; font-size: 13px">{{ text }}</p>
      }
    </section>
  `,
})
export class CategoryOptionsPanelComponent {
  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);

  readonly categoryId = input.required<string>();
  readonly categoryName = input.required<string>();
  /** The saved kind of the category: whose preset is offered. */
  readonly kind = input<CategoryKind>('OTHER');
  readonly brandId = input.required<string>();
  readonly currency = input<string | null>(null);
  readonly productCount = input<number | null>(null);

  readonly presetKinds = PRESET_KINDS;
  readonly groupMaxLength = MODIFIER_GROUP_MAX_LENGTH;
  readonly options = signal<CategoryOptionDto[]>([]);
  readonly library = signal<IngredientDto[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly preview = signal<PresetPreviewRow[] | null>(null);
  readonly previewKind = signal<CategoryKind>('OTHER');
  readonly previewError = signal(false);
  readonly editingId = signal<string | null>(null);
  /** For an OTHER category: whose preset to borrow. */
  readonly borrowKind = signal<CategoryKind>('HOT_DRINKS');

  readonly currencyLabel = computed(() => this.currency() ?? '—');
  readonly presetKind = computed<CategoryKind>(() => (this.kind() === 'OTHER' ? this.borrowKind() : this.kind()));
  readonly setGroups = computed(() => groupOptions(this.options()));
  readonly previewGroups = computed(() => {
    const groups: Array<{ key: string; items: PresetPreviewRow[] }> = [];
    for (const row of this.preview() ?? []) {
      const found = groups.find((g) => g.key === row.groupKey);
      if (found) found.items.push(row);
      else groups.push({ key: row.groupKey, items: [row] });
    }
    return groups;
  });
  readonly picked = computed(() => (this.preview() ?? []).filter((r) => r.include && !r.inSet).length);

  readonly edit = new FormGroup({
    price: new FormControl('', { nonNullable: true, validators: [moneyValidator()] }),
    group: new FormControl('', { nonNullable: true }),
    isDefault: new FormControl(false, { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      const id = this.categoryId();
      const brandId = this.brandId();
      untracked(() => this.load(id, brandId));
    });
  }

  kindName(kind: CategoryKind): string {
    return this.translate.instant(`admin.menu.kinds.${kind}.name`);
  }

  groupLabel(variationType: string | null, group: string | null): string {
    if (variationType) return this.translate.instant(`admin.menu.options.types.${variationType}`);
    return group ?? this.translate.instant('admin.menu.options.defaultGroup');
  }

  previewGroupLabel(row: PresetPreviewRow | undefined): string {
    if (!row) return '';
    return row.kind === 'VARIATION' && row.variationType
      ? this.translate.instant(`admin.menu.options.types.${row.variationType}`)
      : row.groupName;
  }

  formatDelta(cents: number): string {
    if (cents === 0) return this.translate.instant('admin.menu.options.noSurcharge');
    return `+${this.fmt.money(cents, this.currency())}`;
  }

  startPreview(): void {
    const kind = this.presetKind();
    this.notice.set(null);
    this.previewError.set(false);
    this.previewKind.set(kind);
    const lang = this.translate.getCurrentLang() === 'en' ? 'en' : 'ru';
    this.preview.set(buildPresetPreview(kind, lang, this.library(), this.options(), this.separator()));
  }

  toggleRow(key: string, event: Event): void {
    const include = (event.target as HTMLInputElement).checked;
    this.preview.update((rows) => rows?.map((r) => (r.key === key ? { ...r, include } : r)) ?? null);
  }

  priceRow(key: string, event: Event): void {
    const price = (event.target as HTMLInputElement).value;
    this.preview.update((rows) => rows?.map((r) => (r.key === key ? { ...r, price } : r)) ?? null);
  }

  /** Stores the ticked options as the set (missing add-ons join the library at the price typed). */
  savePreview(): void {
    const options = presetPreviewOptions(this.preview() ?? []);
    this.previewError.set(options === null);
    if (!options || options.length === 0) return;
    this.run(this.api.addCategoryOptions(this.categoryId(), options), (set) => {
      this.options.set(set);
      this.preview.set(null);
      this.notice.set(this.translate.instant('admin.menu.categoryOptions.saved'));
      // New add-ons joined the library: the next preview should reuse them.
      this.loadLibrary(this.brandId());
    });
  }

  startEdit(option: CategoryOptionDto): void {
    this.editingId.set(option.id);
    this.edit.reset({
      price: formatMoneyInput(option.priceDeltaCents, this.separator()),
      group: option.group ?? '',
      isDefault: option.isDefault,
    });
  }

  saveEdit(option: CategoryOptionDto): void {
    const { price, group, isDefault } = this.edit.getRawValue();
    const priceDeltaCents = price.trim() ? parseMoney(price) : 0;
    if (this.edit.invalid || priceDeltaCents === null) return;
    const change =
      option.kind === 'MODIFIER' ? { priceDeltaCents, group: group.trim() || null } : { priceDeltaCents, isDefault };
    this.run(this.api.updateCategoryOption(this.categoryId(), option.id, change), (set) => {
      this.options.set(set);
      this.editingId.set(null);
    });
  }

  remove(option: CategoryOptionDto): void {
    if (!confirm(this.translate.instant('admin.menu.categoryOptions.deleteConfirm', { name: option.name }))) return;
    this.run(this.api.deleteCategoryOption(this.categoryId(), option.id), () =>
      this.options.update((list) => list.filter((o) => o.id !== option.id)),
    );
  }

  /** Copies what each product of the category lacks; nothing is removed or repriced. */
  apply(): void {
    const question = this.translate.instant('admin.menu.categoryOptions.applyConfirm', {
      name: this.categoryName(),
    });
    if (!confirm(question)) return;
    this.run(this.api.applyCategoryOptions(this.categoryId()), (result) => {
      this.notice.set(
        result.products === 0
          ? this.translate.instant('admin.menu.categoryOptions.appliedNothing')
          : this.translate.instant('admin.menu.categoryOptions.applied', result),
      );
    });
  }

  private run<T>(request: Observable<T>, onSuccess: (value: T) => void): void {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    request.subscribe({
      next: (value) => {
        this.busy.set(false);
        onSuccess(value);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(describeMenuError(err, this.translate));
      },
    });
  }

  private load(categoryId: string, brandId: string): void {
    this.loading.set(true);
    this.preview.set(null);
    this.api.listCategoryOptions(categoryId).subscribe({
      next: (set) => {
        this.loading.set(false);
        this.options.set(set);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(describeMenuError(err, this.translate));
      },
    });
    this.loadLibrary(brandId);
  }

  private loadLibrary(brandId: string): void {
    this.api.listIngredients(brandId).subscribe({
      next: (list) => this.library.set(list),
      // Without the library every preset add-on is simply offered as new.
      error: () => this.library.set([]),
    });
  }

  private separator(): string {
    return this.translate.getCurrentLang() === 'en' ? '.' : ',';
  }
}
