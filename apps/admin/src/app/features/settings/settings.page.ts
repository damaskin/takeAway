import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { MyBrand, SettingsService } from '../../core/settings/settings.service';

/**
 * Brand settings — the BRAND_ADMIN manages their own brand identity
 * (name, logo, theme overrides). SUPER_ADMIN uses the dedicated
 * /admin/brands moderation UI instead.
 *
 * `themeOverrides` is exposed as a small fixed list of well-known CSS
 * variables + a free-form JSON fallback (advanced) so non-technical
 * brand owners don't have to hand-edit JSON for the common case.
 */
const THEME_FIELDS: ReadonlyArray<{ cssVar: string; labelKey: string }> = [
  { cssVar: '--color-caramel', labelKey: 'admin.settings.theme.caramel' },
  { cssVar: '--color-cream', labelKey: 'admin.settings.theme.cream' },
  { cssVar: '--color-foam', labelKey: 'admin.settings.theme.foam' },
  { cssVar: '--color-espresso', labelKey: 'admin.settings.theme.espresso' },
];

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  styles: [
    `
      .status-pill[data-status='PENDING'] {
        background: var(--color-amber);
        color: white;
      }
      .status-pill[data-status='APPROVED'] {
        background: var(--color-mint);
        color: white;
      }
      .status-pill[data-status='REJECTED'] {
        background: var(--color-berry);
        color: white;
      }
    `,
  ],
  template: `
    <section style="padding: 32px; max-width: 780px">
      <h1 style="font-family: var(--font-display); font-size: 28px; color: var(--color-espresso); margin: 0 0 8px">
        {{ 'admin.settings.title' | translate }}
      </h1>
      <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0 0 24px">
        {{ 'admin.settings.subtitle' | translate }}
      </p>

      @if (loading()) {
        <p style="color: var(--color-text-secondary)">{{ 'common.loading' | translate }}</p>
      } @else if (brand()) {
        <form
          [formGroup]="form"
          (ngSubmit)="save()"
          class="flex flex-col"
          style="gap: 20px; background: var(--color-foam); border-radius: var(--radius-card); padding: 24px; box-shadow: var(--shadow-soft)"
        >
          <div class="flex items-center" style="gap: 16px">
            <div
              [attr.data-status]="brand()!.moderationStatus"
              class="status-pill"
              style="font-family: var(--font-sans); font-size: 13px; padding: 6px 12px; border-radius: 999px; font-weight: 600"
            >
              {{ 'admin.brands.status.' + brand()!.moderationStatus | translate }}
            </div>
            <span style="font-family: var(--font-mono); font-size: 12px; color: var(--color-text-tertiary)">{{
              brand()!.slug
            }}</span>
          </div>

          @if (brand()!.moderationStatus === 'PENDING') {
            <div
              style="background: var(--color-cream); border-left: 3px solid var(--color-amber); padding: 12px 16px; border-radius: 8px"
            >
              <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary); margin: 0">
                {{ 'admin.settings.pendingNotice' | translate }}
              </p>
            </div>
          } @else if (brand()!.moderationStatus === 'REJECTED') {
            <div
              style="background: var(--color-cream); border-left: 3px solid var(--color-berry); padding: 12px 16px; border-radius: 8px"
            >
              <p
                style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0 0 6px; font-weight: 600"
              >
                {{ 'admin.settings.rejectedTitle' | translate }}
              </p>
              @if (brand()!.moderationNote) {
                <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary); margin: 0">
                  {{ brand()!.moderationNote }}
                </p>
              } @else {
                <p
                  style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0"
                >
                  {{ 'admin.settings.rejectedGeneric' | translate }}
                </p>
              }
            </div>
          }

          <label class="flex flex-col" style="gap: 6px">
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
              'admin.settings.brandName' | translate
            }}</span>
            <input
              formControlName="name"
              type="text"
              style="height: 44px; padding: 0 14px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 15px; outline: none"
            />
          </label>

          <label class="flex flex-col" style="gap: 6px">
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
              'admin.settings.logoUrl' | translate
            }}</span>
            <input
              formControlName="logoUrl"
              type="url"
              placeholder="https://…"
              style="height: 44px; padding: 0 14px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-mono); font-size: 13px; outline: none"
            />
          </label>

          <fieldset style="border: 1px solid var(--color-border); border-radius: 12px; padding: 16px; margin: 0">
            <legend
              style="padding: 0 6px; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
            >
              {{ 'admin.settings.theme.title' | translate }}
            </legend>
            <p
              style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); margin: 0 0 12px"
            >
              {{ 'admin.settings.theme.hint' | translate }}
            </p>
            <div class="flex flex-col" style="gap: 10px" [formGroupName]="'themeOverrides'">
              @for (f of themeFields; track f.cssVar) {
                <label class="flex items-center" style="gap: 12px">
                  <span
                    class="flex-1"
                    style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary)"
                    >{{ f.labelKey | translate }}</span
                  >
                  <input
                    [formControlName]="f.cssVar"
                    type="color"
                    style="width: 48px; height: 36px; padding: 0; border: 1px solid var(--color-border); border-radius: 8px; background: transparent; cursor: pointer"
                  />
                  <input
                    [formControlName]="f.cssVar"
                    type="text"
                    placeholder="#c77d3b"
                    style="width: 120px; height: 36px; padding: 0 10px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-mono); font-size: 12px; outline: none"
                  />
                </label>
              }
            </div>
          </fieldset>

          <div class="flex items-center" style="gap: 12px">
            <button
              type="submit"
              [disabled]="form.invalid || saving()"
              class="disabled:opacity-50"
              style="padding: 10px 20px; background: var(--color-caramel); color: white; border: 0; border-radius: var(--radius-button); font-family: var(--font-sans); font-weight: 600; cursor: pointer"
            >
              {{ (saving() ? 'admin.settings.saving' : 'common.save') | translate }}
            </button>
            @if (saved()) {
              <span style="color: var(--color-mint); font-family: var(--font-sans); font-size: 13px">{{
                'admin.settings.saved' | translate
              }}</span>
            }
          </div>

          @if (error()) {
            <p style="color: var(--color-berry); font-family: var(--font-sans); font-size: 13px; margin: 0">
              {{ error() }}
            </p>
          }
        </form>
      } @else if (error()) {
        <p style="color: var(--color-berry)">{{ error() }}</p>
      }
    </section>
  `,
})
export class AdminSettingsPage {
  private readonly settings = inject(SettingsService);
  private readonly translate = inject(TranslateService);

