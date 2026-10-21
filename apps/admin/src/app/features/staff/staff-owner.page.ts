import { Component, effect, inject, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { extractMessage } from '../../core/http/extract-message';
import {
  type BrandOwner,
  type SetOwnerRequest,
  type StaffPasswordReset,
  StaffService,
} from '../../core/staff/staff.service';
import { FormPageComponent } from '../../shared/form-page.component';
import { staffErrorMessage } from './staff-errors';

/**
 * The brand owner (SUPER_ADMIN only), on its own route: set or replace the
 * owner, and «Сбросить пароль» of the current one — on a server without
 * mail an owner who forgot the password had no other way back.
 */
@Component({
  selector: 'app-staff-owner',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, FormPageComponent],
  template: `
    <app-form-page
      [backTo]="['/staff']"
      backLabel="admin.staff.title"
      title="admin.staff.owner.title"
      [subtitle]="hint"
      saveLabel="admin.staff.owner.cta"
      [saveDisabled]="form.invalid"
      [saving]="saving()"
      [error]="error()"
      (save)="submit()"
    >
      @if (owner(); as o) {
        <section class="owner" aria-labelledby="owner-current" data-testid="owner-current">
          <h2 id="owner-current">{{ 'admin.staff.owner.current' | translate }}</h2>
          <p class="owner-name">{{ o.name || o.email }}</p>
          @if (o.email) {
            <p class="owner-email">{{ o.email }}</p>
          }

          <h3>{{ 'admin.staff.password.title' | translate }}</h3>
          @if (passwordReset(); as r) {
            <p class="note">{{ 'admin.staff.owner.passwordDone' | translate }}</p>
            <div class="row">
              <code class="temp-password" data-testid="owner-temp-password">{{ r.tempPassword }}</code>
              <button type="button" class="primary" (click)="copy(r.tempPassword)">
                {{ (copied() ? 'admin.staff.tablets.copied' : 'admin.staff.tablets.copy') | translate }}
              </button>
            </div>
            <p class="warn">{{ 'admin.staff.password.showOnce' | translate }}</p>
            @switch (r.resetEmail) {
              @case ('SENT') {
                <p class="note">{{ 'admin.staff.password.emailSent' | translate: { email: o.email } }}</p>
              }
              @case ('FAILED') {
                <p class="note">{{ 'admin.staff.owner.emailFailed' | translate }}</p>
              }
              @default {
                <p class="note">{{ 'admin.staff.owner.emailOff' | translate }}</p>
              }
            }
          } @else {
            <p class="note">{{ 'admin.staff.owner.passwordHint' | translate }}</p>
            <div class="row">
              <button
                type="button"
                class="outline"
                data-testid="owner-reset-password"
                [disabled]="resetting()"
                (click)="resetPassword(o)"
              >
                {{ 'admin.staff.password.reset' | translate }}
              </button>
            </div>
          }
          @if (resetError(); as message) {
            <p role="alert" class="err">{{ message }}</p>
          }
        </section>
      }

      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col" style="gap: 14px">
        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.staff.email' | translate }}</span>
            <input formControlName="email" type="email" autocapitalize="none" spellcheck="false" class="field-input" />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.staff.name' | translate }}</span>
            <input formControlName="name" type="text" autocomplete="name" class="field-input" />
          </label>
        </div>

        <label class="field">
          <span class="field-label">{{ 'admin.staff.owner.tempPasswordHint' | translate }}</span>
          <input
            formControlName="tempPassword"
            type="text"
            autocomplete="off"
            class="field-input field-input-mono"
            [placeholder]="'admin.staff.owner.tempPasswordPlaceholder' | translate"
          />
        </label>
      </form>
    </app-form-page>
  `,
  styles: [
    `
      .owner {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 20px;
        padding-bottom: 20px;
        border-bottom: 1px solid var(--color-border-light);
        font-family: var(--font-sans);
      }
      .owner h2,
      .owner h3 {
        margin: 0;
        font-family: var(--font-display);
        color: var(--color-espresso);
      }
      .owner h2 {
        font-size: 18px;
      }
      .owner h3 {
        margin-top: 8px;
        font-size: 16px;
      }
      .owner-name,
      .owner-email,
      .note,
      .warn,
      .err {
        margin: 0;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .owner-name {
        font-size: 15px;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .owner-email {
        font-family: var(--font-mono);
        overflow-wrap: anywhere;
      }
      .warn,
      .err {
        color: var(--color-berry);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .temp-password {
        padding: 8px 12px;
        background: var(--color-cream);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        font-family: var(--font-mono);
        font-size: 16px;
        letter-spacing: 0.08em;
        user-select: all;
      }
      .primary,
      .outline {
        height: 38px;
        padding: 0 16px;
        border-radius: var(--radius-button);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .primary {
        background: var(--color-caramel);
        color: white;
        border: 0;
      }
      .outline {
        background: transparent;
        color: var(--color-espresso);
        border: 1px solid var(--color-border);
      }
      .outline:disabled {
        opacity: 0.5;
      }
    `,
  ],
})
export class StaffOwnerPage {
  private readonly staffApi = inject(StaffService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly brandCtx = inject(ActiveBrandService);

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly hint: string = this.translate.instant('admin.staff.owner.subtitle');

  /** The brand's owner now, if there is one. */
  readonly owner = signal<BrandOwner | null>(null);
  readonly passwordReset = signal<StaffPasswordReset | null>(null);
  readonly resetting = signal(false);
  readonly resetError = signal<string | null>(null);
  readonly copied = signal(false);

  readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    name: new FormControl('', { nonNullable: true }),
    tempPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.minLength(8), Validators.maxLength(128)],
    }),
  });

  constructor() {
    effect(() => {
      const brandId = this.brandCtx.activeId();
      untracked(() => {
        this.owner.set(null);
        this.passwordReset.set(null);
        this.resetError.set(null);
        if (!brandId) return;
        this.staffApi.getOwner(brandId).subscribe({
          next: (owner) => this.owner.set(owner),
          error: () => this.owner.set(null),
        });
      });
    });
  }

  /**
   * A temporary password for the owner, shown here once; every session of
   * the owner ends, and a link to set their own goes out when the server
   * can send mail.
   */
  resetPassword(owner: BrandOwner): void {
    const brandId = this.brandCtx.activeId();
    if (!brandId || this.resetting()) return;
    const name = owner.name || owner.email || '';
    if (!window.confirm(this.translate.instant('admin.staff.owner.passwordConfirm', { name }))) return;
    this.resetting.set(true);
    this.resetError.set(null);
    this.staffApi.resetOwnerPassword(brandId).subscribe({
      next: (result) => {
        this.resetting.set(false);
        this.copied.set(false);
        this.passwordReset.set(result);
      },
      error: (err) => {
        this.resetting.set(false);
        this.resetError.set(staffErrorMessage(err, this.translate));
      },
    });
  }

  copy(password: string): void {
    void navigator.clipboard?.writeText(password).then(
      () => this.copied.set(true),
      () => undefined,
    );
  }

  submit(): void {
    const brandId = this.brandCtx.activeId();
    if (!brandId || this.form.invalid) return;
    this.saving.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    const body: SetOwnerRequest = { email: v.email.trim().toLowerCase() };
    if (v.name.trim()) body.name = v.name.trim();
    if (v.tempPassword.trim()) body.tempPassword = v.tempPassword.trim();
    this.staffApi.setOwner(brandId, body).subscribe({
      next: () => this.router.navigate(['/staff']),
      error: (err) => {
        this.saving.set(false);
        this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
      },
    });
  }
}
