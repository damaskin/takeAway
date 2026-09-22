import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type CategoryAdminDto } from '../../core/catalog/admin-catalog.service';
import { extractMessage } from '../../core/http/extract-message';
import { FormPageComponent } from '../../shared/form-page.component';
import { slugify } from '../../shared/slugify';

/** Create or rename a menu category, on its own route. */
@Component({
  selector: 'app-category-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, FormPageComponent],
  template: `
    <app-form-page
      [backTo]="['/menu']"
      backLabel="admin.menu.title"
      [title]="isEdit() ? 'admin.menu.category.editTitle' : 'admin.menu.category.createTitle'"
      [saveLabel]="isEdit() ? 'common.save' : 'admin.menu.create'"
      [saveDisabled]="form.invalid"
      [saving]="saving()"
      [loading]="loading()"
      [error]="error()"
      (save)="submit()"
    >
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col" style="gap: 14px">
        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.menu.fields.name' | translate }}</span>
            <input formControlName="name" type="text" class="field-input" (input)="syncSlug()" />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.menu.product.slug' | translate }}</span>
            <input formControlName="slug" type="text" class="field-input field-input-mono" [readonly]="isEdit()" />
          </label>
        </div>

        <label class="flex items-center" style="gap: 8px; font-family: var(--font-sans); font-size: 14px">
          <input type="checkbox" formControlName="visible" />
          <span>{{ 'admin.menu.fields.visible' | translate }}</span>
        </label>
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
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    slug: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[a-z0-9-]+$/)],
    }),
    visible: new FormControl(true, { nonNullable: true }),
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
          if (found) this.form.patchValue({ name: found.name, slug: found.slug, visible: found.visible });
          else this.error.set(this.translate.instant('admin.menu.category.notFound'));
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(extractMessage(err) ?? this.translate.instant('common.requestFailed'));
        },
      });
    });
  }

  /** Fills the slug from the name while it is still untouched. */
  syncSlug(): void {
    if (this.isEdit() || this.form.controls.slug.dirty) return;
    this.form.controls.slug.setValue(slugify(this.form.controls.name.value), { emitEvent: false });
  }

  submit(): void {
    if (this.form.invalid) return;
    const brandId = this.activeBrand.activeId();
    if (!brandId) {
      this.error.set(this.translate.instant('admin.brandContext.noBrandsHint'));
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    const { name, slug, visible } = this.form.getRawValue();

    const id = this.categoryId();
    const done = {
      next: () => this.router.navigate(['/menu']),
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(extractMessage(err) ?? this.translate.instant('common.requestFailed'));
      },
    };

    if (id) this.api.updateCategory(id, { name, visible }).subscribe(done);
    else this.api.createCategory({ brandId, name, slug }).subscribe(done);
  }
}
