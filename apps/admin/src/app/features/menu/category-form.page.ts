import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type CategoryAdminDto } from '../../core/catalog/admin-catalog.service';
import { FormPageComponent } from '../../shared/form-page.component';
import { describeMenuError } from './menu-errors';
import { MENU_FORM_STYLES } from './menu-form.styles';
import { slugValidator } from './menu-input';

/**
 * Create or rename a menu category, on its own route.
 *
 * This form used to sit at the bottom of the 320px category rail, which is
 * the narrowest column in the admin.
 */
@Component({
  selector: 'app-category-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, FormPageComponent],
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

        <label class="check">
          <input type="checkbox" formControlName="visible" />
          <span>{{ 'admin.menu.fields.visible' | translate }}</span>
        </label>

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
  `,
})
export class CategoryFormPage {
  readonly categoryId = input<string | undefined>();

  private readonly api = inject(AdminCatalogApi);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);

  readonly isEdit = computed(() => !!this.categoryId());
  readonly loadedName = signal<string | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly submitted = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    visible: new FormControl(true, { nonNullable: true }),
    slug: new FormControl('', { nonNullable: true, validators: [slugValidator] }),
  });

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
            this.form.reset({ name: found.name, visible: found.visible, slug: found.slug });
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
  }

  submit(): void {
    this.submitted.set(true);
    const brandId = this.activeBrand.activeId();
    if (this.form.invalid || !brandId) return;
    const { name, visible, slug } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);

    const fail = (err: unknown) => {
      this.saving.set(false);
      this.error.set(describeMenuError(err, this.translate));
    };

    const id = this.categoryId();
    if (id) {
      this.api.updateCategory(id, { name: name.trim(), visible }).subscribe({
        next: () => this.router.navigate(['/menu'], { queryParams: { category: id } }),
        error: fail,
      });
      return;
    }
    this.api
      .createCategory({ brandId, name: name.trim(), visible, ...(slug.trim() ? { slug: slug.trim() } : {}) })
      .subscribe({
        // The next thing anyone does with a new category is fill it.
        next: (created) => this.router.navigate(['/menu'], { queryParams: { category: created.id } }),
        error: fail,
      });
  }
}
