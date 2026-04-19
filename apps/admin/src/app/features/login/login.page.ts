import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, LanguageSwitcherComponent, TranslatePipe, RouterLink],
  template: `
    <main class="min-h-screen flex items-center justify-center" style="background: var(--color-cream)">
      <section
        class="w-full max-w-sm p-8 shadow-[var(--shadow-soft)]"
        style="background: var(--color-foam); border-radius: var(--radius-card)"
      >
        <div class="flex items-center justify-between mb-2">
          <h1 style="font-family: var(--font-display); font-size: 26px; color: var(--color-espresso); margin: 0">
            {{ 'admin.login.title' | translate }}
          </h1>
          <app-language-switcher />
        </div>
        <p class="text-sm mb-6" style="color: var(--color-espresso); opacity: 0.6">
          {{ 'admin.login.passwordPrompt' | translate }}
        </p>

        <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-4">
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">{{ 'admin.login.emailLabel' | translate }}</span>
            <input
              formControlName="email"
              type="email"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              [placeholder]="'admin.login.emailPlaceholder' | translate"
              class="px-3 py-2 border outline-none"
              style="border-color: var(--color-latte); border-radius: var(--radius-input)"
            />
          </label>

          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">{{ 'admin.login.passwordLabel' | translate }}</span>
            <input
              formControlName="password"
              type="password"
              autocomplete="current-password"
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
            {{ (loading() ? 'admin.login.signingIn' : 'admin.login.signIn') | translate }}
          </button>
        </form>

        <div class="mt-4 flex justify-between text-sm">
          <a routerLink="/forgot-password" style="color: var(--color-caramel)">
            {{ 'admin.login.forgot' | translate }}
          </a>
        </div>

        @if (error()) {
          <p class="mt-4 text-sm" style="color: var(--color-berry)">{{ error() }}</p>
        }
      </section>
    </main>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
  });

  submit(): void {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    this.auth
      .login({
        email: this.form.controls.email.value.trim().toLowerCase(),
        password: this.form.controls.password.value,
      })
      .subscribe({
        next: () => {
          this.loading.set(false);
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
