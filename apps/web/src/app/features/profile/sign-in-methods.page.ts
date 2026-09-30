import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { SignInMethods } from '@takeaway/shared-types';
import {
  AppleLoginButtonComponent,
  GoogleLoginButtonComponent,
  SOCIAL_AUTH_CONFIG,
  TELEGRAM_AUTH_CONFIG,
  TelegramOidcButtonComponent,
  type SocialAuthResult,
} from '@takeaway/ui-kit';
import type { Observable } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';

type Provider = 'telegram' | 'google' | 'apple';

const LABELS: Record<Provider, string> = { telegram: 'Telegram', google: 'Google', apple: 'Apple' };

/**
 * Profile → Sign-in methods. Shows which of Telegram, Google and Apple lead
 * into this profile and offers the same provider buttons as the login page
 * for the rest, so a customer who started in Telegram keeps one order
 * history when they later sign in with Google or Apple.
 */
@Component({
  selector: 'app-profile-sign-in-methods',
  standalone: true,
  imports: [
    TranslatePipe,
    RouterLink,
    GoogleLoginButtonComponent,
    AppleLoginButtonComponent,
    TelegramOidcButtonComponent,
  ],
  template: `
    <section style="min-height: calc(100vh - 72px); background: var(--color-cream); padding: 32px 16px">
      <div style="max-width: 540px; margin: 0 auto">
        <a
          routerLink="/profile"
          style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); text-decoration: none"
          >← {{ 'common.back' | translate }}</a
        >
        <h1 style="font-family: var(--font-display); font-size: 28px; color: var(--color-espresso); margin: 12px 0 8px">
          {{ 'web.profile.signInMethods.title' | translate }}
        </h1>
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0 0 24px">
          {{ 'web.profile.signInMethods.subtitle' | translate }}
        </p>

        @if (notice()) {
          <p
            style="font-family: var(--font-sans); font-size: 14px; color: var(--color-espresso); background: var(--color-latte); border-radius: 12px; padding: 12px 16px; margin: 0 0 16px"
          >
            {{ notice() }}
          </p>
        }

        @if (methods(); as m) {
          <div
            class="flex flex-col"
            style="gap: 4px; background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft); padding: 8px"
          >
            @for (provider of providers; track provider) {
              <div class="flex flex-col" style="gap: 10px; padding: 12px 16px; border-radius: 12px">
                <div class="flex items-center" style="gap: 12px">
                  <span class="flex-1 flex flex-col" style="gap: 2px">
                    <span
                      style="font-family: var(--font-sans); font-size: 15px; font-weight: 500; color: var(--color-text-primary)"
                      >{{ label(provider) }}</span
                    >
                    <span
                      style="font-family: var(--font-sans); font-size: 12px"
                      [style.color]="m[provider] ? 'var(--color-caramel)' : 'var(--color-text-tertiary)'"
                      >{{
                        (m[provider] ? 'web.profile.signInMethods.linked' : 'web.profile.signInMethods.notLinked')
                          | translate
                      }}</span
                    >
                  </span>
                  @if (m[provider] && provider !== 'telegram' && linkedCount(m) > 1) {
                    <button
                      type="button"
                      [disabled]="busy()"
                      (click)="unlink(provider)"
                      style="background: none; border: none; font-family: var(--font-sans); font-size: 14px; color: var(--color-berry); cursor: pointer"
                    >
                      {{ 'web.profile.signInMethods.unlink' | translate }}
                    </button>
                  }
                </div>

                @if (!m[provider]) {
                  @switch (provider) {
                    @case ('google') {
                      @if (googleClientId) {
                        <lib-google-login-button
                          [clientId]="googleClientId"
                          [locale]="uiLocale()"
                          [unavailableLabel]="'web.auth.googleUnavailable' | translate"
                          (auth)="link('google', $event)"
                        />
                      }
                    }
                    @case ('apple') {
                      @if (appleClientId) {
                        <lib-apple-login-button
                          [clientId]="appleClientId"
                          [redirectUri]="appleRedirectUri"
                          [label]="'web.auth.continueWithApple' | translate"
                          [unavailableLabel]="'web.auth.appleUnavailable' | translate"
                          (auth)="link('apple', $event)"
                        />
                      }
                    }
                    @case ('telegram') {
                      @if (telegramClientId) {
                        <lib-telegram-oidc-button
                          [clientId]="telegramClientId"
                          [lang]="uiLocale()"
                          [label]="'web.auth.continueWithTelegram' | translate"
                          [unavailableLabel]="'web.auth.telegramFailed' | translate"
                          (idToken)="link('telegram', { idToken: $event })"
                        />
                      }
                    }
                  }
                }
              </div>
            }
          </div>
        } @else if (!error()) {
          <p style="font-family: var(--font-sans); color: var(--color-text-secondary)">
            {{ 'common.loading' | translate }}
          </p>
        }

        @if (error()) {
          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin-top: 16px">
            {{ error() }}
          </p>
        }
      </div>
    </section>
  `,
})
export class ProfileSignInMethodsPage {
  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);
  private readonly telegramCfg = inject(TELEGRAM_AUTH_CONFIG);
  private readonly socialCfg = inject(SOCIAL_AUTH_CONFIG);

  readonly providers: readonly Provider[] = ['telegram', 'google', 'apple'];
  readonly telegramClientId = this.telegramCfg.clientId;
  readonly googleClientId = this.socialCfg.googleClientId;
  readonly appleClientId = this.socialCfg.appleClientId;
  readonly appleRedirectUri = this.socialCfg.appleRedirectUri;

  readonly methods = signal<SignInMethods | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  constructor() {
    this.auth.signInMethods().subscribe({
      next: (m) => this.methods.set(m),
      error: (err) => this.error.set(this.extractMessage(err)),
    });
  }

  label(provider: Provider): string {
    return LABELS[provider];
  }

  linkedCount(m: SignInMethods): number {
    return [m.telegram, m.google, m.apple].filter(Boolean).length;
  }

  uiLocale(): string {
    return this.translate.currentLang || this.translate.getDefaultLang() || 'en';
  }

  link(provider: Provider, result: SocialAuthResult): void {
    const body = result.name ? { idToken: result.idToken, name: result.name } : { idToken: result.idToken };
    this.run(this.auth.linkSignInMethod(provider, body), (outcome) => {
      this.methods.set(outcome.methods);
      this.notice.set(outcome.switched ? this.translate.instant('web.profile.signInMethods.switched') : null);
    });
  }

  unlink(provider: 'google' | 'apple' | 'telegram'): void {
    if (provider === 'telegram') return;
    const question = this.translate.instant('web.profile.signInMethods.unlinkConfirm', { provider: LABELS[provider] });
    if (!window.confirm(question)) return;
    this.run(this.auth.unlinkSignInMethod(provider), (m) => this.methods.set(m));
  }

  private run<T>(request: Observable<T>, done: (value: T) => void): void {
    this.busy.set(true);
    this.error.set(null);
    request.subscribe({
      next: (value) => {
        this.busy.set(false);
        done(value);
      },
      error: (err) => {
        this.busy.set(false);
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
