import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import type { TelegramNotifyStatus } from '@takeaway/shared-types';
import {
  TELEGRAM_AUTH_CONFIG,
  TelegramLoginButtonComponent,
  TelegramOidcButtonComponent,
  type TelegramLoginWidgetUser,
} from '@takeaway/ui-kit';
import type { Observable } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';
import { extractMessage } from '../../core/http/extract-message';
import { type QrCode, qrCode } from '../../core/telegram/qr-code';
import { TelegramNotifyService } from '../../core/telegram/telegram-notify.service';

/** How often the page asks whether the bot has linked the chat yet. */
export const LINK_POLL_MS = 3000;

/** A link on the screen, waiting for its `/start`. */
interface PendingLink {
  url: string;
  expiresAt: string;
  qr: QrCode;
}

/**
 * «Telegram»: where the bot sends this account's work notifications — new
 * orders of the person's stores, alerts, and for the platform team feedback.
 *
 * The person makes a one-time link here and opens it on their own phone —
 * a QR code to scan, which is how it works from the kitchen tablet (a PIN
 * session reaches this page), or the link itself. Telegram starts the bot
 * with `/start link_<code>`, the bot links that chat and says so, and the
 * page, which asks every few seconds, shows it as linked. «Отвязать» stops
 * the messages. None of it touches anybody's Telegram sign-in, so the
 * person's own customer profile in the Mini App stays theirs.
 *
 * Where the server's bot cannot hear messages yet (no webhook), a password
 * session gets the older Telegram sign-in button instead, which links the
 * notification chat the same way.
 */
@Component({
  selector: 'app-telegram-link',
  standalone: true,
  imports: [TranslatePipe, TelegramLoginButtonComponent, TelegramOidcButtonComponent],
  template: `
    <section class="tg">
      <h1 class="tg-title">{{ 'admin.telegramLink.title' | translate }}</h1>
      <p class="tg-lead">{{ 'admin.telegramLink.subtitle' | translate }}</p>

      <div class="tg-card">
        @if (status(); as s) {
          @if (s.linked) {
            <p class="tg-linked" data-testid="tg-linked">{{ 'admin.telegramLink.linked' | translate }}</p>
            <p class="tg-note">{{ 'admin.telegramLink.linkedNote' | translate }}</p>
            <div class="tg-row">
              <button type="button" class="tg-outline" data-testid="tg-unlink" [disabled]="busy()" (click)="unlink()">
                {{ 'admin.telegramLink.unlink' | translate }}
              </button>
            </div>
          } @else {
            <p class="tg-note" data-testid="tg-not-linked">{{ 'admin.telegramLink.notLinked' | translate }}</p>
          }

          @if (s.botLinkAvailable) {
            @if (pending(); as p) {
              <div class="tg-pending" data-testid="tg-pending">
                <svg
                  class="tg-qr"
                  role="img"
                  [attr.aria-label]="'admin.telegramLink.qrLabel' | translate"
                  [attr.viewBox]="'-4 -4 ' + (p.qr.size + 8) + ' ' + (p.qr.size + 8)"
                  shape-rendering="crispEdges"
                >
                  <rect x="-4" y="-4" [attr.width]="p.qr.size + 8" [attr.height]="p.qr.size + 8" fill="#fff" />
                  <path [attr.d]="p.qr.path" fill="#000" />
                </svg>
                <div class="tg-steps">
                  <p class="tg-note">{{ 'admin.telegramLink.scan' | translate }}</p>
                  <a class="tg-primary" [href]="p.url" target="_blank" rel="noopener" data-testid="tg-open">
                    {{ 'admin.telegramLink.open' | translate }}
                  </a>
                  <code class="tg-url">{{ p.url }}</code>
                  <p class="tg-note">{{ 'admin.telegramLink.expires' | translate: { time: fmt.time(p.expiresAt) } }}</p>
                  <p class="tg-note tg-wait">{{ 'admin.telegramLink.waiting' | translate }}</p>
                </div>
              </div>
            } @else {
              @if (expired()) {
                <p class="tg-note" data-testid="tg-expired">{{ 'admin.telegramLink.expired' | translate }}</p>
              }
              <div class="tg-row">
                <button
                  type="button"
                  class="tg-primary"
                  data-testid="tg-make-link"
                  [disabled]="busy()"
                  (click)="makeLink()"
                >
                  {{ (s.linked ? 'admin.telegramLink.relink' : 'admin.telegramLink.makeLink') | translate }}
                </button>
              </div>
            }
          } @else if (!kitchenSession() && (clientId || botUsername)) {
            <p class="tg-note">{{ 'admin.telegramLink.legacyHint' | translate }}</p>
            @if (clientId) {
              <div style="max-width: 320px">
                <lib-telegram-oidc-button
                  [clientId]="clientId"
                  [requestWrite]="true"
                  [lang]="lang()"
                  [label]="'admin.telegramLink.button' | translate"
                  [unavailableLabel]="'admin.telegramLink.failed' | translate"
                  (idToken)="onTelegramIdToken($event)"
                />
              </div>
            } @else if (botUsername) {
              <div class="flex justify-start">
                <lib-telegram-login-button [botUsername]="botUsername" (auth)="onTelegramAuth($event)" />
              </div>
            }
          } @else {
            <p class="tg-note" data-testid="tg-unavailable">{{ 'admin.telegramLink.botUnavailable' | translate }}</p>
          }
        } @else if (!error()) {
          <p class="tg-note">{{ 'common.loading' | translate }}</p>
        }

        @if (error(); as message) {
          <p class="tg-error" role="alert">{{ message }}</p>
        }
      </div>
    </section>
  `,
  styles: [
    `
      .tg {
        padding: clamp(16px, 4vw, 32px);
        max-width: 680px;
        font-family: var(--font-sans);
      }
      .tg-title {
        margin: 0 0 8px;
        font-family: var(--font-display);
        font-size: 28px;
        color: var(--color-espresso);
      }
      .tg-lead {
        margin: 0 0 24px;
        font-size: 14px;
        color: var(--color-text-secondary);
      }
      .tg-card {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 24px;
        background: var(--color-foam);
        border-radius: var(--radius-card);
        box-shadow: var(--shadow-soft);
      }
      .tg-note,
      .tg-error,
      .tg-linked {
        margin: 0;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .tg-linked {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-mint);
      }
      .tg-error {
        color: var(--color-berry);
      }
      .tg-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .tg-pending {
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        align-items: flex-start;
      }
      .tg-qr {
        width: 220px;
        max-width: 100%;
        height: auto;
        border-radius: 12px;
        background: #fff;
      }
      .tg-steps {
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1 1 220px;
        min-width: 0;
      }
      .tg-url {
        font-size: 12px;
        overflow-wrap: anywhere;
        color: var(--color-text-tertiary);
      }
      .tg-wait {
        font-style: italic;
      }
      .tg-primary,
      .tg-outline {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 40px;
        padding: 0 18px;
        border-radius: var(--radius-button);
        font-size: 14px;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
        align-self: flex-start;
      }
      .tg-primary {
        background: var(--color-caramel);
        color: white;
        border: 0;
      }
      .tg-outline {
        background: transparent;
        color: var(--color-berry);
        border: 1px solid var(--color-berry);
      }
      button:disabled {
        opacity: 0.5;
      }
    `,
  ],
})
export class TelegramLinkPage {
  private readonly notify = inject(TelegramNotifyService);
  private readonly auth = inject(AuthService);
  private readonly store = inject(AuthStore);
  private readonly cfg = inject(TELEGRAM_AUTH_CONFIG);
  private readonly translate = inject(TranslateService);
  readonly fmt = inject(LocaleFormatService);

