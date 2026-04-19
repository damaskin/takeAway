import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../core/auth/auth.service';

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
          {{ 'admin.reset.title' | translate }}
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
            {{ 'admin.reset.subtitle' | translate }}
          </p>
          <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-4">
            <label class="flex flex-col gap-1">
              <span class="text-sm font-medium">{{ 'admin.reset.newPasswordLabel' | translate }}</span>
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
              {{ (loading() ? 'admin.reset.saving' : 'admin.reset.save') | translate }}
            </button>
          </form>
        }

        @if (error()) {
          <p class="mt-4 text-sm" style="color: var(--color-berry)">{{ error() }}</p>
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
  readonly loading = signal(false);
  readonly done = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    newPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
  });

  submit(): void {
    if (!this.token || this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    this.auth.resetPassword({ token: this.token, newPassword: this.form.controls.newPassword.value }).subscribe({
      next: () => {
        this.loading.set(false);
        this.done.set(true);
        setTimeout(() => void this.router.navigate(['/login']), 2500);
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
