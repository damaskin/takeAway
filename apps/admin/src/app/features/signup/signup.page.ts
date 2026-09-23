import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  type AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  type ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import {
  BRAND_CURRENCIES,
  type BrandCurrency,
  type BrandLocale,
  BusinessService,
} from '../../core/business/business.service';
import { apiErrorCode, invalidFields } from '../../core/http/api-error';

/** Conflicts the API explains with a code; each has its own sentence in `admin.signup.errors`. */
const KNOWN_CONFLICTS = new Set(['EMAIL_TAKEN', 'EMAIL_CUSTOMER_ACCOUNT', 'PHONE_TAKEN']);

const SIGNUP_FIELDS = new Set(['brandName', 'ownerName', 'email', 'password', 'phone', 'currency', 'locale']);

/**
 * Self-serve business registration that lands the brand owner directly
 * on their dashboard with a hot session, where the launch checklist tells
 * them what to do next.
 *
 * The brand starts in `PENDING` moderation status; the storefront won't
 * show it to customers until a SUPER_ADMIN approves, but the owner can set
 * up the store and menu while waiting.
 */
@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [ReactiveFormsModule, LanguageSwitcherComponent, TranslatePipe, RouterLink],
  template: `
    <main
      class="min-h-screen flex items-center justify-center"
      style="background: var(--color-cream); padding: 32px 16px"
    >
      <section
        class="w-full"
        style="max-width: 480px; background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft); padding: 32px"
      >
        <div class="flex items-center justify-between" style="margin-bottom: 8px; gap: 12px">
          <h1 style="font-family: var(--font-display); font-size: 26px; color: var(--color-espresso); margin: 0">
            {{ 'admin.signup.title' | translate }}
          </h1>
          <app-language-switcher />
        </div>
        <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0 0 20px">
          {{ 'admin.signup.subtitle' | translate }}
        </p>

        <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col" style="gap: 14px">
          <label class="flex flex-col" style="gap: 4px">
            <span class="form-label">{{ 'admin.signup.brandName' | translate }}</span>
            <input
              formControlName="brandName"
              type="text"
              [placeholder]="'admin.signup.brandNamePlaceholder' | translate"
              class="form-input"
            />
          </label>

          <label class="flex flex-col" style="gap: 4px">
            <span class="form-label">{{ 'admin.signup.ownerName' | translate }}</span>
            <input formControlName="ownerName" type="text" autocomplete="name" class="form-input" />
          </label>

          <label class="flex flex-col" style="gap: 4px">
            <span class="form-label">{{ 'admin.signup.email' | translate }}</span>
            <input
              formControlName="email"
              type="email"
              autocomplete="email"
              autocapitalize="none"
              spellcheck="false"
              class="form-input"
            />
          </label>

          <label class="flex flex-col" style="gap: 4px">
            <span class="form-label">{{ 'admin.signup.password' | translate }}</span>
            <input
              formControlName="password"
              type="password"
              autocomplete="new-password"
              minlength="8"
              class="form-input"
            />
            <span class="form-hint">{{ 'admin.signup.passwordHint' | translate }}</span>
          </label>

          <label class="flex flex-col" style="gap: 4px">
            <span class="form-label">{{ 'admin.signup.phone' | translate }}</span>
            <input
              formControlName="phone"
              type="tel"
              autocomplete="tel"
              [placeholder]="'admin.signup.phonePlaceholder' | translate"
              class="form-input"
              [attr.aria-invalid]="phoneInvalid()"
            />
            @if (phoneInvalid()) {
              <span class="form-hint" style="color: var(--color-berry)">{{
                'admin.signup.phoneInvalid' | translate
              }}</span>
            }
          </label>

          <label class="flex flex-col" style="gap: 4px">
            <span class="form-label">{{ 'admin.signup.currency' | translate }}</span>
            <select formControlName="currency" class="form-input">
              @for (c of currencies; track c) {
                <option [value]="c">{{ 'admin.currencies.' + c | translate }}</option>
              }
            </select>
            <span class="form-hint">{{ 'admin.signup.currencyHint' | translate }}</span>
          </label>

          <button type="submit" [disabled]="form.invalid || loading()" class="primary disabled:opacity-50">
            {{ (loading() ? 'admin.signup.creating' : 'admin.signup.create') | translate }}
          </button>

          @if (error()) {
            <p
              role="alert"
              style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0"
            >
              {{ error() }}
              @if (errorCode() === 'EMAIL_TAKEN') {
                <a
                  routerLink="/forgot-password"
                  style="color: var(--color-caramel); font-weight: 600; margin-left: 4px"
                >
                  {{ 'admin.signup.forgotPassword' | translate }}
                </a>
              }
            </p>
          }
        </form>

        <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 16px 0 0">
          {{ 'admin.signup.haveAccount' | translate }}
          <a routerLink="/login" style="color: var(--color-caramel); font-weight: 600; margin-left: 4px">
            {{ 'admin.signup.signIn' | translate }}
          </a>
        </p>
      </section>
    </main>
  `,
  styles: [
    `
      .form-label {
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-secondary);
        font-weight: 500;
      }
      .form-hint {
        font-family: var(--font-sans);
        font-size: 11px;
        color: var(--color-text-tertiary);
      }
      .form-input {
        height: 42px;
        padding: 0 12px;
        background: var(--color-cream);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        font-family: var(--font-sans);
        font-size: 14px;
        outline: none;
      }
      .primary {
        height: 46px;
        background: var(--color-caramel);
        color: white;
        border: 0;
        border-radius: var(--radius-button);
        font-family: var(--font-sans);
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        margin-top: 4px;
      }
    `,
  ],
})
export class SignupPage {
  private readonly biz = inject(BusinessService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly currencies = BRAND_CURRENCIES;
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly errorCode = signal<string | null>(null);

  readonly form = new FormGroup({
    brandName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(80)],
    }),
    ownerName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(80)],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8), Validators.maxLength(128)],
    }),
    phone: new FormControl('', { nonNullable: true, validators: [internationalPhone] }),
    // Moldova and Transnistria are where takeAway launches.
    currency: new FormControl<BrandCurrency>('MDL', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    // A server-side conflict is about the value that was sent; editing the
    // form makes it stale.
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.error()) this.clearError();
    });
  }

  phoneInvalid(): boolean {
    const phone = this.form.controls.phone;
    return phone.invalid && phone.touched;
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.clearError();
    const raw = this.form.getRawValue();
    this.biz
      .register({
        brandName: raw.brandName.trim(),
        ownerName: raw.ownerName.trim(),
        email: raw.email.trim().toLowerCase(),
        password: raw.password,
        phone: normalizePhone(raw.phone) || undefined,
        currency: raw.currency,
        // Emails about the brand come in the language the owner signed up in.
        locale: this.uiLocale(),
      })
      .subscribe({
        next: () => {
          this.loading.set(false);
          // The dashboard opens on the launch checklist: logo, store, menu.
          void this.router.navigate(['/dashboard']);
        },
        error: (err) => {
          this.loading.set(false);
          this.showError(err);
        },
      });
  }

  private uiLocale(): BrandLocale {
    return this.translate.currentLang === 'en' ? 'EN' : 'RU';
  }

  private showError(err: unknown): void {
    const code = apiErrorCode(err);
    if (code && KNOWN_CONFLICTS.has(code)) {
      this.errorCode.set(code);
      this.error.set(this.translate.instant(`admin.signup.errors.${code}`));
      return;
    }
    const fields = invalidFields(err).filter((f) => SIGNUP_FIELDS.has(f));
    if (fields.length) {
      const names = fields.map((f) => this.translate.instant(`admin.signup.errors.fields.${f}`)).join(', ');
      this.error.set(this.translate.instant('admin.signup.errors.invalid', { fields: names }));
      return;
    }
    this.error.set(this.translate.instant('common.genericError'));
  }

  private clearError(): void {
    this.error.set(null);
    this.errorCode.set(null);
  }
}

/**
 * The API's rule, checked before the round-trip: international format once
 * separators are dropped, e.g. "+373 69 123 456". Empty is fine — the
 * phone is optional.
 */
function internationalPhone(control: AbstractControl<string>): ValidationErrors | null {
  const phone = normalizePhone(control.value ?? '');
  if (!phone) return null;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? null : { internationalPhone: true };
}

function normalizePhone(input: string): string {
  const compact = input.trim().replace(/[\s().-]/g, '');
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
}
