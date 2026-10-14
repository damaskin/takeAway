import { Component, DestroyRef, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { EmailLoginErrorCode } from '@takeaway/shared-types';

import { AuthService } from '../../core/auth/auth.service';

type Step = 'closed' | 'email' | 'code';

/** Seconds before another code may go to the same address (the API's own pause). */
export const RESEND_SECONDS = 60;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * «Войти по почте» on the login page, for customers without Telegram or a
 * Google / Apple account: address → «Получить код» → the six digits from
 * the letter. The browser offers the code from the letter itself where it
 * can (`autocomplete="one-time-code"`), and six digits sign in at once.
 *
 * The page shows this only when `GET /auth/methods` says the server can
 * mail codes. Errors come back with a stable `code` and are worded here.
 */
@Component({
  selector: 'app-email-code-login',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @switch (step()) {
      @case ('closed') {
        <button type="button" class="ec-open" (click)="open()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" stroke-width="1.8" />
            <path d="M4 7l8 6 8-6" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
          </svg>
          <span>{{ 'web.auth.email.open' | translate }}</span>
        </button>
      }
      @case ('email') {
        <form (submit)="$event.preventDefault(); requestCode()" novalidate>
          <label class="ec-field">
            <span>{{ 'web.auth.email.emailLabel' | translate }}</span>
            <input
              #emailInput
              name="email"
              type="email"
              inputmode="email"
              autocomplete="email"
              autocapitalize="off"
              spellcheck="false"
              maxlength="254"
              [placeholder]="'web.auth.email.emailPlaceholder' | translate"
              [value]="email()"
              [disabled]="busy()"
              (input)="email.set($any($event.target).value)"
            />
          </label>
          <button type="submit" class="ec-primary" [disabled]="busy() || !email().trim()">
            {{ (busy() ? 'web.auth.email.sending' : 'web.auth.email.getCode') | translate }}
          </button>
        </form>
      }
      @case ('code') {
        <p class="ec-hint" role="status">
          {{
            (alreadySent() ? 'web.auth.email.alreadySent' : 'web.auth.email.sentTo') | translate: { email: sentTo() }
          }}
        </p>
        <form (submit)="$event.preventDefault(); verify()" novalidate>
          <label class="ec-field">
            <span>{{ 'web.auth.email.codeLabel' | translate }}</span>
            <input
              #codeInput
              name="code"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]*"
              maxlength="6"
              class="ec-code"
              [value]="code()"
              [disabled]="busy()"
              (input)="onCodeInput($event)"
            />
          </label>
          <button type="submit" class="ec-primary" [disabled]="busy() || code().length !== 6">
            {{ (busy() ? 'web.auth.email.checking' : 'web.auth.email.signIn') | translate }}
          </button>
        </form>
        <div class="ec-row">
          @if (resendIn() > 0) {
            <span class="ec-wait">{{ 'web.auth.email.resendIn' | translate: { seconds: resendIn() } }}</span>
          } @else {
            <button type="button" class="ec-link" name="resend" [disabled]="busy()" (click)="resend()">
              {{ 'web.auth.email.resend' | translate }}
            </button>
          }
          <button type="button" class="ec-link" name="change-email" [disabled]="busy()" (click)="changeEmail()">
            {{ 'web.auth.email.changeEmail' | translate }}
          </button>
        </div>
      }
    }
    @if (error()) {
      <p class="ec-error" role="alert">{{ error() }}</p>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 12px;
        font-family: var(--font-sans);
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .ec-open {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        height: 44px;
        padding: 0 20px;
        border: 1px solid var(--color-border);
        border-radius: 22px;
        background: var(--color-foam, #fff);
        color: var(--color-espresso);
        font-family: var(--font-sans);
        font-size: 15px;
        font-weight: 500;
        cursor: pointer;
      }
      .ec-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      input {
        width: 100%;
        box-sizing: border-box;
        height: 46px;
        padding: 0 14px;
        background: var(--color-foam, #fff);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        font-family: var(--font-sans);
        font-size: 15px;
        color: var(--color-text-primary);
        outline: none;
      }
      input:focus {
        border-color: var(--color-caramel);
      }
      .ec-code {
        font-size: 22px;
        letter-spacing: 0.4em;
        text-align: center;
      }
      .ec-primary {
        height: 46px;
        border: 0;
        border-radius: var(--radius-pill);
        background: var(--color-caramel);
        color: white;
        font-family: var(--font-sans);
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
      }
      .ec-primary:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .ec-hint {
        margin: 0;
        font-size: 14px;
        line-height: 1.5;
        color: var(--color-text-secondary);
      }
      .ec-row {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 8px 16px;
        font-size: 13px;
      }
      .ec-wait {
        color: var(--color-text-tertiary);
      }
      .ec-link {
        padding: 0;
        border: 0;
        background: none;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-caramel);
        text-decoration: underline;
        text-underline-offset: 2px;
        cursor: pointer;
      }
      .ec-link:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .ec-error {
        margin: 0;
        font-size: 13px;
        color: var(--color-berry);
      }
    `,
  ],
})
export class EmailCodeLoginComponent {
  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);

  /** The customer is in; the page decides where to go next. */
  readonly signedIn = output<void>();

  readonly step = signal<Step>('closed');
  readonly email = signal('');
  /** The address the current code went to. */
  readonly sentTo = signal('');
  readonly code = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  /** The code step was reached because a code had already gone out a moment ago. */
  readonly alreadySent = signal(false);
  /** Seconds until «Отправить код ещё раз» is offered. */
  readonly resendIn = signal(0);

  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopTimer());
  }

  open(): void {
    this.error.set(null);
    this.step.set('email');
    this.focusSoon(() => this.emailInput());
  }

  requestCode(): void {
    const email = this.email().trim().toLowerCase();
    if (this.busy() || !email) return;
    if (!EMAIL_PATTERN.test(email)) {
      this.error.set(this.translate.instant('web.auth.email.errors.invalidEmail'));
      return;
    }
    this.send(email);
  }

  resend(): void {
    if (this.busy() || this.resendIn() > 0) return;
    this.send(this.sentTo());
  }

  changeEmail(): void {
    this.stopTimer();
    this.resendIn.set(0);
    this.code.set('');
    this.error.set(null);
    this.step.set('email');
    this.focusSoon(() => this.emailInput());
  }

  onCodeInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 6);
    if (input.value !== digits) input.value = digits;
    this.code.set(digits);
    // Six digits — typed, pasted or offered by the browser — sign in at once.
    if (digits.length === 6) this.verify();
  }

  verify(): void {
    const code = this.code();
    if (this.busy() || code.length !== 6) return;
    this.busy.set(true);
    this.error.set(null);
    this.auth.verifyEmailCode(this.sentTo(), code).subscribe({
      next: () => {
        this.busy.set(false);
        this.stopTimer();
        this.signedIn.emit();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.code.set('');
        this.error.set(this.describe(err));
        this.focusSoon(() => this.codeInput());
      },
    });
  }

  private send(email: string): void {
    this.busy.set(true);
    this.error.set(null);
    const locale = this.translate.currentLang || this.translate.getDefaultLang() || 'ru';
    this.auth.startEmailSignIn(email, locale).subscribe({
      next: () => {
        this.busy.set(false);
        this.toCodeStep(email, RESEND_SECONDS, false);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const failure = asFailure(err);
        // A code went to this address a moment ago and still works: go and
        // type it, with the API's own wait on the resend link.
        if (failure.code === 'EMAIL_CODE_COOLDOWN') {
          this.toCodeStep(email, failure.retryAfterSeconds ?? RESEND_SECONDS, true);
          return;
        }
        this.error.set(this.describe(err));
      },
    });
  }

  private toCodeStep(email: string, wait: number, alreadySent: boolean): void {
    this.sentTo.set(email);
    this.alreadySent.set(alreadySent);
    this.code.set('');
    this.step.set('code');
    this.startTimer(wait);
    this.focusSoon(() => this.codeInput());
  }

  private startTimer(seconds: number): void {
    this.stopTimer();
    this.resendIn.set(Math.max(0, Math.ceil(seconds)));
    if (this.resendIn() === 0) return;
    this.timer = setInterval(() => {
      const left = this.resendIn() - 1;
      this.resendIn.set(Math.max(0, left));
      if (left <= 0) this.stopTimer();
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private focusSoon(target: () => ElementRef<HTMLInputElement> | undefined): void {
    setTimeout(() => target()?.nativeElement.focus());
  }

  private describe(err: unknown): string {
    const failure = asFailure(err);
    const t = (key: string, params?: Record<string, unknown>) =>
      this.translate.instant(`web.auth.email.errors.${key}`, params);
    switch (failure.code) {
      case 'EMAIL_CODE_INVALID':
        return t('invalid', { left: failure.attemptsLeft ?? 0 });
      case 'EMAIL_CODE_EXPIRED':
        return t('expired');
      case 'EMAIL_CODE_TOO_MANY_ATTEMPTS':
        return t('tooManyAttempts');
      case 'EMAIL_CODE_LIMIT':
        return t('limit', { minutes: Math.max(1, Math.ceil((failure.retryAfterSeconds ?? 3600) / 60)) });
      case 'EMAIL_CODE_NOT_SENT':
        return t('notSent');
      case 'EMAIL_LOGIN_UNAVAILABLE':
        return t('unavailable');
      case 'EMAIL_LOGIN_STAFF_ACCOUNT':
        return t('staffAccount');
      default:
        if (failure.status === 429) return t('tooManyRequests');
        if (failure.status === 0) return this.translate.instant('common.networkError');
        return this.translate.instant('common.genericError');
    }
  }
}

interface Failure {
  status?: number;
  code?: EmailLoginErrorCode;
  attemptsLeft?: number;
  retryAfterSeconds?: number;
}

/** The parts of an HttpErrorResponse the wording needs. */
function asFailure(err: unknown): Failure {
  const response = err as { status?: unknown; error?: Record<string, unknown> | null } | null;
  const body = response?.error ?? {};
  const number = (value: unknown) => (typeof value === 'number' ? value : undefined);
  return {
    status: number(response?.status),
    code: typeof body['code'] === 'string' ? (body['code'] as EmailLoginErrorCode) : undefined,
    attemptsLeft: number(body['attemptsLeft']),
    retryAfterSeconds: number(body['retryAfterSeconds']),
  };
}
