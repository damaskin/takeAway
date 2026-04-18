import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../core/auth/auth.service';

type Step = 'phone' | 'code';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, LanguageSwitcherComponent, TranslatePipe],
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
          {{ (step() === 'phone' ? 'web.auth.signInPhone' : 'web.auth.enterCode') | translate }}
        </p>

        @if (step() === 'phone') {
          <form [formGroup]="phoneForm" (ngSubmit)="sendCode()" class="flex flex-col gap-4">
            <label class="flex flex-col gap-1">
              <span class="text-sm font-medium">{{ 'admin.login.phoneLabel' | translate }}</span>
              <input
                formControlName="phone"
                type="tel"
                autocomplete="tel"
                [placeholder]="'admin.login.phonePlaceholder' | translate"
                class="px-3 py-2 border outline-none"
                style="border-color: var(--color-latte); border-radius: var(--radius-input)"
              />
              @if (phoneForm.controls.phone.invalid && phoneForm.controls.phone.touched) {
                <span class="text-xs" style="color: var(--color-berry)">{{ 'admin.login.phoneHint' | translate }}</span>
              }
            </label>

            <button
              type="submit"
              [disabled]="phoneForm.invalid || loading()"
              class="py-2 font-medium disabled:opacity-50"
              style="background: var(--color-caramel); color: white; border-radius: var(--radius-button)"
            >
              {{ (loading() ? 'admin.login.sending' : 'admin.login.sendCode') | translate }}
            </button>
          </form>
        } @else {
          <form [formGroup]="codeForm" (ngSubmit)="verifyCode()" class="flex flex-col gap-4">
            <p class="text-sm" style="color: var(--color-espresso); opacity: 0.7">
              {{ 'admin.login.codeSentTo' | translate: { phone: phoneForm.controls.phone.value } }}
            </p>
            <label class="flex flex-col gap-1">
              <span class="text-sm font-medium">{{ 'admin.login.codeLabel' | translate }}</span>
              <input
                formControlName="code"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
                [placeholder]="'admin.login.codePlaceholder' | translate"
                class="px-3 py-2 border text-center text-lg tracking-[0.5em] outline-none"
                style="border-color: var(--color-latte); border-radius: var(--radius-input); font-family: var(--font-mono)"
              />
            </label>
            <button
              type="submit"
              [disabled]="codeForm.invalid || loading()"
              class="py-2 font-medium disabled:opacity-50"
              style="background: var(--color-caramel); color: white; border-radius: var(--radius-button)"
            >
              {{ (loading() ? 'admin.login.verifying' : 'admin.login.verifyCode') | translate }}
            </button>
            <button
              type="button"
              (click)="step.set('phone')"
              class="py-2 text-sm"
              style="color: var(--color-espresso); opacity: 0.6"
            >
              {{ 'admin.login.changeNumber' | translate }}
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
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

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
    this.error.set(null);
    const phone = this.phoneForm.controls.phone.value;
    this.auth.sendOtp({ phone }).subscribe({
      next: () => {
        this.loading.set(false);
        this.step.set('code');
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(this.extractMessage(err));
      },
    });
  }

  verifyCode(): void {
    if (this.codeForm.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    const phone = this.phoneForm.controls.phone.value;
    const code = this.codeForm.controls.code.value;
    this.auth.verifyOtp({ phone, code }).subscribe({
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
