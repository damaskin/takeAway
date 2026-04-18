import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { LoyaltyAccount } from '@takeaway/shared-types';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';
import { LoyaltyService } from '../../core/loyalty/loyalty.service';

interface ProfileSection {
  icon: string;
  label: string;
  value?: string;
  /** When set, the row is rendered as a routerLink to this URL. */
  link?: string;
}

/**
 * Web Profile — pencil A8 (E9UIT).
 *
 * Body (padding 40/0, gap 32, centered, 800px width):
 *   pfHeroCard — 24px-radius caramel→dark-caramel gradient, 32px padding
 *     72px circle avatar, name (Fraunces 22/700 white), phone (white 60%),
 *     tier badge + points text, right chevron
 *   pfTierProgress — tier row ("Gold" caramel / "550 to Platinum" tertiary) + 6px rail
 *   pfSections — 56px foam cards (icon left · label · optional value · chevron):
 *     Personal info · Payment methods · Gift cards · Notifications · Language
 *   pfLogout — 56px transparent row (berry icon + berry label)
 */
@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    @if (store.user(); as user) {
      <section
        style="max-width: 800px; margin: 0 auto; padding: 40px 24px; display: flex; flex-direction: column; gap: 32px"
      >
        <!-- Hero card -->
        <div
          class="flex items-center"
          style="background: linear-gradient(135deg, var(--color-caramel) 0%, #a0612a 100%); border-radius: 24px; padding: 32px; gap: 24px; color: white"
        >
          <div
            class="flex items-center justify-center flex-shrink-0"
            style="width: 72px; height: 72px; border-radius: 9999px; background: rgba(255,255,255,0.19); font-family: var(--font-display); font-size: 28px; font-weight: 700"
          >
            {{ initials(user.name) }}
          </div>
          <div class="flex flex-col flex-1" style="gap: 6px">
            <span style="font-family: var(--font-sans); font-size: 22px; font-weight: 700; color: white">{{
              user.name || 'Guest'
            }}</span>
            <span style="font-family: var(--font-sans); font-size: 14px; color: rgba(255,255,255,0.6)">{{
              user.phone
            }}</span>
            <div class="flex items-center" style="gap: 12px; margin-top: 2px">
              <span
                class="flex items-center"
                style="height: 26px; padding: 0 10px; background: rgba(255,255,255,0.13); border-radius: 9999px; gap: 6px; font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: white"
              >
                ⭐ {{ tier() | translate }}
              </span>
              <span
                style="font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.6)"
                >{{ points() }} {{ 'web.profile.pointsSuffix' | translate }}</span
              >
            </div>
          </div>
          <span style="color: rgba(255,255,255,0.4); font-size: 24px">›</span>
        </div>

        <!-- Tier progress -->
        <div class="flex flex-col" style="gap: 8px">
          <div class="flex items-center justify-between">
            <span
              style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-caramel)"
              >{{ tier() | translate }}</span
            >
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)">{{
              'web.profile.toNextTier' | translate: { points: pointsToNextTier(), tier: nextTier() }
            }}</span>
          </div>
          <div
            style="position: relative; width: 100%; height: 6px; background: var(--color-surface-variant); border-radius: 9999px; overflow: hidden"
          >
            <div
              [style.width.%]="tierProgressPercent()"
              style="height: 100%; background: var(--color-caramel); border-radius: 9999px; transition: width 300ms ease"
            ></div>
          </div>
        </div>

        <!-- Section list -->
        <div class="flex flex-col" style="gap: 4px">
          @for (sec of sections; track sec.label) {
            @if (sec.link) {
              <a
                [routerLink]="sec.link"
                class="flex items-center"
                style="height: 56px; padding: 0 20px; background: var(--color-foam); border-radius: 14px; gap: 16px; text-decoration: none"
              >
                <span style="color: var(--color-text-secondary); font-size: 18px">{{ sec.icon }}</span>
                <span
                  class="flex-1 text-left"
                  style="font-family: var(--font-sans); font-size: 15px; font-weight: 500; color: var(--color-text-primary)"
                  >{{ sec.label | translate }}</span
                >
                @if (sec.value) {
                  <span style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-tertiary)">{{
                    sec.value | translate
                  }}</span>
                }
                <span style="color: var(--color-text-tertiary); font-size: 16px">›</span>
              </a>
            } @else {
              <button
                type="button"
                class="flex items-center"
                style="height: 56px; padding: 0 20px; background: var(--color-foam); border-radius: 14px; gap: 16px"
              >
                <span style="color: var(--color-text-secondary); font-size: 18px">{{ sec.icon }}</span>
                <span
                  class="flex-1 text-left"
                  style="font-family: var(--font-sans); font-size: 15px; font-weight: 500; color: var(--color-text-primary)"
                  >{{ sec.label | translate }}</span
                >
                @if (sec.value) {
                  <span style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-tertiary)">{{
                    sec.value | translate
                  }}</span>
                }
                <span style="color: var(--color-text-tertiary); font-size: 16px">›</span>
              </button>
            }
          }

          <!-- Logout -->
          <button
            type="button"
            (click)="logout()"
            class="flex items-center"
            style="height: 56px; padding: 0 20px; background: transparent; border-radius: 14px; gap: 16px; margin-top: 8px"
          >
            <span style="color: var(--color-berry); font-size: 18px">⎋</span>
            <span style="font-family: var(--font-sans); font-size: 15px; font-weight: 500; color: var(--color-berry)">{{
              'common.signOut' | translate
            }}</span>
          </button>
        </div>

        <p
          class="text-center"
          style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); margin: 0"
        >
          Role {{ user.role }} · {{ user.currency }}
        </p>
      </section>
    }
  `,
})
export class ProfilePage implements OnInit {
  readonly store = inject(AuthStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly loyaltyApi = inject(LoyaltyService);
  private readonly translate = inject(TranslateService);

  readonly loyalty = signal<LoyaltyAccount | null>(null);

  ngOnInit(): void {
    this.loyaltyApi.me().subscribe({ next: (acc) => this.loyalty.set(acc) });
  }

  readonly sections: ProfileSection[] = [
    { icon: '🧾', label: 'web.profile.sections.myOrders', link: '/orders' },
    { icon: '👤', label: 'web.profile.sections.personal' },
    { icon: '💳', label: 'web.profile.sections.payment' },
    { icon: '🎁', label: 'web.profile.sections.gift' },
    { icon: '🔔', label: 'web.profile.sections.notifications' },
    { icon: '🌐', label: 'web.profile.sections.language', value: 'web.profile.languageValue' },
  ];

  initials(name?: string | null): string {
    if (!name) return 'TA';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }

  points(): number {
    return this.loyalty()?.pointsBalance ?? 0;
  }

  /** Translation KEY for the current tier — resolved in the template via | translate. */
  tier(): string {
    return this.tierKey(this.loyalty()?.tier ?? 'SILVER');
  }

  /** Already-translated label for interpolation inside `toNextTier` binding. */
  nextTier(): string {
    const next = this.loyalty()?.nextTier;
    return this.translate.instant(next ? this.tierKey(next) : 'web.profile.tierSignature');
  }

  pointsToNextTier(): number {
    return this.loyalty()?.pointsToNextTier ?? 0;
  }

  tierProgressPercent(): number {
    return this.loyalty()?.tierProgressPercent ?? 0;
  }

  private tierKey(t: string): string {
    switch (t) {
      case 'GOLD':
        return 'web.profile.tierGold';
      case 'PLATINUM':
        return 'web.profile.tierPlatinum';
      case 'SIGNATURE':
        return 'web.profile.tierSignature';
      default:
        return 'web.profile.tierSilver';
    }
  }

  logout(): void {
    this.auth.logout().subscribe({
      complete: () => void this.router.navigate(['/']),
    });
  }
}
