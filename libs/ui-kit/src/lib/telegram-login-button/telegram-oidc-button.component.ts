import { Component, EventEmitter, Input, NgZone, Output, inject, signal } from '@angular/core';

import { loadExternalScript } from '../social-login/social-auth.config';

const TELEGRAM_LOGIN_SRC = 'https://oauth.telegram.org/js/telegram-login.js?6';

interface TelegramLoginResult {
  id_token?: string;
  error?: string;
}

interface TelegramLoginApi {
  auth(
    options: { client_id: string; request_access?: string[]; lang?: string },
    callback: (result: TelegramLoginResult) => void,
  ): void;
}

/**
 * "Log in with Telegram" — Telegram Login, the OpenID Connect successor of
 * the Login Widget (https://core.telegram.org/bots/telegram-login).
 *
 * Telegram's library opens its popup and calls back with an ID token; we
 * emit it for the page to POST to `/auth/telegram/oidc` (or `…/link/oidc`),
 * where the API verifies it against Telegram's keys. The popup reports back
 * through `window.opener`, so the page must not be served with
 * `Cross-Origin-Opener-Policy: same-origin` — our nginx sets no COOP.
 *
 * The button is our own markup rather than the library's auto-styled one,
 * so it sits in the same column as Google and Apple: Telegram blue, the
 * paper plane, one line of text.
 */
@Component({
  selector: 'lib-telegram-oidc-button',
  standalone: true,
  template: `
    <button
      type="button"
      [disabled]="busy()"
      (click)="signIn()"
      style="
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        height: 44px;
        padding: 0 20px;
        border: none;
        border-radius: 22px;
        background: #2aabee;
        color: #fff;
        font-family: var(--font-sans, system-ui), sans-serif;
        font-size: 15px;
        font-weight: 500;
      "
      [style.opacity]="busy() ? '0.6' : '1'"
      [style.cursor]="busy() ? 'progress' : 'pointer'"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path
          d="M21.4 3.6 2.9 10.8c-1 .4-1 1.6.1 1.9l4.6 1.4 1.8 5.6c.3.8 1.3 1 1.9.4l2.6-2.4 4.6 3.4c.7.5 1.6.1 1.8-.7l3.1-14.8c.2-1.1-.9-2-1.9-1.6Zm-3.6 4.1-7.6 6.9-.3 3.2-1.3-4.2 8.7-5.4c.4-.2.8.3.5.5Z"
        />
      </svg>
      <span>{{ label }}</span>
    </button>
    @if (error()) {
      <p style="margin: 6px 0 0; font-size: 13px; color: var(--color-berry, #b3402f)">{{ error() }}</p>
    }
  `,
})
export class TelegramOidcButtonComponent {
  /** Telegram Login client id — the bot's numeric id. */
  @Input({ required: true }) clientId!: string;

  @Input() label = 'Log in with Telegram';

  /** UI language of Telegram's popup, e.g. `ru` or `en`. */
  @Input() lang = 'en';

  /**
   * Ask the customer to let the bot message them — how order updates reach
   * Telegram. Off for staff linking, where the bot writes anyway.
   */
  @Input() requestWrite = true;

  /** Shown when the library will not load or Telegram returns an error. */
  @Input() unavailableLabel = 'Telegram sign-in is unavailable';

  @Output() readonly idToken = new EventEmitter<string>();

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  private readonly zone = inject(NgZone);

  async signIn(): Promise<void> {
    if (this.busy() || !this.clientId) return;
    this.busy.set(true);
    this.error.set(null);

    let api: TelegramLoginApi | undefined;
    try {
      await loadExternalScript(TELEGRAM_LOGIN_SRC);
      api = (window as unknown as { Telegram?: { Login?: TelegramLoginApi } }).Telegram?.Login;
    } catch {
      api = undefined;
    }
    if (!api) {
      this.busy.set(false);
      this.error.set(this.unavailableLabel);
      return;
    }

    api.auth(
      { client_id: this.clientId, request_access: this.requestWrite ? ['write'] : [], lang: this.lang },
      // Telegram calls back outside Angular's zone.
      (result) =>
        this.zone.run(() => {
          this.busy.set(false);
          if (result.id_token) {
            this.idToken.emit(result.id_token);
          } else if (result.error && result.error !== 'popup_closed') {
            // Closing the popup is a decision, not a failure.
            this.error.set(this.unavailableLabel);
          }
        }),
    );
  }
}
