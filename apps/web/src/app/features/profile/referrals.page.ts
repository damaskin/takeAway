import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { API_CONFIG } from '../../core/api/api.config';

interface ReferralSummary {
  code: string;
  signupsCount: number;
  rewardedCount: number;
  pointsEarned: number;
  appliedCode: string | null;
}

/**
 * Customer referrals page. Shows the user's own code (with a copy
 * button), counters for signups and rewarded conversions, and a one-time
 * "apply a friend's code" form for users who haven't placed a paid order
 * yet.
 */
@Component({
  selector: 'app-profile-referrals',
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, TranslatePipe],
  template: `
    <section style="min-height: calc(100vh - 72px); background: var(--color-cream); padding: 32px 16px">
      <div style="max-width: 540px; margin: 0 auto">
        <a
          routerLink="/profile"
          style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); text-decoration: none"
          >← {{ 'common.back' | translate }}</a
        >
        <h1 style="font-family: var(--font-display); font-size: 28px; color: var(--color-espresso); margin: 12px 0 8px">
          {{ 'web.profile.referrals.title' | translate }}
        </h1>
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0 0 24px">
          {{ 'web.profile.referrals.subtitle' | translate }}
        </p>

        @if (summary(); as s) {
          <!-- Code card -->
          <div
            style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft); padding: 18px; display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px"
          >
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
              'web.profile.referrals.yourCode' | translate
            }}</span>
            <div class="flex items-center" style="gap: 10px">
              <code
                style="flex: 1; font-family: var(--font-mono); font-size: 22px; font-weight: 700; color: var(--color-caramel); letter-spacing: 0.08em"
                >{{ s.code }}</code
              >
              <button
                type="button"
                (click)="copy()"
                style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: 10px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
              >
                {{ (copied() ? 'web.profile.referrals.copied' : 'web.profile.referrals.copy') | translate }}
              </button>
            </div>
          </div>

          <!-- Counters -->
          <div class="flex" style="gap: 12px; margin-bottom: 24px">
            <div
              style="flex: 1; background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft); padding: 16px; display: flex; flex-direction: column; gap: 4px"
            >
              <span
                style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso)"
                >{{ s.rewardedCount }}</span
              >
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                'web.profile.referrals.rewardedCount' | translate
              }}</span>
            </div>
            <div
              style="flex: 1; background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft); padding: 16px; display: flex; flex-direction: column; gap: 4px"
            >
              <span
                style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-mint)"
                >+{{ s.pointsEarned }}</span
              >
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                'web.profile.referrals.pointsEarned' | translate
              }}</span>
            </div>
          </div>

          <!-- Apply someone else's code -->
          @if (s.appliedCode) {
            <div
              style="background: rgba(76, 175, 80, 0.1); border-radius: 12px; padding: 14px; font-family: var(--font-sans); font-size: 13px; color: var(--color-mint)"
            >
              {{ 'web.profile.referrals.youApplied' | translate: { code: s.appliedCode } }}
            </div>
          } @else {
            <form
              [formGroup]="applyForm"
              (ngSubmit)="apply()"
              style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft); padding: 18px; display: flex; flex-direction: column; gap: 10px"
            >
              <span
                style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-primary)"
                >{{ 'web.profile.referrals.applyTitle' | translate }}</span
              >
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                'web.profile.referrals.applyHint' | translate
              }}</span>
              <div class="flex items-center" style="gap: 8px">
                <input
                  type="text"
                  formControlName="code"
                  placeholder="ABCD1234"
                  style="flex: 1; height: 40px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 10px; text-transform: uppercase; font-family: var(--font-mono)"
                />
                <button
                  type="submit"
                  [disabled]="applyForm.invalid || applying()"
                  style="height: 40px; padding: 0 16px; background: var(--color-caramel); color: white; border-radius: 10px; font-family: var(--font-sans); font-weight: 600"
                >
                  {{ (applying() ? 'common.loading' : 'common.apply') | translate }}
                </button>
              </div>
              @if (applyError()) {
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-berry)">{{
                  applyError()
                }}</span>
              }
            </form>
          }
        } @else if (loadError()) {
          <p style="font-family: var(--font-sans); color: var(--color-berry)">{{ loadError() }}</p>
        } @else {
          <p style="font-family: var(--font-sans); color: var(--color-text-secondary)">
            {{ 'common.loading' | translate }}
          </p>
        }
      </div>
    </section>
  `,
})
export class ProfileReferralsPage {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly translate = inject(TranslateService);

  readonly summary = signal<ReferralSummary | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly copied = signal(false);
  readonly applying = signal(false);
  readonly applyError = signal<string | null>(null);

  readonly shareUrl = computed(() => {
    const s = this.summary();
    if (!s) return '';
    if (typeof window === 'undefined') return s.code;
    return `${window.location.origin}/?ref=${s.code}`;
  });

  readonly applyForm = new FormGroup({
    code: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(4)],
    }),
  });

  constructor() {
    this.refresh();
  }

  copy(): void {
    const s = this.summary();
    if (!s) return;
    const text = this.shareUrl() || s.code;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1_500);
  }

  apply(): void {
    const code = this.applyForm.controls.code.value.trim();
    if (!code) return;
    this.applying.set(true);
    this.applyError.set(null);
    this.http.post<ReferralSummary>(`${this.api.baseUrl}/me/referrals/apply`, { code }).subscribe({
      next: (s) => {
        this.applying.set(false);
        this.summary.set(s);
        this.applyForm.reset();
      },
      error: (err) => {
        this.applying.set(false);
        this.applyError.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
      },
    });
  }

  private refresh(): void {
    this.http.get<ReferralSummary>(`${this.api.baseUrl}/me/referrals`).subscribe({
      next: (s) => this.summary.set(s),
      error: (err) => this.loadError.set(extractMessage(err) ?? this.translate.instant('common.genericError')),
    });
  }
}

function extractMessage(err: unknown): string | null {
  const maybe = err as { error?: { message?: unknown }; message?: unknown };
  if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
  if (typeof maybe.message === 'string') return maybe.message;
  return null;
}
