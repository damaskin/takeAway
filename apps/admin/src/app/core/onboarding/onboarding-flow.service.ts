import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthStore } from '../auth/auth.store';
import { ActiveBrandService } from '../brand-context/active-brand.service';
import { type BrandOnboarding, OnboardingApi } from './onboarding.service';

/** The «Запуск бренда» steps an owner does themselves. */
export type OnboardingStep = 'brand' | 'store' | 'menu';

/** What happened after a save on a step's page. */
export type AfterSave =
  /** Not reached from the checklist: the page carries on as it always has. */
  | 'inactive'
  /** The step is done: the owner is on their way back to the checklist. */
  | 'returned'
  /** Saved, but the step still needs something; the page stays and says what. */
  | 'incomplete';

/** A step finished on its page, for the checklist to celebrate once. */
export interface OnboardingFlash {
  step: OnboardingStep;
  at: number;
}

/** A trip from the checklist that nobody finished is forgotten after this. */
const FLOW_TTL_MS = 30 * 60_000;

/**
 * The way from «Запуск бренда» to a step's page and back. Opening a step
 * from the checklist starts a trip; a successful save on that step's page
 * asks the API whether the step is now done — if so, the owner goes back to
 * the checklist, which shows a short "saved" note and the next step; if
 * not, the page stays and says what the step still needs. Visiting the same
 * pages any other way works as before; while the launch is unfinished they
 * only show a «Вернуться к запуску бренда» link.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingFlowService {
  private readonly api = inject(OnboardingApi);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  private readonly trip = signal<{ step: OnboardingStep; at: number } | null>(null);
  private readonly _flash = signal<OnboardingFlash | null>(null);
  private readonly _progress = signal<BrandOnboarding | null>(null);
  private readonly _hint = signal<OnboardingStep | null>(null);

  /** The step just finished on its page — the checklist shows it once and clears it. */
  readonly flash = this._flash.asReadonly();
  /** The owner's last known checklist, for the «Вернуться к запуску бренда» link. */
  readonly progress = this._progress.asReadonly();
  /** A step saved from the checklist that still needs something — its page says what. */
  readonly hint = this._hint.asReadonly();
  /** Only a brand owner launches a brand. */
  readonly forOwner = computed(() => this.auth.user()?.role === 'BRAND_ADMIN');

  /** The owner opened a step from the checklist. */
  start(step: OnboardingStep, now = Date.now()): void {
    this.trip.set({ step, at: now });
    this._hint.set(null);
  }

  /** Whether the owner is on a trip from the checklist to this step. */
  active(step: OnboardingStep, now = Date.now()): boolean {
    const trip = this.trip();
    return !!trip && trip.step === step && now - trip.at < FLOW_TTL_MS;
  }

  /**
   * Call after a successful save on a step's page. Off a trip it does
   * nothing; on one it re-reads the checklist and either takes the owner
   * back to it (the step is done) or leaves them where they are.
   */
  async afterSave(step: OnboardingStep, now = Date.now()): Promise<AfterSave> {
    if (!this.forOwner() || !this.active(step, now)) return 'inactive';
    const brandId = this.activeBrand.activeId();
    if (!brandId) return 'inactive';
    let progress: BrandOnboarding;
    try {
      progress = await firstValueFrom(this.api.checklist(brandId));
    } catch {
      // The save itself worked; without the checklist the page just stays.
      return 'inactive';
    }
    this._progress.set(progress);
    if (!stepDone(progress, step)) {
      this._hint.set(step);
      return 'incomplete';
    }
    this.trip.set(null);
    this._hint.set(null);
    this._flash.set({ step, at: now });
    await this.router.navigate(['/dashboard']);
    return 'returned';
  }

  /** Re-reads the checklist of the brand in view — the return link shows only while it is unfinished. */
  refreshProgress(): void {
    const brandId = this.activeBrand.activeId();
    if (!this.forOwner() || !brandId) return;
    this.api.checklist(brandId).subscribe({
      next: (progress) => this._progress.set(progress),
      error: () => undefined,
    });
  }

  /** The checklist keeps its own copy fresh; this one serves the other pages. */
  noteProgress(progress: BrandOnboarding): void {
    this._progress.set(progress);
  }

  clearFlash(): void {
    this._flash.set(null);
  }
}

/** Whether the owner's part of a step is done. */
export function stepDone(progress: BrandOnboarding, step: OnboardingStep): boolean {
  if (step === 'brand') return progress.brandProfile;
  if (step === 'store') return progress.store;
  return progress.menu;
}
