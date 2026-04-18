import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthService } from '../../core/auth/auth.service';

type Step = 'phone' | 'code';

@Component({
  selector: 'app-kds-login',
  standalone: true,
  imports: [ReactiveFormsModule, LanguageSwitcherComponent, TranslatePipe],
  template: `
    <main
      class="min-h-screen flex items-center justify-center"
      style="background: var(--color-cream); color: var(--color-cream)"
    >
      <section class="w-full max-w-md p-8" style="background: var(--color-surface); border-radius: var(--radius-card)">
        <div class="flex items-center justify-between mb-2">
          <h1 class="text-3xl" style="font-family: var(--font-display)">takeAway KDS</h1>
          <app-language-switcher />
        </div>
        <p class="mb-6" style="opacity: 0.6">
          {{ (step() === 'phone' ? 'web.auth.signInPhone' : 'web.auth.enterCode') | translate }}
        </p>

        @if (step() === 'phone') {
          <form [formGroup]="phoneForm" (ngSubmit)="sendCode()" class="flex flex-col gap-3">
            <input
              formControlName="phone"
              type="tel"
              placeholder="+14155551234"
              class="px-4 py-3 outline-none"
              style="background: var(--color-surface-variant); color: var(--color-cream); border-radius: var(--radius-input)"
            />
            <button
              type="submit"
              [disabled]="phoneForm.invalid || loading()"
              class="py-3 font-medium disabled:opacity-50"
              style="background: var(--color-caramel); color: white; border-radius: var(--radius-button)"
            >
              {{ (loading() ? 'admin.login.sending' : 'admin.login.sendCode') | translate }}
            </button>
          </form>
        } @else {
          <form [formGroup]="codeForm" (ngSubmit)="verifyCode()" class="flex flex-col gap-3">
            <input
              formControlName="code"
              inputmode="numeric"
              maxlength="6"
              placeholder="123456"
              class="px-4 py-3 text-center text-xl tracking-[0.5em] outline-none"
              style="background: var(--color-surface-variant); color: var(--color-cream); border-radius: var(--radius-input); font-family: var(--font-mono)"
            />
            <button
              type="submit"
              [disabled]="codeForm.invalid || loading()"
              class="py-3 font-medium disabled:opacity-50"
              style="background: var(--color-caramel); color: white; border-radius: var(--radius-button)"
            >
              {{ (loading() ? 'admin.login.verifying' : 'common.signIn') | translate }}
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
export class KdsLoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly step = signal<Step>('phone');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly phoneForm = new FormGroup({
    phone: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^\+[1-9]\d{6,14}$/)],
    }),
  });
  readonly codeForm = new FormGroup({
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^\d{6}$/)],
    }),
  });

  sendCode(): void {
    if (this.phoneForm.invalid) return;
    this.loading.set(true);
    this.auth.sendOtp({ phone: this.phoneForm.controls.phone.value }).subscribe({
      next: () => {
        this.loading.set(false);
        this.step.set('code');
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(extractMessage(err));
      },
    });
  }

  verifyCode(): void {
    if (this.codeForm.invalid) return;
    this.loading.set(true);
    this.auth
      .verifyOtp({ phone: this.phoneForm.controls.phone.value, code: this.codeForm.controls.code.value })
      .subscribe({
        next: () => {
          this.loading.set(false);
          void this.router.navigate(['/']);
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(extractMessage(err));
        },
      });
  }
}

function extractMessage(err: unknown): string {
  const maybe = err as { error?: { message?: unknown }; message?: unknown };
  if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
  if (typeof maybe.message === 'string') return maybe.message;
  return 'Something went wrong';
}
