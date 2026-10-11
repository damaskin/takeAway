import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { STAFF_PASSWORD_MAX_LENGTH, STAFF_PASSWORD_MIN_LENGTH } from '@takeaway/shared-types';

import { AuthService } from '../../core/auth/auth.service';
import { apiErrorMessage } from '../../core/http/api-error';

/**
 * Sets a new password from an emailed one-time link: "forgot password", or
 * the invite of a new employee (`&invite=1`, worded as "set your password").
 */
@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, RouterLink],
  template: `
    <main class="min-h-screen flex items-center justify-center" style="background: var(--color-cream)">
      <section
        class="w-full max-w-sm p-8 shadow-[var(--shadow-soft)]"
        style="background: var(--color-foam); border-radius: var(--radius-card)"
      >
        <h1 style="font-family: var(--font-display); font-size: 22px; color: var(--color-espresso); margin: 0 0 12px">
          {{ (invite ? 'admin.reset.inviteTitle' : 'admin.reset.title') | translate }}
        </h1>

        @if (!token) {
          <p class="text-sm" style="color: var(--color-berry)">{{ 'admin.reset.missingToken' | translate }}</p>
          <a routerLink="/forgot-password" class="block mt-6 text-sm" style="color: var(--color-caramel)">
            {{ 'admin.reset.requestNewLink' | translate }}
          </a>
        } @else if (done()) {
          <p class="text-sm" style="color: var(--color-espresso)">{{ 'admin.reset.done' | translate }}</p>
          <a routerLink="/login" class="block mt-6 text-sm" style="color: var(--color-caramel)">
            {{ 'admin.reset.signIn' | translate }}
          </a>
        } @else {
          <p class="text-sm mb-6" style="color: var(--color-espresso); opacity: 0.7">
            {{ (invite ? 'admin.reset.inviteSubtitle' : 'admin.reset.subtitle') | translate }}
          </p>
          <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-4">
            <label class="flex flex-col gap-1">
              <span class="text-sm font-medium">{{ 'admin.reset.newPasswordLabel' | translate }}</span>
              <input
                formControlName="newPassword"
                type="password"
                autocomplete="new-password"
                [attr.minlength]="rule.min"
                [attr.maxlength]="rule.max"
                aria-describedby="reset-password-rule"
                class="px-3 py-2 border outline-none"
                style="border-color: var(--color-latte); border-radius: var(--radius-input)"
              />
              <span
                id="reset-password-rule"
                class="text-xs"
                [style.color]="tooShort() ? 'var(--color-berry)' : 'var(--color-text-tertiary)'"
                >{{ 'admin.reset.rule' | translate: rule }}</span
              >
            </label>
            <button
              type="submit"
              [disabled]="form.invalid || loading()"
              class="py-2 font-medium disabled:opacity-50"
              style="background: var(--color-caramel); color: white; border-radius: var(--radius-button)"
            >
              {{ (loading() ? 'admin.reset.saving' : 'admin.reset.save') | translate }}
            </button>
          </form>
        }

        @if (error()) {
          <p class="mt-4 text-sm" style="color: var(--color-berry)" role="alert">{{ error() }}</p>
          @if (expired()) {
            <a routerLink="/forgot-password" class="block mt-2 text-sm" style="color: var(--color-caramel)">
              {{ 'admin.reset.requestNewLink' | translate }}
            </a>
          }
        }
      </section>
    </main>
  `,
})
export class ResetPasswordPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);

  readonly token = this.route.snapshot.queryParamMap.get('token') ?? '';
  /** Opened from a staff invite rather than "forgot password". */
  readonly invite = this.route.snapshot.queryParamMap.get('invite') === '1';
  readonly rule = { min: STAFF_PASSWORD_MIN_LENGTH, max: STAFF_PASSWORD_MAX_LENGTH };
  readonly loading = signal(false);
  readonly done = signal(false);
  readonly error = signal<string | null>(null);
  /** The link was used already or ran out — offer a new one. */
  readonly expired = signal(false);

  readonly form = new FormGroup({
    newPassword: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(STAFF_PASSWORD_MIN_LENGTH),
        Validators.maxLength(STAFF_PASSWORD_MAX_LENGTH),
      ],
    }),
  });

  /** Something was typed that is shorter than the rule allows. */
  tooShort(): boolean {
    const value = this.form.controls.newPassword.value;
    return value.length > 0 && value.length < STAFF_PASSWORD_MIN_LENGTH;
  }

  submit(): void {
    if (!this.token || this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    this.expired.set(false);
    this.auth.resetPassword({ token: this.token, newPassword: this.form.controls.newPassword.value }).subscribe({
      next: () => {
        this.loading.set(false);
        this.done.set(true);
        setTimeout(() => void this.router.navigate(['/login']), 2500);
      },
      error: (err) => {
        this.loading.set(false);
        const invalid = (err as { status?: number } | null)?.status === 400;
        this.expired.set(invalid);
        this.error.set(
          apiErrorMessage(err, this.translate, {
            network: 'common.networkError',
            messages: {
              'Reset link is invalid or has expired': 'admin.reset.linkInvalid',
              'token must be longer than or equal to 16 characters': 'admin.reset.linkInvalid',
            },
            fields: { newPassword: 'admin.reset.newPasswordLabel' },
            invalidField: 'admin.reset.invalidField',
          }),
        );
      },
    });
  }
}
