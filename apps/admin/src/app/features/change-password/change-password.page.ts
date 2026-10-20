import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { STAFF_PASSWORD_MAX_LENGTH, STAFF_PASSWORD_MIN_LENGTH } from '@takeaway/shared-types';
import { startWith } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';
import { apiErrorMessage } from '../../core/http/api-error';

/** How the API's refusals read on this screen. Every value is a translation key. */
const ERRORS = {
  codes: {
    CURRENT_PASSWORD_INCORRECT: 'admin.changePassword.errors.currentIncorrect',
    PASSWORD_UNCHANGED: 'admin.changePassword.errors.unchanged',
  },
  messages: {
    'Current password is incorrect': 'admin.changePassword.errors.currentIncorrect',
    'Account has no password set': 'admin.changePassword.errors.cannotChange',
    'Account cannot change password here': 'admin.changePassword.errors.cannotChange',
  },
  statuses: { 429: 'admin.changePassword.errors.tooMany' },
  fields: { currentPassword: 'admin.changePassword.current', newPassword: 'admin.changePassword.next' },
  invalidField: 'admin.changePassword.errors.invalidField',
  network: 'common.networkError',
};

/**
 * Password change. Forced on the first sign-in of an invited staff user
 * (their account has `passwordMustChange=true`): after a successful change
 * the `mustChangePassword` flag flips off and the app goes on to the
 * dashboard. Also opened at will from «Сменить пароль» next to «Выйти» —
 * then with a way back, and a word that the other devices are signed out.
 * A kitchen PIN session has no password to change here.
 *
 * The rule for the new password (`STAFF_PASSWORD_*`, the one the API
 * enforces) is written under the field, the new password is typed twice,
 * and the temporary one cannot be kept — the screen says so before the
 * round-trip instead of answering with the API's English.
 */
@Component({
  selector: 'app-change-password',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, RouterLink],
  template: `
    <main class="min-h-screen flex items-center justify-center" style="background: var(--color-cream)">
      <section
        class="w-full max-w-sm p-8 shadow-[var(--shadow-soft)]"
        style="background: var(--color-foam); border-radius: var(--radius-card)"
      >
        @if (!forced()) {
          <a
            routerLink="/"
            class="text-sm"
            data-testid="change-password-back"
            style="display: inline-block; margin-bottom: 12px; color: var(--color-caramel); text-decoration: none"
            >{{ 'admin.changePassword.back' | translate }}</a
          >
        }
        <h1 style="font-family: var(--font-display); font-size: 22px; color: var(--color-espresso); margin: 0 0 6px">
          {{ (forced() ? 'admin.changePassword.title' : 'admin.changePassword.titleVoluntary') | translate }}
        </h1>
        <p class="text-sm mb-6" style="color: var(--color-espresso); opacity: 0.7">
          {{ (forced() ? 'admin.changePassword.subtitle' : 'admin.changePassword.subtitleVoluntary') | translate }}
        </p>

        @if (kitchenSession()) {
          <p class="text-sm" role="note" data-testid="change-password-pin-session" style="color: var(--color-espresso)">
            {{ 'admin.changePassword.pinSession' | translate }}
          </p>
        } @else if (done()) {
          <p class="text-sm" role="status" data-testid="change-password-done" style="color: var(--color-mint)">
            {{ 'admin.changePassword.done' | translate }}
          </p>
        } @else {
          <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-4">
            <label class="flex flex-col gap-1">
              <span class="text-sm font-medium">{{ 'admin.changePassword.current' | translate }}</span>
              <input
                formControlName="currentPassword"
                type="password"
                autocomplete="current-password"
                class="px-3 py-2 border outline-none"
                style="border-color: var(--color-latte); border-radius: var(--radius-input)"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-sm font-medium">{{ 'admin.changePassword.next' | translate }}</span>
              <input
                formControlName="newPassword"
                type="password"
                autocomplete="new-password"
                [attr.minlength]="rule.min"
                [attr.maxlength]="rule.max"
                aria-describedby="change-password-rule"
                class="px-3 py-2 border outline-none"
                style="border-color: var(--color-latte); border-radius: var(--radius-input)"
              />
              <span
                id="change-password-rule"
                class="text-xs"
                data-testid="password-rule"
                [style.color]="newProblem() ? 'var(--color-berry)' : 'var(--color-text-tertiary)'"
                >{{ newProblem() ?? 'admin.changePassword.rule' | translate: rule }}</span
              >
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-sm font-medium">{{ 'admin.changePassword.confirm' | translate }}</span>
              <input
                formControlName="confirmPassword"
                type="password"
                autocomplete="new-password"
                [attr.maxlength]="rule.max"
                class="px-3 py-2 border outline-none"
                style="border-color: var(--color-latte); border-radius: var(--radius-input)"
              />
              @if (mismatch()) {
                <span class="text-xs" style="color: var(--color-berry)" data-testid="password-mismatch">{{
                  'admin.changePassword.errors.mismatch' | translate
                }}</span>
              }
            </label>
            <button
              type="submit"
              [disabled]="!canSubmit() || loading()"
              class="py-2 font-medium disabled:opacity-50"
              style="background: var(--color-caramel); color: white; border-radius: var(--radius-button)"
            >
              {{ (loading() ? 'admin.changePassword.saving' : 'admin.changePassword.save') | translate }}
            </button>
          </form>
        }

        @if (error()) {
          <p class="mt-4 text-sm" style="color: var(--color-berry)" role="alert">{{ error() }}</p>
        }
      </section>
    </main>
  `,
})
export class ChangePasswordPage {
  private readonly auth = inject(AuthService);
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  /** Sent here at the first sign-in with a temporary password — no way around it, nowhere to go back to. */
  readonly forced = signal(this.store.mustChangePassword());
  readonly kitchenSession = this.store.kitchenSession;
  /** Changed at will: the page stays, says so, and offers the way back. */
  readonly done = signal(false);

