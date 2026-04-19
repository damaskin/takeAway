import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { BusinessService } from '../../core/business/business.service';

@Component({
  selector: 'app-business-signup',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  template: `
    <section
      class="flex flex-col"
      style="min-height: calc(100vh - 72px); background: var(--color-cream); padding: 48px 24px"
    >
      <div class="w-full" style="max-width: 540px; margin: 0 auto">
        <h1 style="font-family: var(--font-display); font-size: 32px; color: var(--color-espresso); margin: 0 0 8px">
          {{ 'web.business.title' | translate }}
        </h1>
        <p style="font-family: var(--font-sans); font-size: 15px; color: var(--color-text-secondary); margin: 0 0 24px">
          {{ 'web.business.subtitle' | translate }}
        </p>

        @if (done()) {
          <div
            style="background: var(--color-foam); border-radius: var(--radius-card); padding: 24px; box-shadow: var(--shadow-soft)"
          >
            <p style="font-family: var(--font-display); font-size: 22px; color: var(--color-espresso); margin: 0 0 8px">
              {{ 'web.business.pendingTitle' | translate }}
            </p>
            <p
              style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0 0 16px"
            >
              {{ 'web.business.pendingBody' | translate }}
            </p>
            <a
              href="https://admin.takeaway.million-sales.ru"
              class="inline-flex items-center justify-center"
              style="height: 48px; padding: 0 24px; background: var(--color-caramel); color: white; border-radius: var(--radius-pill); font-family: var(--font-sans); font-weight: 600; text-decoration: none"
            >
              {{ 'web.business.goToAdmin' | translate }}
            </a>
          </div>
        } @else {
          <form
            [formGroup]="form"
            (ngSubmit)="submit()"
            class="flex flex-col"
            style="gap: 16px; background: var(--color-foam); border-radius: var(--radius-card); padding: 24px; box-shadow: var(--shadow-soft)"
          >
            <label class="flex flex-col" style="gap: 6px">
              <span style="font-family: var(--font-sans); font-size: 14px; font-weight: 500">{{
                'web.business.brandName' | translate
              }}</span>
              <input
                formControlName="brandName"
                type="text"
                [placeholder]="'web.business.brandNamePlaceholder' | translate"
                class="outline-none"
                style="height: 48px; padding: 0 14px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 15px"
              />
            </label>

            <label class="flex flex-col" style="gap: 6px">
              <span style="font-family: var(--font-sans); font-size: 14px; font-weight: 500">{{
                'web.business.ownerName' | translate
              }}</span>
              <input
                formControlName="ownerName"
                type="text"
                autocomplete="name"
                class="outline-none"
                style="height: 48px; padding: 0 14px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 15px"
              />
            </label>

            <label class="flex flex-col" style="gap: 6px">
              <span style="font-family: var(--font-sans); font-size: 14px; font-weight: 500">{{
                'web.business.email' | translate
              }}</span>
              <input
                formControlName="email"
                type="email"
                autocomplete="email"
                autocapitalize="none"
                spellcheck="false"
                class="outline-none"
                style="height: 48px; padding: 0 14px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 15px"
              />
            </label>

            <label class="flex flex-col" style="gap: 6px">
              <span style="font-family: var(--font-sans); font-size: 14px; font-weight: 500">{{
                'web.business.password' | translate
              }}</span>
              <input
                formControlName="password"
                type="password"
                autocomplete="new-password"
                minlength="8"
                class="outline-none"
                style="height: 48px; padding: 0 14px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 15px"
              />
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
                'web.business.passwordHint' | translate
              }}</span>
            </label>

            <label class="flex flex-col" style="gap: 6px">
              <span style="font-family: var(--font-sans); font-size: 14px; font-weight: 500">{{
                'web.business.phone' | translate
              }}</span>
              <input
                formControlName="phone"
                type="tel"
                autocomplete="tel"
                [placeholder]="'web.business.phonePlaceholder' | translate"
                class="outline-none"
                style="height: 48px; padding: 0 14px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 15px"
              />
            </label>

            <button
              type="submit"
              [disabled]="form.invalid || loading()"
              class="flex items-center justify-center disabled:opacity-50"
              style="height: 52px; background: var(--color-caramel); color: white; border-radius: var(--radius-pill); font-family: var(--font-sans); font-size: 16px; font-weight: 600"
            >
              {{ (loading() ? 'web.business.sending' : 'web.business.submit') | translate }}
            </button>

            @if (error()) {
              <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">{{ error() }}</p>
            }
          </form>
        }
      </div>
    </section>
  `,
})
export class BusinessSignupPage {
  private readonly biz = inject(BusinessService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly loading = signal(false);
  readonly done = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    brandName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(80)],
    }),
    ownerName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(80)],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8), Validators.maxLength(128)],
    }),
    phone: new FormControl('', { nonNullable: true }),
  });

  submit(): void {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    const raw = this.form.getRawValue();
    this.biz
      .register({
        brandName: raw.brandName.trim(),
        ownerName: raw.ownerName.trim(),
        email: raw.email.trim().toLowerCase(),
        password: raw.password,
        phone: raw.phone.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.done.set(true);
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
