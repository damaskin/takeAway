import { Component, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TELEGRAM_AUTH_CONFIG, TelegramLoginButtonComponent, type TelegramLoginWidgetUser } from '@takeaway/ui-kit';

import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';

/**
 * Staff Telegram link page — lets BRAND_ADMIN / STORE_MANAGER / STAFF
 * bind their Telegram chat id to the account so the bot can push them
 * order events. Not an auth flow — they must already be signed in with
 * email + password.
 */
@Component({
  selector: 'app-telegram-link',
  standalone: true,
  imports: [TranslatePipe, TelegramLoginButtonComponent],
  template: `
    <section style="padding: 32px; max-width: 640px">
      <h1 style="font-family: var(--font-display); font-size: 28px; color: var(--color-espresso); margin: 0 0 8px">
        {{ 'admin.telegramLink.title' | translate }}
      </h1>
      <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0 0 24px">
        {{ 'admin.telegramLink.subtitle' | translate }}
      </p>

      <div
        style="background: var(--color-foam); border-radius: var(--radius-card); padding: 24px; box-shadow: var(--shadow-soft); display: flex; flex-direction: column; gap: 16px"
      >
        @if (linkedId()) {
          <p
            style="font-family: var(--font-sans); font-size: 14px; color: var(--color-mint); margin: 0; font-weight: 600"
          >
            {{ 'admin.telegramLink.linked' | translate }} · id: {{ linkedId() }}
          </p>
          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.telegramLink.linkedNote' | translate }}
          </p>
        } @else {
          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.telegramLink.startHint' | translate }}
          </p>
        }

        @if (botUsername) {
          <div class="flex justify-start">
            <lib-telegram-login-button [botUsername]="botUsername" (auth)="onTelegramAuth($event)" />
          </div>
        } @else {
          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0">
            {{ 'admin.telegramLink.unavailable' | translate }}
          </p>
        }

        @if (loading()) {
          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.telegramLink.linking' | translate }}
          </p>
        }
        @if (error()) {
          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0">
            {{ error() }}
          </p>
        }
      </div>
    </section>
  `,
})
export class TelegramLinkPage {
  private readonly auth = inject(AuthService);
  private readonly store = inject(AuthStore);
  private readonly cfg = inject(TELEGRAM_AUTH_CONFIG);
  private readonly translate = inject(TranslateService);

  readonly botUsername = this.cfg.botUsername;
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly linkedId = (): string | null => this.store.user()?.telegramUserId ?? null;

  onTelegramAuth(payload: TelegramLoginWidgetUser): void {
    this.loading.set(true);
    this.error.set(null);
    this.auth.linkTelegram(payload).subscribe({
      next: () => {
        this.loading.set(false);
        // linkTelegram's response is the updated AuthUser (now including
        // telegramUserId) and the service already wrote it into the store;
        // no extra /auth/me round-trip needed.
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
