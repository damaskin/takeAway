import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';

@Component({
  selector: 'app-personal-info',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, RouterLink],
  template: `
    <section style="min-height: calc(100vh - 72px); background: var(--color-cream); padding: 32px 16px">
      <div style="max-width: 540px; margin: 0 auto">
        <a
          routerLink="/profile"
          style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); text-decoration: none"
          >← {{ 'common.back' | translate }}</a
        >
        <h1 style="font-family: var(--font-display); font-size: 28px; color: var(--color-espresso); margin: 12px 0 8px">
          {{ 'web.profile.personalInfo.title' | translate }}
        </h1>
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0 0 24px">
          {{ 'web.profile.personalInfo.subtitle' | translate }}
        </p>

        <form
          [formGroup]="form"
          (ngSubmit)="save()"
          class="flex flex-col"
          style="gap: 16px; background: var(--color-foam); border-radius: var(--radius-card); padding: 24px; box-shadow: var(--shadow-soft)"
        >
          <label class="flex flex-col" style="gap: 6px">
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
              'web.profile.personalInfo.name' | translate
            }}</span>
            <input
              formControlName="name"
              type="text"
              autocomplete="name"
              style="height: 48px; padding: 0 14px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 15px; outline: none"
            />
          </label>

          <label class="flex flex-col" style="gap: 6px">
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
              'web.profile.personalInfo.email' | translate
            }}</span>
            <input
              formControlName="email"
              type="email"
              autocomplete="email"
              autocapitalize="none"
              spellcheck="false"
              style="height: 48px; padding: 0 14px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 15px; outline: none"
            />
          </label>

          <label class="flex flex-col" style="gap: 6px">
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
              'web.profile.personalInfo.phone' | translate
            }}</span>
            <input
              formControlName="phone"
              type="tel"
              autocomplete="tel"
              placeholder="+971501234567"
              style="height: 48px; padding: 0 14px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 15px; outline: none"
            />
          </label>

          <label class="flex flex-col" style="gap: 6px">
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
              'web.profile.personalInfo.dob' | translate
            }}</span>
            <input
              formControlName="dateOfBirth"
              type="date"
              style="height: 48px; padding: 0 14px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 15px; outline: none"
            />
          </label>

          <button
            type="submit"
            [disabled]="form.invalid || loading()"
            class="flex items-center justify-center disabled:opacity-50"
            style="height: 52px; background: var(--color-caramel); color: white; border-radius: var(--radius-pill); font-family: var(--font-sans); font-size: 16px; font-weight: 600"
          >
            {{ (loading() ? 'web.profile.personalInfo.saving' : 'common.save') | translate }}
          </button>

          @if (saved()) {
            <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-mint)">
              {{ 'web.profile.personalInfo.saved' | translate }}
            </p>
          }
          @if (error()) {
            <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">{{ error() }}</p>
          }
        </form>
      </div>
    </section>
  `,
})
export class PersonalInfoPage {
  private readonly auth = inject(AuthService);
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly loading = signal(false);
  readonly saved = signal(false);
  readonly error = signal<string | null>(null);

  readonly form: FormGroup<{
    name: FormControl<string>;
    email: FormControl<string>;
    phone: FormControl<string>;
    dateOfBirth: FormControl<string>;
  }>;

  constructor() {
    const user = this.store.user();
    this.form = new FormGroup({
      name: new FormControl(user?.name ?? '', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(1), Validators.maxLength(80)],
      }),
      email: new FormControl(user?.email ?? '', { nonNullable: true, validators: [Validators.email] }),
      phone: new FormControl(user?.phone ?? '', { nonNullable: true }),
      dateOfBirth: new FormControl('', { nonNullable: true }),
    });
  }

  save(): void {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.saved.set(false);
    this.error.set(null);
    const v = this.form.getRawValue();
    const patch: Record<string, string | undefined> = {
      name: v.name.trim() || undefined,
      email: v.email.trim().toLowerCase() || undefined,
      phone: v.phone.trim() || undefined,
      dateOfBirth: v.dateOfBirth || undefined,
    };
    this.auth.updateMe(patch).subscribe({
      next: () => {
        this.loading.set(false);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
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
    if (Array.isArray(maybe.error?.message) && maybe.error.message.length) return maybe.error.message[0] as string;
    if (typeof maybe.message === 'string') return maybe.message;
    return this.translate.instant('common.genericError');
  }
}
