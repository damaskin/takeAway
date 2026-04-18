import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';

type Step = 'phone' | 'code';

/**
 * Web Authentication — pencil A10 (xqkL1).
 *
 * Layout:
 *   authLeft (fill, cream) — logo, H1 "Welcome", subtitle, form (400px)
 *     phone input (52px, foam, flag | sep | digits), 52px caramel pill Continue
 *     divider "or" with border-light hair lines
 *     Apple (espresso 48px) + Google (foam 48px outlined) social buttons
 *   authRight (560px) — branded hero photograph
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <section class="flex" style="min-height: calc(100vh - 72px); background: var(--color-cream)">
      <!-- Left column: form -->
      <div class="flex flex-col justify-center" style="flex: 1; padding: 64px 80px; gap: 40px">
        <span style="font-family: var(--font-display); font-size: 28px; font-weight: 700; color: var(--color-caramel)"
          >takeAway</span
        >

        <div class="flex flex-col" style="gap: 8px">
          <h1
            style="font-family: var(--font-display); font-size: 40px; font-weight: 700; color: var(--color-espresso); margin: 0"
          >
            {{ step() === 'phone' ? 'Welcome back' : 'Enter the code' }}
          </h1>
          <p style="font-family: var(--font-sans); font-size: 16px; color: var(--color-text-secondary); margin: 0">
            {{
              step() === 'phone'
                ? 'Sign in with your phone number'
                : 'We sent a 6-digit code to ' + phoneForm.controls.phone.value
            }}
          </p>
        </div>

        <div style="width: 400px; max-width: 100%">
          @if (step() === 'phone') {
            <form [formGroup]="phoneForm" (ngSubmit)="sendCode()" class="flex flex-col" style="gap: 20px">
              <label class="flex flex-col" style="gap: 8px">
                <span
                  style="font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--color-text-primary)"
                  >Phone number</span
                >
                <div
                  class="flex items-center"
                  style="height: 52px; padding: 0 16px; gap: 10px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: var(--radius-input)"
                >
                  <span style="font-family: var(--font-sans); font-size: 15px; color: var(--color-text-primary)"
                    >🇦🇪 +971</span
                  >
                  <span style="width: 1px; height: 24px; background: var(--color-border)"></span>
                  <input
                    formControlName="phone"
                    type="tel"
                    autocomplete="tel"
                    placeholder="50 123 4567"
                    class="flex-1 outline-none bg-transparent"
                    style="font-family: var(--font-sans); font-size: 15px; color: var(--color-text-primary)"
                  />
                </div>
              </label>
              <button
                type="submit"
                [disabled]="phoneForm.invalid || loading()"
                class="flex items-center justify-center disabled:opacity-50"
                style="height: 52px; background: var(--color-caramel); color: white; border-radius: var(--radius-pill); font-family: var(--font-sans); font-size: 16px; font-weight: 600"
              >
                {{ loading() ? 'Sending…' : 'Continue' }}
              </button>

              <!-- Divider -->
              <div class="flex items-center" style="gap: 12px">
                <span style="flex: 1; height: 1px; background: var(--color-border-light)"></span>
                <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)"
                  >or</span
                >
                <span style="flex: 1; height: 1px; background: var(--color-border-light)"></span>
              </div>

              <!-- Social buttons -->
              <div class="flex flex-col" style="gap: 12px">
                <button
                  type="button"
                  (click)="socialStub('Apple')"
                  class="flex items-center justify-center"
                  style="height: 48px; background: var(--color-espresso); color: var(--color-foam); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; gap: 8px"
                >
                  Continue with Apple
                </button>
                <button
                  type="button"
                  (click)="socialStub('Google')"
                  class="flex items-center justify-center"
                  style="height: 48px; background: var(--color-foam); color: var(--color-text-primary); border: 1px solid var(--color-border); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; gap: 8px"
                >
                  G Continue with Google
                </button>
              </div>
            </form>
          } @else {
            <form [formGroup]="codeForm" (ngSubmit)="verifyCode()" class="flex flex-col" style="gap: 20px">
              <label class="flex flex-col" style="gap: 8px">
                <span
                  style="font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--color-text-primary)"
                  >6-digit code</span
                >
                <input
                  formControlName="code"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="6"
                  placeholder="· · · · · ·"
                  class="outline-none text-center"
                  style="height: 52px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-mono); font-size: 22px; letter-spacing: 0.5em; color: var(--color-text-primary)"
                />
              </label>
              <button
                type="submit"
                [disabled]="codeForm.invalid || loading()"
                class="flex items-center justify-center disabled:opacity-50"
                style="height: 52px; background: var(--color-caramel); color: white; border-radius: var(--radius-pill); font-family: var(--font-sans); font-size: 16px; font-weight: 600"
              >
                {{ loading() ? 'Verifying…' : 'Sign in' }}
              </button>
              <button
                type="button"
                (click)="step.set('phone')"
                style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)"
              >
                ← Change number
              </button>
            </form>
          }

          @if (error()) {
            <p style="margin-top: 16px; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">
              {{ error() }}
            </p>
          }
        </div>

        <p style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); margin: 0">
          By continuing you agree to our Terms and Privacy Policy.
        </p>
      </div>

      <!-- Right column: hero photograph -->
      <div
        style="width: 560px; background-image: linear-gradient(160deg, var(--color-caramel) 0%, #a0612a 100%); background-size: cover; background-position: center"
        class="hidden md:flex items-end"
      >
        <div style="padding: 48px; color: white">
          <span style="font-family: var(--font-display); font-size: 28px; font-weight: 700; line-height: 1.2"
            >Pre-order. Skip the queue. Pick it up.</span
          >
          <p
            style="margin-top: 12px; font-family: var(--font-sans); font-size: 14px; color: rgba(255, 255, 255, 0.85); line-height: 1.5"
          >
            Your drink waits for you, not the other way around.
          </p>
        </div>
      </div>
    </section>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly step = signal<Step>('phone');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly phoneForm = new FormGroup({
    phone: new FormControl('', {
      nonNullable: true,
      // Accept local-style or E.164 — we'll normalize on send.
      validators: [Validators.required, Validators.pattern(/^[+\d][\d\s()-]{6,20}$/)],
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
    this.error.set(null);
    this.auth.sendOtp({ phone: this.normalizedPhone() }).subscribe({
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
    this.error.set(null);
    this.auth.verifyOtp({ phone: this.normalizedPhone(), code: this.codeForm.controls.code.value }).subscribe({
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

  socialStub(provider: string): void {
    this.error.set(`${provider} sign-in is coming soon. Use phone for now.`);
  }

  private normalizedPhone(): string {
    const raw = this.phoneForm.controls.phone.value.trim();
    const digits = raw.replace(/[^\d]/g, '');
    // If the user typed a full E.164 (starts with +), keep leading +; otherwise assume +971.
    if (raw.startsWith('+')) return '+' + digits;
    return '+971' + digits;
  }
}

function extractMessage(err: unknown): string {
  const maybe = err as { error?: { message?: unknown }; message?: unknown };
  if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
  if (typeof maybe.message === 'string') return maybe.message;
  return 'Something went wrong, please try again';
}
