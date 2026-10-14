import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { filter, map } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { apiErrorCode } from '../../core/http/api-error';
import { OnboardingApi } from '../../core/onboarding/onboarding.service';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';

/**
 * A slim strip at the top of every admin page telling a brand owner where
 * their brand stands in moderation. Waiting: what to do meanwhile. Rejected:
 * the reviewer's reason, the support contact and the way back into the
 * queue. Approved: nothing — the brand is live and there is nothing to say.
 *
 * Owner-only: the copy speaks to the owner, and only the owner can resubmit.
 *
 * A brand from before sign-up asked for a phone has none, and the platform
 * team has nobody to call: a strip asks for one, everywhere but /settings,
 * which says so itself.
 */
@Component({
  selector: 'app-brand-status-banner',
  standalone: true,
  imports: [TranslatePipe, RouterLink, ConfirmDialogComponent],
  template: `
    @if (phoneMissing()) {
      <div class="status-banner" data-status="PHONE" role="status" data-testid="phone-missing-banner">
        <span class="flex-1" style="min-width: 0">{{ 'admin.onboarding.banner.phoneMissing' | translate }}</span>
        <a routerLink="/settings" class="status-link">{{ 'admin.onboarding.banner.phoneCta' | translate }} →</a>
      </div>
    }
    @if (brand(); as b) {
      @if (b.moderationStatus === 'PENDING') {
        <div class="status-banner" data-status="PENDING" role="status">
          <span class="status-dot" aria-hidden="true"></span>
          <span>{{ 'admin.onboarding.banner.pending' | translate }}</span>
        </div>
      } @else if (b.moderationStatus === 'REJECTED') {
        <div class="status-banner" data-status="REJECTED" role="alert">
          <div class="flex flex-col flex-1" style="gap: 2px; min-width: 0">
            <strong style="font-weight: 600">{{ 'admin.onboarding.banner.rejected' | translate }}</strong>
            <span>
              @if (b.moderationNote) {
                {{ 'admin.onboarding.banner.reason' | translate: { reason: b.moderationNote } }}
              } @else {
                {{ 'admin.onboarding.banner.noReason' | translate }}
              }
            </span>
            @if (support(); as s) {
              <span style="color: var(--color-text-secondary)">
                {{ 'admin.onboarding.banner.support' | translate }}
                @if (s.email) {
                  <a [href]="'mailto:' + s.email" class="status-link">{{ s.email }}</a>
                }
                @if (s.email && s.telegram) {
                  ·
                }
                @if (s.telegram) {
                  <a [href]="s.telegram" target="_blank" rel="noopener" class="status-link">Telegram</a>
                }
              </span>
            }
            @if (error()) {
              <span style="color: var(--color-berry)">{{ error() }}</span>
            }
          </div>
          <button
            type="button"
            class="status-action disabled:opacity-50"
            [disabled]="sending()"
            (click)="confirming.set(true)"
          >
            {{ (sending() ? 'admin.onboarding.banner.resubmitting' : 'admin.onboarding.banner.resubmit') | translate }}
          </button>
        </div>
      }
    }

    @if (confirming()) {
      <app-confirm-dialog
        [title]="'admin.onboarding.banner.resubmit' | translate"
        [body]="'admin.onboarding.banner.confirmResubmit' | translate"
        [confirmLabel]="'admin.onboarding.banner.resubmit' | translate"
        [cancelLabel]="'common.cancel' | translate"
        [busy]="sending()"
        (confirmed)="resubmit()"
        (cancelled)="confirming.set(false)"
      />
    }
  `,
  styles: [
    `
      .status-banner {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px 16px;
        padding: 10px clamp(12px, 3vw, 32px);
        font-family: var(--font-sans);
        font-size: 13px;
        line-height: 1.45;
        color: var(--color-text-primary);
        border-bottom: 1px solid var(--color-border-light);
      }
      .status-banner[data-status='PENDING'] {
        background: var(--color-cream);
        box-shadow: inset 3px 0 0 var(--color-amber);
      }
      .status-banner[data-status='REJECTED'] {
        background: var(--color-foam);
        box-shadow: inset 3px 0 0 var(--color-berry);
      }
      .status-banner[data-status='PHONE'] {
        background: var(--color-cream);
        box-shadow: inset 3px 0 0 var(--color-amber);
      }
      .status-dot {
        flex: 0 0 auto;
        width: 8px;
        height: 8px;
        border-radius: 9999px;
        background: var(--color-amber);
      }
      .status-link {
        color: var(--color-caramel);
        font-weight: 600;
      }
      .status-action {
        flex: 0 0 auto;
        height: 34px;
        padding: 0 14px;
        border: 0;
        border-radius: var(--radius-button);
        background: var(--color-caramel);
        color: white;
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
    `,
  ],
})
export class BrandStatusBannerComponent {
  private readonly auth = inject(AuthStore);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly flags = inject(FeatureFlagsStore);
  private readonly onboarding = inject(OnboardingApi);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  readonly support = this.flags.support;
  readonly confirming = signal(false);
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);

  /** The owner's brand in view, when it is not live yet. */
  readonly brand = computed(() => {
    if (this.auth.user()?.role !== 'BRAND_ADMIN') return null;
    const brand = this.activeBrand.active();
    const status = brand?.moderationStatus;
    return brand && (status === 'PENDING' || status === 'REJECTED') ? brand : null;
  });

  /** The owner's brand in view has no contact phone (null; an older API that does not say is left alone). */
  readonly phoneMissing = computed(() => {
    if (this.auth.user()?.role !== 'BRAND_ADMIN') return false;
    if (this.url().startsWith('/settings')) return false;
    return this.activeBrand.active()?.contactPhone === null;
  });

  resubmit(): void {
    const brand = this.brand();
    if (!brand || this.sending()) return;
    this.sending.set(true);
    this.error.set(null);
    this.onboarding.resubmit(brand.id).subscribe({
      next: () => this.done(),
      error: (err) => {
        // Already back in the queue (another tab, a double click): the
        // brand list is simply out of date.
        if (apiErrorCode(err) === 'NOT_REJECTED') {
          this.done();
          return;
        }
        this.sending.set(false);
        this.confirming.set(false);
        this.error.set(this.translate.instant('common.genericError'));
      },
    });
  }

  private done(): void {
    this.sending.set(false);
    this.confirming.set(false);
    // The brand list carries the status; reloading it turns this banner
    // into the "under review" one and refreshes the dashboard checklist.
    this.activeBrand.refresh();
  }
}
