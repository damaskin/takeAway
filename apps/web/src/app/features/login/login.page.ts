import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import {
  AppleLoginButtonComponent,
  GoogleLoginButtonComponent,
  SOCIAL_AUTH_CONFIG,
  TELEGRAM_AUTH_CONFIG,
  TelegramLoginButtonComponent,
  type SocialAuthResult,
  type TelegramLoginWidgetUser,
} from '@takeaway/ui-kit';
import { Observable } from 'rxjs';
import type { AuthSession } from '@takeaway/shared-types';

import { AuthService } from '../../core/auth/auth.service';

/**
 * Web Authentication.
 *
 * Layout:
 *   authLeft (fill, cream) — logo, H1 "Welcome back", the three sign-in
 *     providers stacked in a 400px column, small agreement footer.
 *   authRight (560px) — branded hero photograph, hidden below md.
 *
 * Provider order is deliberate: Google first (largest share on the launch
 * markets), then Apple (required alongside it on iOS Safari), then Telegram
 * below a divider — it is the odd one out for a Dubai or London customer,
 * but the whole Mini App audience arrives with it.
 *
 * Every provider is optional. A deployment that configures none of them
 * shows the "no sign-in configured" note rather than an empty column.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [TranslatePipe, TelegramLoginButtonComponent, GoogleLoginButtonComponent, AppleLoginButtonComponent],
  template: `
    <section class="flex" style="min-height: calc(100vh - 72px); background: var(--color-cream)">
      <!-- Left column: sign-in providers -->
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
            {{ 'web.auth.prompt' | translate }}
          </p>
        </div>

        <div class="flex flex-col" style="width: 400px; max-width: 100%; gap: 12px">
          @if (googleClientId) {
            <lib-google-login-button
              [clientId]="googleClientId"
              [locale]="uiLocale()"
              [unavailableLabel]="'web.auth.googleUnavailable' | translate"
              (auth)="signInWithGoogle($event)"
            />
          }

          @if (appleClientId) {
            <lib-apple-login-button
              [clientId]="appleClientId"
              [redirectUri]="appleRedirectUri"
              [label]="'web.auth.continueWithApple' | translate"
              [unavailableLabel]="'web.auth.appleUnavailable' | translate"
              (auth)="signInWithApple($event)"
            />
          }

          @if (telegramBotUsername) {
            @if (googleClientId || appleClientId) {
              <div class="flex items-center" style="gap: 12px; margin: 4px 0">
                <span style="flex: 1; height: 1px; background: var(--color-border)"></span>
                <span
                  style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.06em"
                  >{{ 'web.auth.or' | translate }}</span
                >
                <span style="flex: 1; height: 1px; background: var(--color-border)"></span>
              </div>
            }
            <div class="flex justify-center">
              <lib-telegram-login-button [botUsername]="telegramBotUsername" (auth)="signInWithTelegram($event)" />
            </div>
          }

          @if (!googleClientId && !appleClientId && !telegramBotUsername) {
            <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-berry)">
              {{ 'web.auth.noProviders' | translate }}
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
  private readonly translate = inject(TranslateService);
  private readonly telegramCfg = inject(TELEGRAM_AUTH_CONFIG);
  private readonly socialCfg = inject(SOCIAL_AUTH_CONFIG);

  readonly telegramBotUsername = this.telegramCfg.botUsername;
  readonly googleClientId = this.socialCfg.googleClientId;
  readonly appleClientId = this.socialCfg.appleClientId;
  readonly appleRedirectUri = this.socialCfg.appleRedirectUri;

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** BCP-47 tag for Google's button chrome. */
  uiLocale(): string {
    return this.translate.currentLang || this.translate.getDefaultLang() || 'en';
  }

  signInWithGoogle(result: SocialAuthResult): void {
    this.run(this.auth.signInWithGoogle(result.idToken));
  }

  signInWithApple(result: SocialAuthResult): void {
    this.run(this.auth.signInWithApple(result.idToken, result.name));
  }

  signInWithTelegram(user: TelegramLoginWidgetUser): void {
    this.run(this.auth.verifyTelegramWidget(user));
  }

  private run(request: Observable<AuthSession>): void {
    this.loading.set(true);
    this.error.set(null);
    request.subscribe({
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
