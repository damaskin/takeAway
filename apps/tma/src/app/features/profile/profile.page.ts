import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import type { LoyaltyAccount, LoyaltyTier } from '@takeaway/shared-types';

import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { ProfileApi } from '../../core/profile/profile.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';
import { TmaTabBarComponent } from '../../shared/tab-bar.component';

interface ProfileRow {
  icon: string;
  label: string;
  /** The screen it opens; the language row switches in place instead. */
  route: string | null;
}

/** The website's words for each level. */
const TIER_KEYS: Record<LoyaltyTier, string> = {
  SILVER: 'web.profile.tierSilver',
  GOLD: 'web.profile.tierGold',
  PLATINUM: 'web.profile.tierPlatinum',
  SIGNATURE: 'web.profile.tierSignature',
};

/**
 * TMA Profile — pencil RU8G9.
 *
 * Body (gap 20):
 *   avatarSec   — centered 88px avatar + name + phone
 *   loyaltyCard — caramel card with the level, the points and the way to the
 *                 next level, from `GET /loyalty/me`; hidden until it answers
 *   menuSec     — foam list: personal data / payment / gift cards /
 *                 notifications / language (RU · EN in place) / feedback
 *   signedIn    — «Вы вошли через Telegram» with the Telegram name
 *
 * No «Выйти»: in the Mini App the account is the Telegram account, signed in
 * again from Telegram's init data on every launch, so a sign-out could not
 * stick. Every row leads somewhere — none is a silent no-op.
 */
@Component({
  selector: 'app-tma-profile',
  standalone: true,
  imports: [TmaTabBarComponent, TranslatePipe, LanguageSwitcherComponent],
  template: `
    <section
      style="padding: 16px; padding-bottom: var(--tma-tab-page-bottom); display: flex; flex-direction: column; gap: 20px"
    >
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
          @if (phone(); as p) {
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
              p
            }}</span>
          }
        </div>
      </div>

      <!-- Loyalty card: the account's real numbers, or nothing at all -->
      @if (loyalty(); as l) {
        <div
          data-testid="loyalty-card"
          class="flex flex-col"
          style="background: var(--color-caramel); border-radius: 16px; padding: 16px; gap: 8px; color: white"
        >
          <div class="flex items-center justify-between">
            <span
              style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.8)"
              >{{ 'tma.profile.loyalty' | translate }}</span
            >
            <span
              data-testid="loyalty-tier"
              class="flex items-center"
              style="height: 22px; padding: 0 10px; background: rgba(255,255,255,0.15); border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700"
              >⭐ {{ tierKey(l.tier) | translate }}</span
            >
          </div>
          <span
            data-testid="loyalty-points"
            style="font-family: var(--font-display); font-size: 30px; font-weight: 700"
            >{{ 'tma.profile.pointsLine' | translate: { points: l.pointsBalance } }}</span
          >
          @if (l.nextTier) {
            <span style="font-family: var(--font-sans); font-size: 12px; color: rgba(255,255,255,0.7)">{{
              'web.profile.toNextTier'
                | translate: { points: l.pointsToNextTier, tier: (tierKey(l.nextTier) | translate) }
            }}</span>
            <div
              style="width: 100%; height: 6px; background: rgba(255,255,255,0.2); border-radius: 9999px; overflow: hidden; margin-top: 4px"
            >
              <div [style.width.%]="progress(l)" style="height: 100%; background: white; border-radius: 9999px"></div>
            </div>
          } @else {
            <span style="font-family: var(--font-sans); font-size: 12px; color: rgba(255,255,255,0.8)">{{
              'web.profile.loyalty.topTier' | translate
            }}</span>
          }
        </div>
      }

      <!-- Menu rows -->
      <div
        class="flex flex-col"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; overflow: hidden"
      >
        @for (row of rows(); track row.label; let last = $last) {
          @if (row.route) {
            <button
              type="button"
              (click)="open(row)"
              [attr.data-route]="row.route"
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
              <span style="color: var(--color-text-tertiary); font-size: 16px">›</span>
            </button>
          } @else {
            <!-- The language switches right here: two languages need no screen of their own. -->
            <div
              data-testid="language-row"
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
              <app-language-switcher />
            </div>
          }
        }
      </div>

      <!-- Who is signed in: the Telegram account itself, nothing to sign out of -->
      <div
        data-testid="signed-in"
        class="flex items-center"
        style="gap: 12px; padding: 14px 16px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px"
      >
        <span
          aria-hidden="true"
          class="flex items-center justify-center"
          style="flex: none; width: 36px; height: 36px; border-radius: 9999px; background: #2aabee"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" style="fill: white">
            <path
              d="M21.6 3.2 2.9 10.4c-1.3.5-1.3 1.2-.2 1.6l4.8 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.2-15c.3-1.3-.5-1.9-1.3-1.5Zm-3 3.6-8.9 8-.3 3.6-1.6-5 10.2-6.4c.5-.3.9-.1.6.2Z"
            />
          </svg>
        </span>
        <span class="flex flex-col" style="gap: 2px; min-width: 0">
          <span
            style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
            >{{ 'tma.profile.signedInVia' | translate }}</span
          >
          <span
            data-testid="telegram-name"
            class="truncate"
            style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
            >{{ telegramLine() }}</span
          >
          <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
            'tma.profile.signedInHint' | translate
          }}</span>
        </span>
      </div>
    </section>

    <app-tma-tab-bar />
  `,
})
export class TmaProfilePage implements OnInit {
  private readonly authStore = inject(TmaAuthStore);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly flags = inject(FeatureFlagsStore);
  private readonly profileApi = inject(ProfileApi);
  private readonly tg = inject(TelegramBridgeService);

