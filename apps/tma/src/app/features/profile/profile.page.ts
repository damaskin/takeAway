import { Component, inject } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { TmaTabBarComponent } from '../../shared/tab-bar.component';

interface ProfileRow {
  icon: string;
  label: string;
  value?: string;
}

/**
 * TMA Profile — pencil RU8G9.
 *
 * Body (gap 20):
 *   avatarSec   — centered 88px avatar + name + phone
 *   loyaltyCard — caramel card with tier + points + "550 pts to Platinum"
 *   menuSec     — foam list with 5 rows (personal / payment / gift / alerts / language)
 *   logoutBtn   — berry-outlined pill
 */
@Component({
  selector: 'app-tma-profile',
  standalone: true,
  imports: [TmaTabBarComponent, TranslatePipe],
  template: `
    <section style="padding: 16px; padding-bottom: 88px; display: flex; flex-direction: column; gap: 20px">
      <!-- Avatar block -->
      <div class="flex flex-col items-center" style="padding: 8px 0; gap: 12px">
        <div
          class="flex items-center justify-center"
          style="width: 88px; height: 88px; border-radius: 9999px; background: var(--color-caramel); color: white; font-family: var(--font-display); font-size: 34px; font-weight: 700"
        >
          {{ initials() }}
        </div>
        <div class="flex flex-col items-center" style="gap: 4px">
          <span
            style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso)"
            >{{ displayName() }}</span
          >
          <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
            phone()
          }}</span>
        </div>
      </div>

      <!-- Loyalty card -->
      <div
        class="flex flex-col"
        style="background: var(--color-caramel); border-radius: 16px; padding: 16px; gap: 8px; color: white"
      >
        <div class="flex items-center justify-between">
          <span
            style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.8)"
            >{{ 'tma.profile.loyalty' | translate }}</span
          >
          <span
            class="flex items-center"
            style="height: 22px; padding: 0 10px; background: rgba(255,255,255,0.15); border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700"
            >⭐ {{ 'tma.profile.tierGold' | translate }}</span
          >
        </div>
        <span style="font-family: var(--font-display); font-size: 30px; font-weight: 700">{{
          'tma.profile.pointsLine' | translate: { points: '2,450' }
        }}</span>
        <span style="font-family: var(--font-sans); font-size: 12px; color: rgba(255,255,255,0.7)">{{
          'tma.profile.toPlatinum' | translate: { points: 550 }
        }}</span>
        <div
          style="width: 100%; height: 6px; background: rgba(255,255,255,0.2); border-radius: 9999px; overflow: hidden; margin-top: 4px"
        >
          <div style="width: 82%; height: 100%; background: white; border-radius: 9999px"></div>
        </div>
      </div>

      <!-- Menu rows -->
      <div
        class="flex flex-col"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; overflow: hidden"
      >
        @for (row of rows; track row.label; let last = $last) {
          <button
            type="button"
            class="flex items-center"
            [style.borderBottom]="last ? 'none' : '1px solid var(--color-border-light)'"
            style="height: 52px; padding: 0 16px; gap: 14px"
          >
            <span style="color: var(--color-text-secondary); font-size: 18px">{{ row.icon }}</span>
            <span
              class="flex-1 text-left"
              style="font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--color-text-primary)"
              >{{ row.label | translate }}</span
            >
            @if (row.value) {
              <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)">{{
                row.value | translate
              }}</span>
            }
            <span style="color: var(--color-text-tertiary); font-size: 16px">›</span>
          </button>
        }
      </div>

      <!-- Logout -->
      <button
        type="button"
        (click)="logout()"
        class="flex items-center justify-center"
        style="height: 48px; background: var(--color-foam); color: var(--color-berry); border: 1px solid var(--color-berry); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600"
      >
        {{ 'tma.profile.signOut' | translate }}
      </button>
    </section>

    <app-tma-tab-bar />
  `,
})
export class TmaProfilePage {
  private readonly authStore = inject(TmaAuthStore);
  private readonly translate = inject(TranslateService);

  // Labels and value are translation keys — resolved with | translate in the template.
  readonly rows: ProfileRow[] = [
    { icon: '👤', label: 'web.profile.sections.personal' },
    { icon: '💳', label: 'web.profile.sections.payment' },
    { icon: '🎁', label: 'web.profile.sections.gift' },
    { icon: '🔔', label: 'web.profile.sections.notifications' },
    { icon: '🌐', label: 'web.profile.sections.language', value: 'web.profile.languageValue' },
  ];

  displayName(): string {
    return this.authStore.user()?.name || this.translate.instant('tma.profile.fallbackName');
  }

  phone(): string {
    return this.authStore.user()?.phone || '—';
  }

  initials(): string {
    const name = this.authStore.user()?.name;
    if (!name) return 'TA';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }

  logout(): void {
    this.authStore.clear();
  }
}
