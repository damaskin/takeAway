import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { PasswordForgotResponse } from '@takeaway/shared-types';

import { AuthService } from '../../core/auth/auth.service';
import { emailOrLoginValidator, signInIdentifier } from '../../core/auth/sign-in-identifier';
import { apiErrorCode, apiErrorMessage } from '../../core/http/api-error';

/** Which «sent» text fits what the server can send through. */
type SentWording = 'both' | 'email' | 'telegram';

/** How long the link works when the API does not say (an API from before 2026-11-06). */
const DEFAULT_LINK_TTL_MINUTES = 60;

/**
 * «Забыли пароль?» for staff and owners: the email or login they sign in
 * with, and a one-time link to their email and to the Telegram they linked
 * for work notifications. The answer never says whether the account exists
 * — only where to look — and the page always says what to do when the
 * account has neither an email nor Telegram.
 */
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

        @if (sent(); as wording) {
          <p class="text-sm" style="color: var(--color-espresso)" role="status" data-testid="forgot-sent">
            {{ 'admin.forgot.sent.' + wording | translate: { minutes: linkTtlMinutes() } }}
          </p>
          <p
            class="text-sm mt-4"
            style="color: var(--color-espresso); opacity: 0.7"
            data-testid="forgot-no-channel-hint"
          >
            {{ 'admin.forgot.noChannelHint' | translate }}
          </p>
          <a routerLink="/login" class="block mt-6 text-sm" style="color: var(--color-caramel)">
            {{ 'admin.forgot.backToLogin' | translate }}
          </a>
        } @else {
          <p class="text-sm mb-6" style="color: var(--color-espresso); opacity: 0.7">
            {{ 'admin.forgot.subtitle' | translate }}
          </p>
          <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-4">
            <label class="flex flex-col gap-1">
              <span class="text-sm font-medium">{{ 'admin.forgot.identifierLabel' | translate }}</span>
              <input
                formControlName="identifier"
                type="text"
                inputmode="email"
                autocomplete="username"
                autocapitalize="none"
                spellcheck="false"
                [placeholder]="'admin.forgot.identifierPlaceholder' | translate"
                class="px-3 py-2 border outline-none"
                style="border-color: var(--color-latte); border-radius: var(--radius-input)"
              />
              @if (form.controls.identifier.hasError('identifier') && form.controls.identifier.touched) {
                <span class="text-xs" style="color: var(--color-berry)">{{
                  'admin.forgot.identifierInvalid' | translate
                }}</span>
              }
            </label>
            <button
              type="submit"
              [disabled]="form.invalid || loading()"
              class="py-2 font-medium disabled:opacity-50"
              style="background: var(--color-caramel); color: white; border-radius: var(--radius-button)"
            >
              {{ (loading() ? 'admin.forgot.sending' : 'admin.forgot.sendLink') | translate }}
            </button>
            <p class="text-xs" style="color: var(--color-espresso); opacity: 0.7" data-testid="forgot-no-channel-hint">
              {{ 'admin.forgot.noChannelHint' | translate }}
            </p>
            <a routerLink="/login" class="text-sm" style="color: var(--color-espresso); opacity: 0.7">
              {{ 'admin.forgot.backToLogin' | translate }}
            </a>
          </form>
        }

        @if (error()) {
          <p class="mt-4 text-sm" style="color: var(--color-berry)" role="alert">{{ error() }}</p>
        }
      </section>
    </main>
  `,
})
export class ForgotPasswordPage {
  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);

  readonly loading = signal(false);
  /** Set once the request went through: which channels the text names. */
  readonly sent = signal<SentWording | null>(null);
  readonly linkTtlMinutes = signal(DEFAULT_LINK_TTL_MINUTES);
  readonly error = signal<string | null>(null);

  /** An email or a staff login, as at sign-in; one with an '@' is an email. */
  readonly form = new FormGroup({
    identifier: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, emailOrLoginValidator],
    }),
  });

  submit(): void {
    const identifier = signInIdentifier(this.form.controls.identifier.value);
    if (this.form.invalid || !identifier) return;
    this.loading.set(true);
    this.error.set(null);
    this.auth.forgotPassword({ identifier: identifier.value }).subscribe({
      next: (answer) => {
        this.loading.set(false);
        this.linkTtlMinutes.set(answer?.linkTtlMinutes ?? DEFAULT_LINK_TTL_MINUTES);
        this.sent.set(sentWording(answer));
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(this.extractMessage(err));
      },
    });
  }

  private extractMessage(err: unknown): string {
    // The server can send the link nowhere (no SMTP and no Telegram bot, or
    // no ADMIN_APP_URL to build it on): say so instead of promising one.
    if (apiErrorCode(err) === 'PASSWORD_RESET_UNAVAILABLE') return this.translate.instant('admin.forgot.unavailable');
    return apiErrorMessage(err, this.translate, {
      network: 'common.networkError',
      statuses: { 429: 'admin.forgot.tooMany' },
    });
  }
}

/**
 * Names only the channels the server can use: without SMTP the page must
 * not send anyone to their inbox. An answer without channels (an older API)
 * gets the general wording.
 */
export function sentWording(answer: PasswordForgotResponse | null | undefined): SentWording {
  const channels = answer?.channels ?? [];
  const email = channels.includes('email');
  const telegram = channels.includes('telegram');
  if (email && !telegram) return 'email';
  if (telegram && !email) return 'telegram';
  return 'both';
}
