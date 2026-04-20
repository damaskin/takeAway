import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';

/**
 * Forced password-change screen. Reached on the first sign-in of an
 * invited staff user (their account has `passwordMustChange=true`).
 * After a successful change the `mustChangePassword` flag flips off and
 * the app redirects to the dashboard.
 */
@Component({
  selector: 'app-change-password',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  template: `
    <main class="min-h-screen flex items-center justify-center" style="background: var(--color-cream)">
      <section
        class="w-full max-w-sm p-8 shadow-[var(--shadow-soft)]"
        style="background: var(--color-foam); border-radius: var(--radius-card)"
      >
        <h1 style="font-family: var(--font-display); font-size: 22px; color: var(--color-espresso); margin: 0 0 6px">
          {{ 'admin.changePassword.title' | translate }}
        </h1>
        <p class="text-sm mb-6" style="color: var(--color-espresso); opacity: 0.7">
          {{ 'admin.changePassword.subtitle' | translate }}
        </p>

        <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-4">
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">{{ 'admin.changePassword.current' | translate }}</span>
            <input
              formControlName="currentPassword"
              type="password"
              autocomplete="current-password"
              class="px-3 py-2 border outline-none"
              style="border-color: var(--color-latte); border-radius: var(--radius-input)"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">{{ 'admin.changePassword.next' | translate }}</span>
            <input
              formControlName="newPassword"
              type="password"
              autocomplete="new-password"
              minlength="8"
              class="px-3 py-2 border outline-none"
              style="border-color: var(--color-latte); border-radius: var(--radius-input)"
            />
          </label>
          <button
            type="submit"
            [disabled]="form.invalid || loading()"
            class="py-2 font-medium disabled:opacity-50"
            style="background: var(--color-caramel); color: white; border-radius: var(--radius-button)"
          >
            {{ (loading() ? 'admin.changePassword.saving' : 'admin.changePassword.save') | translate }}
          </button>
        </form>

        @if (error()) {
          <p class="mt-4 text-sm" style="color: var(--color-berry)">{{ error() }}</p>
        }
      </section>
    </main>
  `,
})
export class ChangePasswordPage {
  private readonly auth = inject(AuthService);
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    currentPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
    newPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
  });

  submit(): void {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    this.auth.changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword }).subscribe({
      next: () => {
        this.loading.set(false);
        // clearMustChangePassword already flipped inside the service.
        void this.router.navigate(['/']);
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