  readonly rule = { min: STAFF_PASSWORD_MIN_LENGTH, max: STAFF_PASSWORD_MAX_LENGTH };
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    currentPassword: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    newPassword: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(STAFF_PASSWORD_MIN_LENGTH),
        Validators.maxLength(STAFF_PASSWORD_MAX_LENGTH),
      ],
    }),
    confirmPassword: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  private readonly value = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  /**
   * What is wrong with the new password as typed so far, as a translation
   * key; null while it is fine or still empty — the rule is shown then.
   */
  readonly newProblem = computed<string | null>(() => {
    const { currentPassword = '', newPassword = '' } = this.value();
    if (!newPassword) return null;
    if (newPassword.length < STAFF_PASSWORD_MIN_LENGTH) return 'admin.changePassword.errors.tooShort';
    if (newPassword.length > STAFF_PASSWORD_MAX_LENGTH) return 'admin.changePassword.errors.tooLong';
    if (newPassword === currentPassword) return 'admin.changePassword.errors.unchanged';
    return null;
  });

  /** The repeat was typed and is not the same password. */
  readonly mismatch = computed(() => {
    const { newPassword = '', confirmPassword = '' } = this.value();
    return confirmPassword.length > 0 && confirmPassword !== newPassword;
  });

  readonly canSubmit = computed(() => {
    const { currentPassword = '', newPassword = '', confirmPassword = '' } = this.value();
    return !!currentPassword && !!newPassword && newPassword === confirmPassword && this.newProblem() === null;
  });

  submit(): void {
    if (!this.canSubmit() || this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    this.auth.changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword }).subscribe({
      next: () => {
        this.loading.set(false);
        // clearMustChangePassword already flipped inside the service.
        if (this.forced()) {
          void this.router.navigate(['/']);
          return;
        }
        this.form.reset();
        this.done.set(true);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(apiErrorMessage(err, this.translate, ERRORS));
      },
    });
  }
}
