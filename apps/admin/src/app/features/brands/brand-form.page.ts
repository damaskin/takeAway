import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { BrandsService } from '../../core/brands/brands.service';
import { BRAND_CURRENCIES } from '../../core/business/business.service';
import { extractMessage } from '../../core/http/extract-message';
import { FormPageComponent } from '../../shared/form-page.component';
import { slugify } from '../../shared/slugify';

/** Create a brand, on its own route. */
@Component({
  selector: 'app-brand-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, FormPageComponent],
  template: `
    <app-form-page
      [backTo]="['/brands']"
      backLabel="admin.brands.title"
      title="admin.brands.create.cta"
      [subtitle]="hint()"
      saveLabel="admin.brands.create.submit"
      [saveDisabled]="form.invalid"
      [saving]="creating()"
      [error]="error()"
      (save)="submit()"
    >
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col" style="gap: 14px">
        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.brands.create.name' | translate }}</span>
            <input formControlName="name" type="text" class="field-input" (input)="syncSlug()" />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.brands.create.slug' | translate }}</span>
            <input formControlName="slug" type="text" class="field-input field-input-mono" />
          </label>
        </div>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.brands.create.currency' | translate }}</span>
            <select formControlName="currency" class="field-input">
              @for (c of currencies; track c) {
                <option [value]="c">{{ 'admin.currencies.' + c | translate }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.brands.create.locale' | translate }}</span>
            <select formControlName="locale" class="field-input">
              <option value="RU">{{ 'admin.languages.RU' | translate }}</option>
              <option value="EN">{{ 'admin.languages.EN' | translate }}</option>
            </select>
          </label>
        </div>
      </form>
    </app-form-page>
  `,
})
export class BrandFormPage {
  private readonly brands = inject(BrandsService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);

  readonly currencies = BRAND_CURRENCIES;
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);

  readonly hint = signal<string>(this.translate.instant('admin.brands.create.hint'));

  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    slug: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.pattern(/^[a-z0-9-]+$/)],
    }),
    currency: new FormControl<string>('MDL', { nonNullable: true }),
    locale: new FormControl<'EN' | 'RU'>('RU', { nonNullable: true }),
  });

  /** Keeps the slug in step with the name until the operator edits it. */
  syncSlug(): void {
    const slug = this.form.controls.slug;
    if (slug.dirty) return;
    slug.setValue(slugify(this.form.controls.name.value), { emitEvent: false });
  }

  submit(): void {
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    this.creating.set(true);
    this.error.set(null);
    this.brands.create({ name: v.name.trim(), slug: v.slug.trim(), currency: v.currency, locale: v.locale }).subscribe({
      next: (brand) => {
        // Make it the context the rest of the panel works in, so stores
        // and menu are immediately usable without a reload.
        this.activeBrand.adopt({
          id: brand.id,
          slug: brand.slug,
          name: brand.name,
          currency: brand.currency,
          locale: brand.locale,
          logoUrl: null,
        });
        this.router.navigate(['/brands']);
      },
      error: (err) => {
        this.creating.set(false);
        this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
      },
    });
  }
}
