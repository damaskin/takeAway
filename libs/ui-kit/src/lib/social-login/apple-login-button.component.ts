import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

import { loadExternalScript, type SocialAuthResult } from './social-auth.config';

const APPLE_SDK_SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

interface AppleSignInResponse {
  authorization?: { id_token?: string; code?: string; state?: string };
  /** Present on the FIRST consent only — Apple never repeats it. */
  user?: { name?: { firstName?: string; lastName?: string }; email?: string };
}

interface AppleIdApi {
  auth: {
    init(options: { clientId: string; scope: string; redirectURI: string; state?: string; usePopup: boolean }): void;
    signIn(): Promise<AppleSignInResponse>;
  };
}

declare global {
  interface Window {
    AppleID?: AppleIdApi;
  }
}

/**
 * "Continue with Apple" — Sign in with Apple JS
 * (https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_js).
 *
 * Apple ships no pre-built button for the JS SDK, so this is our own markup
 * following Apple's Human Interface Guidelines: black fill, white wordmark,
 * the logo at cap height, and the required "Continue with Apple" phrasing.
 *
 * The one thing worth knowing: Apple returns the user's **name exactly
 * once**, in the `user` field of the very first authorization, and never
 * again — not in later sign-ins, not in the ID token. If we drop it there,
 * the account has no name forever. So it rides along in the emitted result
 * and the API persists it on first sight.
 */
@Component({
  selector: 'lib-apple-login-button',
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
        background: #000;
        color: #fff;
        font-family: var(--font-sans, system-ui), sans-serif;
        font-size: 15px;
        font-weight: 500;
        cursor: pointer;
      "
      [style.opacity]="busy() ? '0.6' : '1'"
      [style.cursor]="busy() ? 'progress' : 'pointer'"
    >
      <svg width="16" height="19" viewBox="0 0 16 19" fill="currentColor" aria-hidden="true">
        <path
          d="M13.24 10.02c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.62-1.7-3.19-1.72-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.87-.76-1.48.02-2.84.86-3.6 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.25 2.74 2.2 1.1-.04 1.52-.71 2.85-.71s1.7.71 2.87.69c1.18-.02 1.93-1.08 2.65-2.14.84-1.23 1.18-2.42 1.2-2.48-.03-.01-2.3-.88-2.32-3.5zM11.05 3.5c.6-.74 1.02-1.75.9-2.77-.87.04-1.94.59-2.57 1.32-.56.65-1.06 1.7-.93 2.7.98.07 1.98-.5 2.6-1.25z"
        />
      </svg>
      <span>{{ label }}</span>
    </button>
    @if (error()) {
      <p style="margin: 6px 0 0; font-size: 13px; color: var(--color-berry, #b3402f)">{{ error() }}</p>
    }
  `,
})
export class AppleLoginButtonComponent {
  /** Apple Services ID. The page should hide the component when blank. */
  @Input({ required: true }) clientId!: string;

  /**
   * Return URL registered against the Services ID. Defaults to the current
   * origin, which is what a single-domain deployment wants.
   */
  @Input() redirectUri = '';

  @Input() label = 'Continue with Apple';

  /** Shown when the SDK will not load or Apple returns an error. */
  @Input() unavailableLabel = 'Apple sign-in is unavailable';

  @Output() readonly auth = new EventEmitter<SocialAuthResult>();

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  private initialised = false;

  async signIn(): Promise<void> {
    if (this.busy() || !this.clientId) return;
    this.busy.set(true);
    this.error.set(null);

    try {
      const api = await this.ensureInitialised();
      const response = await api.auth.signIn();
      const idToken = response.authorization?.id_token;
      if (!idToken) {
        throw new Error('no-id-token');
      }
      this.auth.emit({ idToken, name: fullName(response) });
    } catch (err) {
      // Apple raises `popup_closed_by_user` when the sheet is dismissed —
      // that is a decision, not a failure, so it gets no error message.
      if (!isUserCancellation(err)) {
        this.error.set(this.unavailableLabel);
      }
    } finally {
      this.busy.set(false);
    }
  }

  private async ensureInitialised(): Promise<AppleIdApi> {
    await loadExternalScript(APPLE_SDK_SRC);
    const api = window.AppleID;
    if (!api) throw new Error('apple-sdk-missing');
    if (this.initialised) return api;

    api.auth.init({
      clientId: this.clientId,
      scope: 'name email',
      redirectURI: this.redirectUri || window.location.origin,
      usePopup: true,
    });
    this.initialised = true;
    return api;
  }
}

function fullName(response: AppleSignInResponse): string | undefined {
  const name = response.user?.name;
  if (!name) return undefined;
  const joined = [name.firstName, name.lastName].filter(Boolean).join(' ').trim();
  return joined.length > 0 ? joined : undefined;
}

function isUserCancellation(err: unknown): boolean {
  const code = (err as { error?: unknown } | null)?.error;
  return code === 'popup_closed_by_user' || code === 'user_cancelled_authorize';
}
