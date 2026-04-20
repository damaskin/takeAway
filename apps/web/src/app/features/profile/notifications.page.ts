import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { API_CONFIG } from '../../core/api/api.config';

interface NotificationPrefs {
  notifyOrderUpdates: boolean;
  notifyPromotions: boolean;
}

/**
 * Customer-facing push toggles. Two flags for v1:
 *   - order updates (all order-status pushes)
 *   - promotions (reserved — nothing fires through this channel yet,
 *     but the flag is stored so we can opt users out preemptively).
 */
@Component({
  selector: 'app-profile-notifications',
  standalone: true,
  imports: [TranslatePipe, RouterLink],
  template: `
    <section style="min-height: calc(100vh - 72px); background: var(--color-cream); padding: 32px 16px">
      <div style="max-width: 540px; margin: 0 auto">
        <a
          routerLink="/profile"
          style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); text-decoration: none"
          >← {{ 'common.back' | translate }}</a
        >
        <h1 style="font-family: var(--font-display); font-size: 28px; color: var(--color-espresso); margin: 12px 0 8px">
          {{ 'web.profile.notifications.title' | translate }}
        </h1>
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0 0 24px">
          {{ 'web.profile.notifications.subtitle' | translate }}
        </p>

        @if (prefs(); as p) {
          <div
            class="flex flex-col"
            style="gap: 4px; background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft); padding: 8px"
          >
            <label
              class="flex items-center"
              style="height: 56px; padding: 0 16px; gap: 12px; cursor: pointer; border-radius: 12px"
            >
              <span class="flex-1 flex flex-col" style="gap: 2px">
                <span
                  style="font-family: var(--font-sans); font-size: 15px; font-weight: 500; color: var(--color-text-primary)"
                  >{{ 'web.profile.notifications.orderUpdates' | translate }}</span
                >
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
                  'web.profile.notifications.orderUpdatesHint' | translate
                }}</span>
              </span>
              <input
                type="checkbox"
                [checked]="p.notifyOrderUpdates"
                (change)="toggle('notifyOrderUpdates', $event)"
                [disabled]="saving()"
                style="width: 22px; height: 22px; cursor: pointer"
              />
            </label>

            <label
              class="flex items-center"
              style="height: 56px; padding: 0 16px; gap: 12px; cursor: pointer; border-radius: 12px"
            >
              <span class="flex-1 flex flex-col" style="gap: 2px">
                <span
                  style="font-family: var(--font-sans); font-size: 15px; font-weight: 500; color: var(--color-text-primary)"
                  >{{ 'web.profile.notifications.promotions' | translate }}</span
                >
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
                  'web.profile.notifications.promotionsHint' | translate
                }}</span>
              </span>
              <input
                type="checkbox"
                [checked]="p.notifyPromotions"
                (change)="toggle('notifyPromotions', $event)"
                [disabled]="saving()"
                style="width: 22px; height: 22px; cursor: pointer"
              />
            </label>
          </div>
        } @else if (error()) {
          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">{{ error() }}</p>
        } @else {
          <p style="font-family: var(--font-sans); color: var(--color-text-secondary)">
            {{ 'common.loading' | translate }}
          </p>
        }
      </div>
    </section>
  `,
})
export class ProfileNotificationsPage {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly translate = inject(TranslateService);

  readonly prefs = signal<NotificationPrefs | null>(null);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    this.http.get<NotificationPrefs>(`${this.api.baseUrl}/auth/me/notifications`).subscribe({
      next: (p) => this.prefs.set(p),
      error: (err) => this.error.set(this.extractMessage(err)),
    });
  }

  toggle(key: keyof NotificationPrefs, event: Event): void {
    const input = event.target as HTMLInputElement;
    const patch = { [key]: input.checked };
    this.saving.set(true);
    this.http.patch<NotificationPrefs>(`${this.api.baseUrl}/auth/me/notifications`, patch).subscribe({
      next: (p) => {
        this.prefs.set(p);
        this.saving.set(false);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(this.extractMessage(err));
        // Revert the checkbox UI if the server rejected.
        input.checked = !input.checked;
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
