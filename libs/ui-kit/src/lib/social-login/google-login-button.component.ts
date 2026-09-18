import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnDestroy,
  Output,
  ViewChild,
  inject,
} from '@angular/core';

import { loadExternalScript, type SocialAuthResult } from './social-auth.config';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        use_fedcm_for_prompt?: boolean;
      }): void;
      renderButton(
        parent: HTMLElement,
        options: {
          type?: 'standard' | 'icon';
          theme?: 'outline' | 'filled_blue' | 'filled_black';
          size?: 'large' | 'medium' | 'small';
          text?: 'signin_with' | 'signup_with' | 'continue_with';
          shape?: 'rectangular' | 'pill';
          logo_alignment?: 'left' | 'center';
          width?: number;
          locale?: string;
        },
      ): void;
      disableAutoSelect(): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityApi;
  }
}

/**
 * "Continue with Google" — Google Identity Services
 * (https://developers.google.com/identity/gsi/web).
 *
 * GIS renders its own button inside an iframe so the branding stays
 * Google's; we only size it. The callback hands back a `credential`, which
 * is the OpenID Connect ID token — forwarded up via `(auth)` for the page
 * to POST to `/auth/google`.
 *
 * Two Angular-specific gotchas, same as the Telegram widget next door:
 * the SDK fires outside the zone, so the emit hops back in through
 * `NgZone.run`; and the button must be rendered after the script resolves,
 * not on `ngAfterViewInit` alone.
 */
@Component({
  selector: 'lib-google-login-button',
  standalone: true,
  template: `
    <div #host style="display: flex; justify-content: center; min-height: 44px; width: 100%"></div>
    @if (failed()) {
      <p style="margin: 0; font-size: 13px; color: var(--color-berry, #b3402f)">{{ unavailableLabel }}</p>
    }
  `,
})
export class GoogleLoginButtonComponent implements AfterViewInit, OnDestroy {
  /** Google web client id. The component renders nothing when blank. */
  @Input({ required: true }) clientId!: string;

  /** Width in px passed to GIS. Google clamps this to 200–400. */
  @Input() width = 320;

  /** BCP-47 tag so the button text matches the app language. */
  @Input() locale = 'en';

  /** Shown if the SDK cannot be reached (offline, blocked, ad-blocker). */
  @Input() unavailableLabel = 'Google sign-in is unavailable';

  @Output() readonly auth = new EventEmitter<SocialAuthResult>();

  @ViewChild('host', { static: true }) private readonly host!: ElementRef<HTMLDivElement>;

  private readonly zone = inject(NgZone);
  private destroyed = false;
  private failedState = false;

  failed(): boolean {
    return this.failedState;
  }

  async ngAfterViewInit(): Promise<void> {
    if (typeof window === 'undefined' || !this.clientId) return;

    try {
      await loadExternalScript(GIS_SRC);
    } catch {
      this.zone.run(() => {
        this.failedState = true;
      });
      return;
    }
    if (this.destroyed) return;

    const api = window.google;
    if (!api) {
      this.zone.run(() => {
        this.failedState = true;
      });
      return;
    }

    api.accounts.id.initialize({
      client_id: this.clientId,
      // Never sign someone in without a tap — auto-select would resurrect a
      // session the user explicitly logged out of.
      auto_select: false,
      cancel_on_tap_outside: true,
      callback: (response) => {
        const credential = response.credential;
        if (!credential) return;
        this.zone.run(() => this.auth.emit({ idToken: credential }));
      },
    });

    api.accounts.id.renderButton(this.host.nativeElement, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      logo_alignment: 'left',
      width: this.width,
      locale: this.locale,
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    // Clears the "one tap" auto-select hint so a later logout sticks.
    window.google?.accounts.id.disableAutoSelect();
  }
}
