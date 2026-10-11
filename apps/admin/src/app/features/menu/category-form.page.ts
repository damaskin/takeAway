import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CATEGORY_KINDS, CATEGORY_KIND_PREP_SECONDS, type CategoryKind } from '@takeaway/shared-types';
import { inferCategoryKind } from '@takeaway/utils';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type CategoryAdminDto } from '../../core/catalog/admin-catalog.service';
import { OnboardingFlowService } from '../../core/onboarding/onboarding-flow.service';
import { FormPageComponent } from '../../shared/form-page.component';
import { CategoryOptionsPanelComponent } from './category-options-panel.component';
import { describeMenuError } from './menu-errors';
import { MENU_FORM_STYLES } from './menu-form.styles';
import { formatMinutesInput, minutesValidator, parseMinutes, slugValidator } from './menu-input';

/**
 * Create or rename a menu category, on its own route.
 *
 * This form used to sit at the bottom of the 320px category rail, which is
 * the narrowest column in the admin.
 *
 * "Only as add-ons" is for a category like a POS import's «Дополнительные
 * ингредиенты»: kept for the stop-list and the POS, never on a customer's
 * menu or in a cart. A POS re-sync leaves the choice alone.
 *
 * The kind (hot drinks, food…) decides the fields of its products and the
 * ready-made option set offered below; a new category gets one guessed
 * from its name until the owner picks one. The default preparation time is
 * what a new product of the category starts with — a mixed business makes
 * coffee in 3 minutes and shawarma in 15.
 */
@Component({
  selector: 'app-category-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, FormPageComponent, CategoryOptionsPanelComponent],
  styles: [MENU_FORM_STYLES],
  template: `
    <app-form-page
      [backTo]="['/menu']"
      backLabel="admin.menu.title"
      [title]="isEdit() ? 'admin.menu.category.editTitle' : 'admin.menu.category.newTitle'"
      [titleParams]="{ name: loadedName() ?? '' }"
      [saveLabel]="isEdit() ? 'common.save' : 'admin.menu.create'"
      [saveDisabled]="form.invalid"
      [saving]="saving()"
      [loading]="loading()"
      [error]="error()"
      (save)="submit()"
    >
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col" style="gap: 14px">
        <label class="field">
          <span class="label">{{ 'admin.menu.category.name' | translate }}</span>
          <input
            class="control"
            formControlName="name"
            maxlength="120"
            [placeholder]="'admin.menu.category.namePlaceholder' | translate"
          />
          @if (submitted() && form.controls.name.invalid) {
            <span class="error">{{ 'admin.menu.errors.name' | translate }}</span>
          }
        </label>

        <label class="field">
          <span class="label">{{ 'admin.menu.category.kind' | translate }}</span>
          <select class="control" formControlName="kind" data-testid="category-kind" (change)="kindPicked($event)">
            @for (k of kinds; track k) {
              <option [value]="k">{{ 'admin.menu.kinds.' + k + '.name' | translate }}</option>
            }
          </select>
          <span class="hint">
            {{ 'admin.menu.kinds.' + kind() + '.hint' | translate }}
            @if (kindSuggested()) {
              {{ 'admin.menu.category.kindSuggested' | translate }}
            }
          </span>
        </label>

        <div class="field">
          <label class="field">
            <span class="label">{{ 'admin.menu.category.prep' | translate }}</span>
            <input
              class="control"
              style="max-width: 160px"
              formControlName="prepMinutes"
              inputmode="decimal"
              autocomplete="off"
              data-testid="category-prep"
            />
          </label>
          @if (form.controls.prepMinutes.invalid) {
            <span class="error">{{ 'admin.menu.errors.minutes' | translate }}</span>
          } @else if (suggestedMinutes(); as minutes) {
            <span class="hint">
              {{ 'admin.menu.category.prepHint' | translate: { kind: kindName(), minutes: minutes } }}
              @if (prepDiffersFromSuggestion()) {
                <button type="button" class="link" (click)="useSuggestedPrep()">
                  {{ 'admin.menu.category.prepSuggest' | translate: { minutes: minutes } }}
                </button>
              }
            </span>
          } @else {
            <span class="hint">{{ 'admin.menu.category.prepHintOther' | translate }}</span>
          }
          @if (isEdit() && savedPrepSeconds() !== null) {
            <span class="flex items-center flex-wrap" style="gap: 6px 12px; margin-top: 4px">
              <button
                type="button"
                class="link"
                [disabled]="prepApplying()"
                (click)="applyPrepToProducts()"
                data-testid="category-prep-apply"
              >
                {{ 'admin.menu.category.prepApply' | translate }}
              </button>
              @if (prepNotice(); as notice) {
                <span class="hint" role="status">{{ notice }}</span>
              }
            </span>
          }
        </div>

        <label class="check">
          <input type="checkbox" formControlName="visible" />
          <span>{{ 'admin.menu.fields.visible' | translate }}</span>
        </label>

        <div class="flex flex-col" style="gap: 4px">
          <label class="check">
            <input type="checkbox" formControlName="addOnsOnly" data-testid="category-add-ons-only" />
            <span>{{ 'admin.menu.category.addOnsOnly' | translate }}</span>
          </label>
          <span class="hint" style="padding-left: 22px">{{ 'admin.menu.category.addOnsOnlyHint' | translate }}</span>
        </div>

        <details>
          <summary
            style="cursor: pointer; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
          >
            {{ 'admin.menu.slug.advanced' | translate }}
          </summary>
          <label class="field" style="margin-top: 8px">
            <span class="label">{{ 'admin.menu.slug.label' | translate }}</span>
            <input class="control mono" formControlName="slug" autocomplete="off" [readonly]="isEdit()" />
            @if (form.controls.slug.invalid) {
              <span class="error">{{ 'admin.menu.errors.slug' | translate }}</span>
            } @else {
              <span class="hint">{{ (isEdit() ? 'admin.menu.slug.locked' : 'admin.menu.slug.hint') | translate }}</span>
            }
          </label>
        </details>
      </form>
    </app-form-page>

    @if (loaded(); as category) {
      <section style="padding: 0 clamp(16px, 3vw, 28px) clamp(16px, 3vw, 28px); max-width: 960px; margin: 0 auto">
        <app-category-options-panel
          [categoryId]="category.id"
          [categoryName]="category.name"
          [kind]="savedKind()"
          [brandId]="category.brandId"
          [currency]="currency()"
          [productCount]="category._count?.products ?? null"
        />
      </section>
    }
  `,
})
export class CategoryFormPage {
  readonly categoryId = input<string | undefined>();

