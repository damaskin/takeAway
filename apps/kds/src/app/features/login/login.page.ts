import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TELEGRAM_AUTH_CONFIG, TelegramLoginButtonComponent, type TelegramLoginWidgetUser } from '@takeaway/ui-kit';

import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-kds-login',
  standalone: true,
  imports: [LanguageSwitcherComponent, TranslatePipe, TelegramLoginButtonComponent],
  template: `
    <main
      class="min-h-screen flex items-center justify-center"
      style="background: var(--color-cream); color: var(--color-text-primary); padding: 16px"
    >
      <section
        class="w-full max-w-md"
        style="background: var(--color-foam); border-radius: var(--radius-card); padding: 32px; box-shadow: var(--shadow-soft)"
      >
        <div class="flex items-center justify-between mb-2">
          <h1
            class="text-3xl"
            style="font-family: var(--font-display); color: var(--color-espresso); font-weight: 700; margin: 0"
          >
            {{ 'kds.login.title' | translate }}
          </h1>
          <app-language-switcher />
        </div>
        <p class="mb-6" style="color: var(--color-text-secondary); font-family: var(--font-sans); font-size: 14px">
          {{ 'kds.login.telegramPrompt' | translate }}
        </p>

        @if (telegramBotUsername) {
          <div class="flex justify-center py-4">
            <lib-telegram-login-button [botUsername]="telegramBotUsername" (auth)="signInWithTelegram($event)" />
          </div>
        } @else {
          <p class="text-sm" style="color: var(--color-berry); font-family: var(--font-sans)">
            {{ 'kds.login.telegramUnavailable' | translate }}
          </p>
        }

        @if (loading()) {
          <p class="mt-4 text-sm" style="color: var(--color-text-secondary); font-family: var(--font-sans)">
            {{ 'kds.login.signingIn' | translate }}
          </p>
        }
        @if (error()) {
          <p class="mt-4 text-sm" style="color: var(--color-berry); font-family: var(--font-sans)">{{ error() }}</p>
        }
      </section>
    </main>
  `,
})
export class KdsLoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
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
