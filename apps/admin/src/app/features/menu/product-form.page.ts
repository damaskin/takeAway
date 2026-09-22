import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type CategoryAdminDto } from '../../core/catalog/admin-catalog.service';
import { extractMessage } from '../../core/http/extract-message';
import { FormPageComponent } from '../../shared/form-page.component';
import { slugify } from '../../shared/slugify';

/**
 * Create or edit a product, on its own route.
 *
 * The category used to be whichever one the rail happened to have selected.
 * Here it is a field like any other, so the form works when opened straight
 * from a link and says plainly where the product will end up.
 */
@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, FormPageComponent],
  template: `
    <app-form-page
      [backTo]="['/menu']"
      backLabel="admin.menu.title"
      [title]="isEdit() ? 'admin.menu.product.editTitle' : 'admin.menu.product.createTitle'"
      [subtitle]="loadedName()"
      [saveLabel]="isEdit() ? 'common.save' : 'admin.menu.product.createCta'"
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

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.menu.product.category' | translate }}</span>
            <select formControlName="categoryId" class="field-input">
              @for (c of categories(); track c.id) {
                <option [value]="c.id">{{ c.name }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.menu.product.price' | translate }}</span>
            <input formControlName="basePriceCents" type="number" min="0" class="field-input field-input-mono" />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.menu.product.prep' | translate }}</span>
            <input formControlName="prepTimeSeconds" type="number" min="0" class="field-input field-input-mono" />
          </label>
        </div>

        <label class="field">
          <span class="field-label">{{ 'admin.menu.product.description' | translate }}</span>
          <textarea formControlName="description" rows="3" class="field-input"></textarea>
        </label>
      </form>

      @if (isEdit()) {
        <a
          formPageExtraActions
          [routerLink]="['/menu/products', productId(), 'options']"
          style="height: 40px; padding: 0 18px; display: inline-flex; align-items: center; background: var(--color-caramel-light); color: var(--color-caramel); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; text-decoration: none"
        >
          {{ 'admin.menu.product.options' | translate }}
        </a>
      }
    </app-form-page>
  `,
})
export class ProductFormPage {
  readonly productId = input<string | undefined>();
  /** Pre-selects the category the user was looking at, when there was one. */
  readonly categoryId = input<string | undefined>();

  private readonly api = inject(AdminCatalogApi);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);

  readonly isEdit = computed(() => !!this.productId());
  readonly categories = signal<CategoryAdminDto[]>([]);
  readonly loadedName = signal<string | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    slug: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[a-z0-9-]+$/)],
    }),
    categoryId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    basePriceCents: new FormControl(0, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    prepTimeSeconds: new FormControl(180, { nonNullable: true, validators: [Validators.min(0)] }),
    description: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      const brandId = this.activeBrand.activeId();
      if (!brandId) return;
      this.api.listCategories(brandId).subscribe({
        next: (list) => {
          this.categories.set(list);
          const preset = this.categoryId();
          if (!this.form.controls.categoryId.value) {
            this.form.controls.categoryId.setValue(preset ?? list[0]?.id ?? '');
          }
        },
        error: (err) => this.error.set(extractMessage(err) ?? this.translate.instant('common.requestFailed')),
      });
    });

    effect(() => {
      const id = this.productId();
      if (!id) return;
      this.loading.set(true);
      this.api.getProduct(id).subscribe({
        next: (p) => {
          this.loadedName.set(p.name);
          this.form.patchValue({
            name: p.name,
            slug: p.slug,
            categoryId: p.categoryId,
            basePriceCents: p.basePriceCents,
            prepTimeSeconds: p.prepTimeSeconds,
            description: p.description ?? '',
          });
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(extractMessage(err) ?? this.translate.instant('common.requestFailed'));
        },
      });
    });
  }

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
    const v = this.form.getRawValue();

    const done = {
      next: () => this.router.navigate(['/menu'], { queryParams: { category: v.categoryId } }),
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(extractMessage(err) ?? this.translate.instant('common.requestFailed'));
      },
    };

    const id = this.productId();
    if (id) {
      this.api
        .updateProduct(id, {
          name: v.name,
          categoryId: v.categoryId,
          basePriceCents: Number(v.basePriceCents),
          prepTimeSeconds: Number(v.prepTimeSeconds),
          description: v.description || null,
        })
        .subscribe(done);
      return;
    }
    this.api
      .createProduct({
        brandId,
        categoryId: v.categoryId,
        name: v.name,
        slug: v.slug,
        basePriceCents: Number(v.basePriceCents),
        prepTimeSeconds: Number(v.prepTimeSeconds),
        description: v.description || undefined,
      })
      .subscribe(done);
  }
}
