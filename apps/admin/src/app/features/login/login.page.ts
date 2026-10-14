import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../core/auth/auth.service';
import { emailOrLoginValidator, signInIdentifier } from '../../core/auth/sign-in-identifier';
import { apiErrorMessage } from '../../core/http/api-error';

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
            <span class="text-sm font-medium">{{ 'admin.login.identifierLabel' | translate }}</span>
            <input
              formControlName="identifier"
              type="text"
              inputmode="email"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              [placeholder]="'admin.login.identifierPlaceholder' | translate"
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

        <div class="mt-4 flex justify-between items-center text-sm">
          <a routerLink="/forgot-password" style="color: var(--color-caramel)">
            {{ 'admin.login.forgot' | translate }}
          </a>
          <a routerLink="/signup" style="color: var(--color-caramel); font-weight: 600">
            {{ 'admin.login.signupCta' | translate }}
          </a>
        </div>

        @if (error()) {
          <p class="mt-4 text-sm" style="color: var(--color-berry)">{{ error() }}</p>
        }

        <p class="mt-6 text-sm text-center">
          <a routerLink="/login/pin" style="color: var(--color-text-secondary); text-decoration: underline">
            {{ 'admin.login.kitchenPin' | translate }}
          </a>
        </p>
      </section>
    </main>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);

  /**
   * Where to go after signing in — the PIN screen of an unbound tablet sends
   * `?next=/kitchen`, and opening the board binds the tablet. Only a path
   * inside the cabinet is followed.
   */
  private readonly next = safeNext(this.route.snapshot.queryParamMap.get('next'));

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** An email or a staff login; one with an '@' is an email. */
  readonly form = new FormGroup({
    identifier: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, emailOrLoginValidator],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
  });

  submit(): void {
    const identifier = signInIdentifier(this.form.controls.identifier.value);
    if (this.form.invalid || !identifier) return;
    this.loading.set(true);
    this.error.set(null);
    this.auth.login({ identifier: identifier.value, password: this.form.controls.password.value }).subscribe({
      next: () => {
        this.loading.set(false);
        void this.router.navigateByUrl(this.next);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(this.extractMessage(err));
      },
    });
  }

  /** A failed sign-in in the admin's language: a wrong email, login or password, no network, too many tries. */
  private extractMessage(err: unknown): string {
    return apiErrorMessage(err, this.translate, {
      messages: { 'Invalid email, login or password': 'admin.login.invalid' },
      network: 'common.networkError',
      statuses: { 429: 'admin.forgot.tooMany' },
    });
  }
}

/** An in-app path to continue to, or `/`. Never another origin (`//evil`, `/\evil`, `https:`). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}
