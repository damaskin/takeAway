import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-kds-login',
  standalone: true,
  imports: [ReactiveFormsModule, LanguageSwitcherComponent, TranslatePipe],
  template: `
    <main
      class="min-h-screen flex items-center justify-center"
      style="background: var(--color-cream); color: var(--color-text-primary); padding: 16px"
    >
      <section
        class="w-full max-w-md"
        style="background: var(--color-foam); border-radius: var(--radius-card); padding: 32px; box-shadow: var(--shadow-soft)"
      >
        <div class="flex items-center justify-between mb-2">
          <h1
            class="text-3xl"
            style="font-family: var(--font-display); color: var(--color-espresso); font-weight: 700; margin: 0"
          >
            {{ 'kds.login.title' | translate }}
          </h1>
          <app-language-switcher />
        </div>
        <p class="mb-6" style="color: var(--color-text-secondary); font-family: var(--font-sans); font-size: 14px">
          {{ 'kds.login.passwordPrompt' | translate }}
        </p>

        <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-3">
          <input
            formControlName="email"
            type="email"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            [placeholder]="'admin.login.emailPlaceholder' | translate"
            class="px-4 py-3 outline-none"
            style="background: var(--color-foam); color: var(--color-text-primary); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 15px"
          />
          <input
            formControlName="password"
            type="password"
            autocomplete="current-password"
            class="px-4 py-3 outline-none"
            style="background: var(--color-foam); color: var(--color-text-primary); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 15px"
          />
          <button
            type="submit"
            [disabled]="form.invalid || loading()"
            class="py-3 font-medium disabled:opacity-50"
            style="background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 15px; font-weight: 600"
          >
            {{ (loading() ? 'admin.login.signingIn' : 'admin.login.signIn') | translate }}
          </button>
        </form>

        @if (error()) {
          <p class="mt-4 text-sm" style="color: var(--color-berry); font-family: var(--font-sans)">{{ error() }}</p>
        }
      </section>
    </main>
  `,
})
export class KdsLoginPage {
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