  readonly themeFields = THEME_FIELDS;
  readonly brand = signal<MyBrand | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly error = signal<string | null>(null);

  readonly form: FormGroup<{
    name: FormControl<string>;
    logoUrl: FormControl<string>;
    themeOverrides: FormGroup<Record<string, FormControl<string>>>;
  }>;

  readonly hasChanges = computed(() => this.form.dirty);

  constructor() {
    const themeCtrls: Record<string, FormControl<string>> = {};
    for (const f of THEME_FIELDS) {
      themeCtrls[f.cssVar] = new FormControl('', { nonNullable: true });
    }
    this.form = new FormGroup({
      name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
      logoUrl: new FormControl('', { nonNullable: true }),
      themeOverrides: new FormGroup(themeCtrls),
    });

    this.settings.getMyBrand().subscribe({
      next: (brand) => {
        this.brand.set(brand);
        this.form.patchValue({
          name: brand.name,
          logoUrl: brand.logoUrl ?? '',
        });
        if (brand.themeOverrides) {
          const group = this.form.controls.themeOverrides;
          for (const [k, v] of Object.entries(brand.themeOverrides)) {
            const ctrl = group.get(k);
            if (ctrl) ctrl.setValue(v);
          }
        }
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(this.extractMessage(err));
      },
    });
  }

  save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    const v = this.form.getRawValue();
    const overrides: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.themeOverrides)) {
      if (typeof val === 'string' && val.trim()) overrides[k] = val.trim();
    }
    this.settings
      .updateMyBrand({
        name: v.name.trim(),
        logoUrl: v.logoUrl.trim() || undefined,
        themeOverrides: overrides,
      })
      .subscribe({
        next: (updated) => {
          this.brand.set({ ...this.brand()!, ...updated });
          this.saving.set(false);
          this.saved.set(true);
          setTimeout(() => this.saved.set(false), 3000);
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(this.extractMessage(err));
        },
      });
  }

  private extractMessage(err: unknown): string {
    const maybe = err as { error?: { message?: unknown }; message?: unknown };
    if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
    if (Array.isArray(maybe.error?.message) && maybe.error.message.length) return maybe.error.message[0] as string;
    if (typeof maybe.message === 'string') return maybe.message;
    return this.translate.instant('common.genericError');
  }
}
