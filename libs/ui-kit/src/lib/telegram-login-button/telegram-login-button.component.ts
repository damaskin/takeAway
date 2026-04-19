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

// Fields we forward unchanged from the Telegram Login Widget callback. The
// backend re-hashes these using the bot token; we don't touch them client-side.
export interface TelegramLoginWidgetUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

declare global {
  interface Window {
    [key: string]: unknown;
  }
}

let instanceCounter = 0;

/**
 * Telegram Login Widget — https://core.telegram.org/widgets/login
 *
 * Drops Telegram's `telegram-widget.js` script into a container and binds a
 * unique `data-onauth=<callbackName>(user)` to receive the signed payload.
 * The payload is then forwarded to the parent via `(auth)` — the parent is
 * responsible for POSTing it to `/auth/telegram/widget`.
 *
 * Two things easy to get wrong:
 *   1. Telegram's script runs OUTSIDE Angular's zone, so our `(auth)` emit
 *      has to hop back in via `NgZone.run`, or change detection won't pick
 *      up the resulting signal updates.
 *   2. We use a per-instance global callback name so two of these
 *      components on the same page don't fight for `window.onTelegramAuth`.
 */
@Component({
  selector: 'lib-telegram-login-button',
  standalone: true,
  template: ` <div #host style="display: inline-block; min-height: 40px"></div> `,
})
export class TelegramLoginButtonComponent implements AfterViewInit, OnDestroy {
  /** Bot's public `@username` (without the `@`). Required — Telegram domain binding is keyed on this. */
  @Input({ required: true }) botUsername!: string;

  /** Widget size: 'large' | 'medium' | 'small'. Defaults to 'large'. */
  @Input() size: 'large' | 'medium' | 'small' = 'large';

  /** Show the user's Telegram photo next to their name in the widget. */
  @Input() showUserPhoto = true;

  /** Corner radius in px. 0–20, Telegram default ~12. */
  @Input() cornerRadius?: number;

  @Output() readonly auth = new EventEmitter<TelegramLoginWidgetUser>();

  @ViewChild('host', { static: true }) private readonly host!: ElementRef<HTMLDivElement>;

  private readonly zone = inject(NgZone);
  private readonly callbackName = `onTelegramAuth_${++instanceCounter}`;
  private scriptElement: HTMLScriptElement | null = null;

  ngAfterViewInit(): void {
    if (typeof window === 'undefined' || !this.botUsername) return;

    window[this.callbackName] = (user: TelegramLoginWidgetUser) => {
      this.zone.run(() => this.auth.emit(user));
    };

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', this.botUsername);
    script.setAttribute('data-size', this.size);
    script.setAttribute('data-userpic', String(this.showUserPhoto));
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-onauth', `${this.callbackName}(user)`);
    if (this.cornerRadius != null) {
      script.setAttribute('data-radius', String(this.cornerRadius));
    }

    this.host.nativeElement.appendChild(script);
    this.scriptElement = script;
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      delete window[this.callbackName];
    }
    this.scriptElement?.remove();
    this.scriptElement = null;
  }
}