  readonly botUsername = this.cfg.botUsername;
  readonly clientId = this.cfg.clientId;

  readonly status = signal<TelegramNotifyStatus | null>(null);
  readonly pending = signal<PendingLink | null>(null);
  readonly expired = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly kitchenSession = computed(() => this.store.kitchenSession());

  private poll: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopPolling());
    this.refresh();
  }

  lang(): string {
    return this.translate.currentLang || this.translate.getDefaultLang() || 'ru';
  }

  /** A one-time link to the bot, shown as a QR code; the page then waits for the bot. */
  makeLink(): void {
    this.busy.set(true);
    this.error.set(null);
    this.expired.set(false);
    this.notify.issue().subscribe({
      next: ({ url, expiresAt }) => {
        this.busy.set(false);
        this.pending.set({ url, expiresAt, qr: qrCode(url) });
        this.startPolling();
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(this.messageOf(err));
      },
    });
  }

  unlink(): void {
    if (!window.confirm(this.translate.instant('admin.telegramLink.unlinkConfirm'))) return;
    this.busy.set(true);
    this.error.set(null);
    this.notify.unlink().subscribe({
      next: (status) => {
        this.busy.set(false);
        this.status.set(status);
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(this.messageOf(err));
      },
    });
  }

  onTelegramIdToken(idToken: string): void {
    this.legacyLink(this.auth.linkTelegramIdToken(idToken));
  }

  onTelegramAuth(payload: TelegramLoginWidgetUser): void {
    this.legacyLink(this.auth.linkTelegram(payload));
  }

  /** Asks the API whether the bot has linked the chat; stops at the link's expiry. */
  checkLinked(): void {
    const pending = this.pending();
    if (pending && Date.parse(pending.expiresAt) <= Date.now()) {
      this.stopPolling();
      this.pending.set(null);
      this.expired.set(true);
      return;
    }
    this.notify.status().subscribe({
      next: (status) => {
        if (!status.linked || !this.pending()) return;
        this.stopPolling();
        this.pending.set(null);
        this.status.set(status);
      },
      // A dropped request is asked again at the next tick.
      error: () => undefined,
    });
  }

  private refresh(): void {
    this.notify.status().subscribe({
      next: (status) => this.status.set(status),
      error: (err) => this.error.set(this.messageOf(err)),
    });
  }

  private legacyLink(request: Observable<unknown>): void {
    this.busy.set(true);
    this.error.set(null);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.refresh();
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(this.messageOf(err));
      },
    });
  }

  private startPolling(): void {
    this.stopPolling();
    this.poll = setInterval(() => this.checkLinked(), LINK_POLL_MS);
  }

  private stopPolling(): void {
    if (this.poll !== null) clearInterval(this.poll);
    this.poll = null;
  }

  private messageOf(err: unknown): string {
    const code = (err as { error?: { code?: unknown } } | null)?.error?.code;
    if (code === 'TELEGRAM_NOTIFY_LINK_UNAVAILABLE') return this.translate.instant('admin.telegramLink.botUnavailable');
    return extractMessage(err) ?? this.translate.instant('common.genericError');
  }
}
