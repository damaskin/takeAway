import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, RouterLink],
  template: `
    <main class="min-h-screen flex items-center justify-center" style="background: var(--color-cream)">
      <section
        class="w-full max-w-sm p-8 shadow-[var(--shadow-soft)]"
        style="background: var(--color-foam); border-radius: var(--radius-card)"
      >
        <h1 style="font-family: var(--font-display); font-size: 22px; color: var(--color-espresso); margin: 0 0 12px">
          {{ 'admin.forgot.title' | translate }}
        </h1>
        <p class="text-sm mb-6" style="color: var(--color-espresso); opacity: 0.7">
          {{ 'admin.forgot.subtitle' | translate }}
        </p>

        @if (sent()) {
          <p class="text-sm" style="color: var(--color-espresso)">{{ 'admin.forgot.sent' | translate }}</p>
          <a routerLink="/login" class="block mt-6 text-sm" style="color: var(--color-caramel)">
            {{ 'admin.forgot.backToLogin' | translate }}
          </a>
        } @else {
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
            <button
              type="submit"
              [disabled]="form.invalid || loading()"
              class="py-2 font-medium disabled:opacity-50"
              style="background: var(--color-caramel); color: white; border-radius: var(--radius-button)"
            >
              {{ (loading() ? 'admin.forgot.sending' : 'admin.forgot.sendLink') | translate }}
            </button>
            <a routerLink="/login" class="text-sm" style="color: var(--color-espresso); opacity: 0.7">
              {{ 'admin.forgot.backToLogin' | translate }}
            </a>
          </form>
        }

        @if (error()) {
          <p class="mt-4 text-sm" style="color: var(--color-berry)">{{ error() }}</p>
        }
      </section>
    </main>
  `,
})
export class ForgotPasswordPage {
  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);

  readonly loading = signal(false);
  readonly sent = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
  });

  submit(): void {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    this.auth.forgotPassword({ email: this.form.controls.email.value.trim().toLowerCase() }).subscribe({
      next: () => {
        this.loading.set(false);
        this.sent.set(true);
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