  private readonly api = inject(AdminCatalogApi);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly onboarding = inject(OnboardingFlowService);

  readonly kinds = CATEGORY_KINDS;
  readonly isEdit = computed(() => !!this.categoryId());
  readonly loadedName = signal<string | null>(null);
  /** The category as saved; the option set below works on it. */
  readonly loaded = signal<CategoryAdminDto | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly submitted = signal(false);
  readonly error = signal<string | null>(null);
  readonly prepApplying = signal(false);
  readonly prepNotice = signal<string | null>(null);
  /** The owner picked a kind: the name no longer decides it. */
  private readonly kindTouched = signal(false);
  readonly currency = computed(() => this.activeBrand.active()?.currency ?? null);

  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    kind: new FormControl<CategoryKind>('OTHER', { nonNullable: true }),
    prepMinutes: new FormControl('', { nonNullable: true, validators: [minutesValidator] }),
    visible: new FormControl(true, { nonNullable: true }),
    addOnsOnly: new FormControl(false, { nonNullable: true }),
    slug: new FormControl('', { nonNullable: true, validators: [slugValidator] }),
  });

  readonly kind = toSignal(this.form.controls.kind.valueChanges, { initialValue: this.form.controls.kind.value });
  private readonly prepText = toSignal(this.form.controls.prepMinutes.valueChanges, { initialValue: '' });
  /** The kind came from the name of a new category, not from the owner. */
  readonly kindSuggested = computed(() => !this.isEdit() && !this.kindTouched() && this.kind() !== 'OTHER');
  readonly suggestedMinutes = computed(() => {
    const seconds = CATEGORY_KIND_PREP_SECONDS[this.kind()];
    return seconds === null ? null : this.minutesText(seconds);
  });
  readonly prepDiffersFromSuggestion = computed(() => {
    const seconds = CATEGORY_KIND_PREP_SECONDS[this.kind()];
    return seconds !== null && parseMinutes(this.prepText()) !== seconds;
  });
  /** The set offered below follows the saved kind, not one picked and not saved yet. */
  readonly savedKind = computed<CategoryKind>(() => this.loaded()?.kind ?? 'OTHER');
  readonly savedPrepSeconds = computed(() => this.loaded()?.defaultPrepTimeSeconds ?? null);

  constructor() {
    // There is no endpoint for a single category — the list is the only way
    // to read one, and it is small enough that this costs nothing.
    effect(() => {
      const id = this.categoryId();
      const brandId = this.activeBrand.activeId();
      if (!id || !brandId) return;
      this.loading.set(true);
      this.api.listCategories(brandId).subscribe({
        next: (list: CategoryAdminDto[]) => {
          const found = list.find((c) => c.id === id);
          if (found) {
            this.loadedName.set(found.name);
            this.loaded.set(found);
            this.kindTouched.set(true);
            this.form.reset({
              name: found.name,
              kind: found.kind ?? 'OTHER',
              prepMinutes: found.defaultPrepTimeSeconds == null ? '' : this.minutesText(found.defaultPrepTimeSeconds),
              visible: found.visible,
              addOnsOnly: found.addOnsOnly ?? false,
              slug: found.slug,
            });
          } else {
            this.error.set(this.translate.instant('admin.menu.errors.gone'));
          }
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(describeMenuError(err, this.translate));
        },
      });
    });

    // A new category: «Шаурма» suggests food and 15 minutes, until the owner
    // picks a kind or types a time of their own.
    this.form.controls.name.valueChanges.pipe(takeUntilDestroyed()).subscribe((name) => {
      if (this.isEdit() || this.kindTouched()) return;
      const kind = inferCategoryKind(name);
      this.form.controls.kind.setValue(kind);
      this.suggestPrep(kind);
    });
  }

  kindName(): string {
    return this.translate.instant(`admin.menu.kinds.${this.kind()}.name`);
  }

  kindPicked(event: Event): void {
    this.kindTouched.set(true);
    if (!this.isEdit()) this.suggestPrep((event.target as HTMLSelectElement).value as CategoryKind);
  }

  useSuggestedPrep(): void {
    const seconds = CATEGORY_KIND_PREP_SECONDS[this.kind()];
    if (seconds === null) return;
    this.form.controls.prepMinutes.setValue(this.minutesText(seconds));
    this.form.controls.prepMinutes.markAsDirty();
  }

  /** The saved default time onto every product of the category, after a confirm. */
  applyPrepToProducts(): void {
    const category = this.loaded();
    const seconds = this.savedPrepSeconds();
    if (!category || seconds === null) return;
    if (this.form.controls.prepMinutes.dirty) {
      this.prepNotice.set(this.translate.instant('admin.menu.category.prepApplyDirty'));
      return;
    }
    const question = this.translate.instant('admin.menu.category.prepApplyConfirm', {
      minutes: this.minutesText(seconds),
      name: category.name,
    });
    if (!confirm(question)) return;
    this.prepApplying.set(true);
    this.prepNotice.set(null);
    this.api.applyCategoryPrepTime(category.id).subscribe({
      next: ({ products }) => {
        this.prepApplying.set(false);
        this.prepNotice.set(this.translate.instant('admin.menu.category.prepApplied', { count: products }));
      },
      error: (err: unknown) => {
        this.prepApplying.set(false);
        this.prepNotice.set(describeMenuError(err, this.translate));
      },
    });
  }

  submit(): void {
    this.submitted.set(true);
    const brandId = this.activeBrand.activeId();
    if (this.form.invalid || !brandId) return;
    const { name, kind, prepMinutes, visible, addOnsOnly, slug } = this.form.getRawValue();
    const defaultPrepTimeSeconds = prepMinutes.trim() ? parseMinutes(prepMinutes) : null;
    this.saving.set(true);
    this.error.set(null);

    const fail = (err: unknown) => {
      this.saving.set(false);
      this.error.set(describeMenuError(err, this.translate));
    };

    // Opened from «Запуск бренда»: back to it if the menu step is done now.
    const toMenu = (category: string) =>
      void this.onboarding.afterSave('menu').then((r) => {
        if (r !== 'returned') void this.router.navigate(['/menu'], { queryParams: { category } });
      });

    const id = this.categoryId();
    if (id) {
      this.api.updateCategory(id, { name: name.trim(), visible, addOnsOnly, kind, defaultPrepTimeSeconds }).subscribe({
        next: () => toMenu(id),
        error: fail,
      });
      return;
    }
    this.api
      .createCategory({
        brandId,
        name: name.trim(),
        visible,
        addOnsOnly,
        kind,
        ...(defaultPrepTimeSeconds === null ? {} : { defaultPrepTimeSeconds }),
        ...(slug.trim() ? { slug: slug.trim() } : {}),
      })
      .subscribe({
        // The next thing anyone does with a new category is fill it.
        next: (created) => toMenu(created.id),
        error: fail,
      });
  }

  /** Fills the time the kind suggests, unless the owner typed one. */
  private suggestPrep(kind: CategoryKind): void {
    const control = this.form.controls.prepMinutes;
    if (control.dirty) return;
    const seconds = CATEGORY_KIND_PREP_SECONDS[kind] ?? null;
    control.setValue(seconds === null ? '' : this.minutesText(seconds));
  }

  private minutesText(seconds: number): string {
    return formatMinutesInput(seconds, this.translate.getCurrentLang() === 'en' ? '.' : ',');
  }
}
