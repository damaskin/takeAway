import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { TELEGRAM_AUTH_CONFIG, TelegramLoginButtonComponent, type TelegramLoginWidgetUser } from '@takeaway/ui-kit';

import { AuthService } from '../../core/auth/auth.service';

/**
 * Web Authentication.
 *
 * Layout:
 *   authLeft (fill, cream) — logo, H1 "Welcome back", subtitle, Telegram Login
 *     Widget centered in a 400px column, small agreement footer.
 *   authRight (560px) — branded hero photograph, hidden below md.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [TranslatePipe, TelegramLoginButtonComponent],
  template: `
    <section class="flex" style="min-height: calc(100vh - 72px); background: var(--color-cream)">
      <!-- Left column: Telegram sign-in -->
      <div class="flex flex-col justify-center" style="flex: 1; padding: 64px 80px; gap: 40px">
        <span
          style="font-family: var(--font-display); font-size: 28px; font-weight: 700; color: var(--color-caramel)"
          >{{ 'common.brand' | translate }}</span
        >

        <div class="flex flex-col" style="gap: 8px">
          <h1
            style="font-family: var(--font-display); font-size: 40px; font-weight: 700; color: var(--color-espresso); margin: 0"
          >
            {{ 'web.auth.welcomeBack' | translate }}
          </h1>
          <p style="font-family: var(--font-sans); font-size: 16px; color: var(--color-text-secondary); margin: 0">
            {{ 'web.auth.telegramPrompt' | translate }}
          </p>
        </div>

        <div style="width: 400px; max-width: 100%" class="flex flex-col" style="gap: 20px">
          @if (telegramBotUsername) {
            <div class="flex justify-center py-4">
              <lib-telegram-login-button [botUsername]="telegramBotUsername" (auth)="signInWithTelegram($event)" />
            </div>
          } @else {
            <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-berry)">
              {{ 'web.auth.telegramUnavailable' | translate }}
            </p>
          }

          @if (loading()) {
            <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)">
              {{ 'web.auth.signingIn' | translate }}
            </p>
          }
          @if (error()) {
            <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">{{ error() }}</p>
          }
        </div>

        <p style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); margin: 0">
          {{ 'web.auth.agreement' | translate }}
        </p>
      </div>

      <!-- Right column: hero photograph -->
      <div
        style="width: 560px; background-image: linear-gradient(160deg, var(--color-caramel) 0%, #a0612a 100%); background-size: cover; background-position: center"
        class="hidden md:flex items-end"
      >
        <div style="padding: 48px; color: white">
          <span style="font-family: var(--font-display); font-size: 28px; font-weight: 700; line-height: 1.2">{{
            'web.home.hero.title' | translate
          }}</span>
          <p
            style="margin-top: 12px; font-family: var(--font-sans); font-size: 14px; color: rgba(255, 255, 255, 0.85); line-height: 1.5"
          >
            {{ 'web.home.hero.subtitle' | translate }}
          </p>
        </div>
      </div>
    </section>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly telegramCfg = inject(TELEGRAM_AUTH_CONFIG);

  readonly telegramBotUsername = this.telegramCfg.botUsername;
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  signInWithTelegram(user: TelegramLoginWidgetUser): void {
    this.loading.set(true);
    this.error.set(null);
    this.auth.verifyTelegramWidget(user).subscribe({
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
}

function extractMessage(err: unknown): string {
  const maybe = err as { error?: { message?: unknown }; message?: unknown };
  if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
  if (typeof maybe.message === 'string') return maybe.message;
  return 'Something went wrong, please try again';
}
