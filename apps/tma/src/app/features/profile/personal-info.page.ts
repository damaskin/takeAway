import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { normalizePhone } from '@takeaway/utils';

import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { ProfileApi, type ProfilePatch } from '../../core/profile/profile.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * «Личные данные» in the Mini App — the website's `/profile/personal`
 * (`PATCH /auth/me`). The name is shown, not edited: the Mini App signs in
 * from Telegram on every launch and the API takes the name from there, so
 * an edit here would be gone by the next launch. Email, phone and birthday
 * are the customer's to change. Telegram's back button returns to the
 * profile.
 */
@Component({
  selector: 'app-tma-personal-info',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <section
      style="padding: 16px; padding-bottom: var(--tma-page-bottom); display: flex; flex-direction: column; gap: 16px"
    >
      <div class="flex flex-col" style="gap: 4px">
        <h1
          style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
        >
          {{ 'web.profile.personalInfo.title' | translate }}
        </h1>
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
          {{ 'web.profile.personalInfo.subtitle' | translate }}
        </p>
      </div>

      <div class="flex flex-col" style="gap: 6px">
        <span class="tpi-label">{{ 'web.profile.personalInfo.name' | translate }}</span>
        <div data-testid="name" class="tpi-field tpi-readonly flex items-center">{{ name() || '—' }}</div>
        <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
          'tma.profile.personal.nameFromTelegram' | translate
        }}</span>
      </div>

      <label class="flex flex-col" style="gap: 6px">
        <span class="tpi-label">{{ 'web.profile.personalInfo.email' | translate }}</span>
        <input
          name="email"
          type="email"
          autocomplete="email"
          autocapitalize="none"
          spellcheck="false"
          [value]="email()"
          (input)="email.set($any($event.target).value)"
          [disabled]="saving()"
          class="tpi-field"
        />
      </label>

      <label class="flex flex-col" style="gap: 6px">
        <span class="tpi-label">{{ 'web.profile.personalInfo.phone' | translate }}</span>
        <input
          name="phone"
          type="tel"
          autocomplete="tel"
          placeholder="+373 69 123 456"
          [value]="phone()"
          (input)="phone.set($any($event.target).value)"
          [disabled]="saving()"
          class="tpi-field"
        />
      </label>

      <label class="flex flex-col" style="gap: 6px">
        <span class="tpi-label">{{ 'web.profile.personalInfo.dob' | translate }}</span>
        <input
          name="dateOfBirth"
          type="date"
          [value]="dateOfBirth()"
          (input)="dateOfBirth.set($any($event.target).value)"
          [disabled]="saving()"
          class="tpi-field"
        />
      </label>

      @if (!signedIn()) {
        <!-- No session means the API could not be reached at launch; the guard keeps retrying. -->
        <p
          class="text-center"
          style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0"
        >
          {{ 'tma.orders.offlineTitle' | translate }}
        </p>
      }
      @if (error()) {
        <p
          role="alert"
          class="text-center"
          style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0"
        >
          {{ error() }}
        </p>
      }
      @if (saved()) {
        <p
          role="status"
          class="text-center"
          style="font-family: var(--font-sans); font-size: 13px; color: var(--color-mint); margin: 0"
        >
          {{ 'web.profile.personalInfo.saved' | translate }}
        </p>
      }

      <button
        type="button"
        class="tpi-primary"
        (click)="save()"
        [disabled]="!canSave()"
        [style.opacity]="canSave() ? '1' : '0.5'"
      >
        {{ (saving() ? 'web.profile.personalInfo.saving' : 'common.save') | translate }}
      </button>
    </section>
  `,
  styles: [
    `
      .tpi-label {
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .tpi-field {
        height: 48px;
        padding: 0 12px;
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: var(--radius-input);
        font-family: var(--font-sans);
        font-size: 15px;
        color: var(--color-text-primary);
        outline: none;
      }
      .tpi-field:focus {
        border-color: var(--color-caramel);
      }
      .tpi-readonly {
        background: transparent;
        color: var(--color-text-secondary);
      }
      .tpi-primary {
        height: 48px;
        border-radius: var(--radius-button);
        background: var(--color-caramel);
        color: white;
        font-family: var(--font-sans);
        font-size: 14px;
        font-weight: 600;
      }
    `,
  ],
})
export class TmaPersonalInfoPage implements OnInit, OnDestroy {
  private readonly api = inject(ProfileApi);
  private readonly authStore = inject(TmaAuthStore);
  private readonly tg = inject(TelegramBridgeService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly name = computed(() => this.authStore.user()?.name ?? this.tg.telegramUser?.name ?? '');
  readonly email = signal(this.authStore.user()?.email ?? '');
  readonly phone = signal(this.authStore.user()?.phone ?? '');
  /** The profile does not send the birthday back, so it starts empty; an empty one is left as it is. */
  readonly dateOfBirth = signal('');
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly error = signal<string | null>(null);

  readonly signedIn = this.authStore.isAuthenticated;
  readonly canSave = computed(() => !this.saving() && this.signedIn());

  private detachBack: (() => void) | null = null;

  ngOnInit(): void {
    this.detachBack = this.tg.setBackButton(() => void this.router.navigate(['/profile']));
  }

  ngOnDestroy(): void {
    this.detachBack?.();
  }

  save(): void {
    if (!this.canSave()) return;
    this.saved.set(false);
    const patch = this.patch();
    if (typeof patch === 'string') {
      this.error.set(this.translate.instant(patch));
      return;
    }
    this.error.set(null);
    this.saving.set(true);
    this.tg.haptic('light');
    this.api.updateMe(patch).subscribe({
      next: (user) => {
        this.saving.set(false);
        this.saved.set(true);
        this.email.set(user.email ?? '');
        this.phone.set(user.phone ?? '');
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(this.describe(err));
      },
    });
  }

  /** The change to send, or the translation key of what is wrong with it. */
  private patch(): ProfilePatch | string {
    const patch: ProfilePatch = {};
    const email = this.email().trim().toLowerCase();
    if (email) {
      if (!EMAIL.test(email)) return 'tma.profile.personal.emailInvalid';
      patch.email = email;
    }
    const rawPhone = this.phone().trim();
    if (rawPhone) {
      const phone = normalizePhone(rawPhone);
      if (!phone) return 'tma.profile.personal.phoneInvalid';
      patch.phone = phone;
    }
    if (this.dateOfBirth()) patch.dateOfBirth = this.dateOfBirth();
    return patch;
  }

  private describe(err: unknown): string {
    const body = (err as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    if (body?.code === 'EMAIL_IS_SIGN_IN_METHOD')
      return this.translate.instant('web.profile.personalInfo.emailIsSignIn');
    if ((err as { status?: unknown } | null)?.status === 0) return this.translate.instant('common.networkError');
    const raw = body?.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw;
    return typeof message === 'string' && message ? message : this.translate.instant('common.genericError');
  }
}
