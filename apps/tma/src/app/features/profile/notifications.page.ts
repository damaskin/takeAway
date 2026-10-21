import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { ProfileApi, type NotificationPrefs } from '../../core/profile/profile.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

/**
 * «Настройка уведомлений» in the Mini App — the website's
 * `/profile/notifications` (`GET/PATCH /auth/me/notifications`) without its
 * browser-push switch: in Telegram the bot's message is the channel, and
 * these two switches decide what it writes about. Each switch saves at once
 * and goes back if the API refuses. Telegram's back button returns to the
 * profile.
 */
@Component({
  selector: 'app-tma-notifications',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <section
      style="padding: 16px; padding-bottom: var(--tma-page-bottom); display: flex; flex-direction: column; gap: 16px"
    >
      <div class="flex flex-col" style="gap: 4px">
        <h1
          style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
        >
          {{ 'web.profile.notifications.title' | translate }}
        </h1>
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
          {{ 'tma.profile.notifications.subtitle' | translate }}
        </p>
      </div>

      @if (prefs(); as p) {
        <div
          class="flex flex-col"
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; overflow: hidden"
        >
          @for (key of keys; track key; let last = $last) {
            <label
              class="flex items-center"
              [style.borderBottom]="last ? 'none' : '1px solid var(--color-border-light)'"
              style="min-height: 64px; padding: 10px 16px; gap: 12px; cursor: pointer"
            >
              <span class="flex flex-col flex-1" style="gap: 2px">
                <span
                  style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
                  >{{ labels[key] | translate }}</span
                >
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
                  hints[key] | translate
                }}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                class="tnp-switch"
                [attr.data-key]="key"
                [checked]="p[key]"
                [disabled]="saving()"
                (change)="toggle(key, $event)"
              />
            </label>
          }
        </div>
        <p
          class="flex items-center"
          style="gap: 8px; margin: 0; font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
        >
          <span aria-hidden="true">💬</span>{{ 'tma.profile.notifications.fromBot' | translate }}
        </p>
      } @else if (!error()) {
        <p style="margin: 0; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)">
          {{ 'common.loading' | translate }}
        </p>
      }

      @if (error()) {
        <p role="alert" style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">
          {{ error() }}
        </p>
      }
    </section>
  `,
  styles: [
    `
      .tnp-switch {
        appearance: none;
        -webkit-appearance: none;
        flex: none;
        position: relative;
        width: 46px;
        height: 28px;
        margin: 0;
        border-radius: 9999px;
        background: var(--color-border-light);
        cursor: pointer;
        transition: background 0.15s;
      }
      .tnp-switch::after {
        content: '';
        position: absolute;
        top: 3px;
        left: 3px;
        width: 22px;
        height: 22px;
        border-radius: 9999px;
        background: white;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        transition: transform 0.15s;
      }
      .tnp-switch:checked {
        background: var(--color-caramel);
      }
      .tnp-switch:checked::after {
        transform: translateX(18px);
      }
      .tnp-switch:disabled {
        opacity: 0.6;
      }
    `,
  ],
})
export class TmaNotificationsPage implements OnInit, OnDestroy {
  private readonly api = inject(ProfileApi);
  private readonly authStore = inject(TmaAuthStore);
  private readonly tg = inject(TelegramBridgeService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly keys: ReadonlyArray<keyof NotificationPrefs> = ['notifyOrderUpdates', 'notifyPromotions'];
  readonly labels: Record<keyof NotificationPrefs, string> = {
    notifyOrderUpdates: 'web.profile.notifications.orderUpdates',
    notifyPromotions: 'web.profile.notifications.promotions',
  };
  readonly hints: Record<keyof NotificationPrefs, string> = {
    notifyOrderUpdates: 'web.profile.notifications.orderUpdatesHint',
    notifyPromotions: 'web.profile.notifications.promotionsHint',
  };

  readonly prefs = signal<NotificationPrefs | null>(null);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  private detachBack: (() => void) | null = null;

  ngOnInit(): void {
    this.detachBack = this.tg.setBackButton(() => void this.router.navigate(['/profile']));
    if (!this.authStore.isAuthenticated()) {
      this.error.set(this.translate.instant('tma.orders.offlineTitle'));
      return;
    }
    this.api.notifications().subscribe({
      next: (prefs) => this.prefs.set(prefs),
      error: (err: unknown) => this.error.set(this.describe(err)),
    });
  }

  ngOnDestroy(): void {
    this.detachBack?.();
  }

  toggle(key: keyof NotificationPrefs, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.checked;
    this.saving.set(true);
    this.error.set(null);
    this.tg.haptic('light');
    this.api.updateNotifications({ [key]: value }).subscribe({
      next: (prefs) => {
        this.prefs.set(prefs);
        this.saving.set(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(this.describe(err));
        // The switch shows what is saved, not what was tapped.
        input.checked = !value;
      },
    });
  }

  private describe(err: unknown): string {
    if ((err as { status?: unknown } | null)?.status === 0) return this.translate.instant('common.networkError');
    const raw = (err as { error?: { message?: unknown } } | null)?.error?.message;
    return typeof raw === 'string' && raw ? raw : this.translate.instant('common.genericError');
  }
}
