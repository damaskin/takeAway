import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { BusinessService } from '../../core/business/business.service';

/**
 * Self-serve business registration that lands the brand owner directly
 * in the admin app with a hot session. Mirrors the web/business-signup
 * page, but the success path is `router.navigate(['/integrations'])`
 * inside the same origin — the web version can only link out to the
 * admin host and forces a re-login because the admin localStorage is
 * a different origin entirely.
 *
 * The brand starts in `PENDING` moderation status; the storefront
 * won't show it to customers until a SUPER_ADMIN approves, but that's
 * fine — the owner can already configure their POS integration, menu,
 * stores etc. while waiting for moderation.
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
        <div class="flex items-center justify-between" style="margin-bottom: 8px">
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
            <span style="font-family: var(--font-sans); font-size: 11px; color: var(--color-text-tertiary)">{{
              'admin.signup.passwordHint' | translate
            }}</span>
          </label>

          <label class="flex flex-col" style="gap: 4px">
            <span class="form-label">{{ 'admin.signup.phone' | translate }}</span>
            <input formControlName="phone" type="tel" autocomplete="tel" class="form-input" />
          </label>

          <button type="submit" [disabled]="form.invalid || loading()" class="primary disabled:opacity-50">
            {{ (loading() ? 'admin.signup.creating' : 'admin.signup.create') | translate }}
          </button>

          @if (error()) {
            <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0">
              {{ error() }}
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

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

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
    phone: new FormControl('', { nonNullable: true }),
  });

  submit(): void {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    const raw = this.form.getRawValue();
    this.biz
      .register({
        brandName: raw.brandName.trim(),
        ownerName: raw.ownerName.trim(),
        email: raw.email.trim().toLowerCase(),
        password: raw.password,
        phone: raw.phone.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.loading.set(false);
          // Send the freshly minted BRAND_ADMIN straight to the integrations
          // page — that's the next setup step they care about. They can
          // wander to /menu / /stores from there.
          void this.router.navigate(['/integrations']);
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(this.extractMessage(err));
        },
      });
  }

  private extractMessage(err: unknown): string {
    const maybe = err as { error?: { message?: unknown }; message?: unknown };
    if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
    if (typeof maybe.message === 'string') return maybe.message;
    return this.translate.instant('common.genericError');
  }
}