  /** Null until `GET /loyalty/me` answers, and when it fails: the card is not shown then. */
  readonly loyalty = signal<LoyaltyAccount | null>(null);

  // Labels are translation keys — resolved with | translate in the template.
  private readonly allRows: ProfileRow[] = [
    { icon: '👤', label: 'web.profile.sections.personal', route: '/profile/personal' },
    { icon: '💳', label: 'web.profile.sections.payment', route: '/cards' },
    { icon: '🎁', label: 'web.profile.sections.gift', route: '/profile/gift-cards' },
    { icon: '🔔', label: 'web.profile.sections.notifications', route: '/profile/notifications' },
    { icon: '🌐', label: 'web.profile.sections.language', route: null },
    { icon: '💬', label: 'web.profile.sections.feedback', route: '/feedback' },
  ];

  /**
   * When checkout pays on the bank's own page there is no card to bind, so
   * the cards row would lead nowhere useful.
   */
  readonly rows = computed(() =>
    this.flags.webPaymentsEnabled() ? this.allRows.filter((r) => r.route !== '/cards') : this.allRows,
  );

  constructor() {
    // The bot writes in the language picked here, not only the screens.
    this.translate.onLangChange.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((event) => {
      const locale = event.lang === 'en' ? 'EN' : 'RU';
      const user = this.authStore.user();
      if (!user || user.locale === locale) return;
      this.profileApi.updateMe({ locale }).subscribe({ error: () => undefined });
    });
  }

  ngOnInit(): void {
    this.flags.load();
    if (this.authStore.isAuthenticated()) {
      this.profileApi.loyalty().subscribe({ next: (account) => this.loyalty.set(account), error: () => undefined });
    }
  }

  open(row: ProfileRow): void {
    if (!row.route) return;
    this.tg.haptic('light');
    void this.router.navigate([row.route]);
  }

  tierKey(tier: LoyaltyTier): string {
    return TIER_KEYS[tier] ?? TIER_KEYS.SILVER;
  }

  progress(account: LoyaltyAccount): number {
    return Math.min(100, Math.max(0, account.tierProgressPercent));
  }

  displayName(): string {
    return (
      this.authStore.user()?.name || this.tg.telegramUser?.name || this.translate.instant('tma.profile.fallbackName')
    );
  }

  phone(): string | null {
    return this.authStore.user()?.phone || null;
  }

  /** «Иван Петров · @ivan»: the Telegram account the Mini App runs under. */
  telegramLine(): string {
    const tgUser = this.tg.telegramUser;
    const name = tgUser?.name || this.displayName();
    return tgUser?.username ? `${name} · @${tgUser.username}` : name;
  }

  initials(): string {
    const name = this.authStore.user()?.name || this.tg.telegramUser?.name;
    if (!name) return 'TA';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }
}
