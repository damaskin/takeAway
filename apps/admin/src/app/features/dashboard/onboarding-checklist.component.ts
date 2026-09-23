import { Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { catchError, map, of, switchMap } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { type BrandOnboarding, OnboardingApi } from '../../core/onboarding/onboarding.service';

interface ChecklistStep {
  key: 'brand' | 'store' | 'menu' | 'payments' | 'moderation';
  done: boolean;
  /** Translation key of the line under the title. */
  text: string;
  link?: string;
}

type ChecklistState = { data: BrandOnboarding } | { failed: true } | null;

/**
 * The launch checklist at the top of a new brand owner's dashboard: brand
 * details, a store, a menu, how customers pay, and moderation. Every tick
 * comes from the brand's real data (GET /my-brand/onboarding), so the list
 * cannot be "completed" without doing the work, and it goes away by itself
 * once everything is done and the brand is approved.
 *
 * Payments are a status, not a task: card acceptance is switched on for
 * the whole platform, and until then customers pay on pickup — either way
 * the owner has nothing to do, so the step always counts as done.
 */
@Component({
  selector: 'app-onboarding-checklist',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    @if (visible()) {
      <article
        class="flex flex-col"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 16px"
      >
        <header class="flex items-start justify-between flex-wrap" style="gap: 8px 16px">
          <div class="flex flex-col" style="gap: 4px; min-width: 0">
            <h2
              style="font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso); margin: 0"
            >
              {{ 'admin.onboarding.checklist.title' | translate }}
            </h2>
            <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
              {{ 'admin.onboarding.checklist.subtitle' | translate }}
            </p>
          </div>
          <span
            style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-caramel); white-space: nowrap"
          >
            {{ 'admin.onboarding.checklist.progress' | translate: { done: doneCount(), total: steps().length } }}
          </span>
        </header>

        <div
          style="height: 6px; border-radius: 9999px; background: var(--color-surface-variant); overflow: hidden"
          aria-hidden="true"
        >
          <div
            [style.width.%]="progressPercent()"
            style="height: 100%; background: var(--color-caramel); border-radius: 9999px; transition: width 200ms ease"
          ></div>
        </div>

        <ol class="flex flex-col" style="gap: 8px; margin: 0; padding: 0; list-style: none">
          @for (step of steps(); track step.key; let i = $index) {
            <li
              class="flex items-center"
              style="gap: 14px; padding: 12px 14px; border: 1px solid var(--color-border-light); border-radius: 14px"
            >
              <span class="step-mark" [attr.data-done]="step.done" aria-hidden="true">{{
                step.done ? '✓' : i + 1
              }}</span>
              <div class="flex flex-col flex-1" style="gap: 2px; min-width: 0">
                <span
                  style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
                  >{{ 'admin.onboarding.checklist.' + step.key + '.title' | translate }}</span
                >
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                  step.text | translate
                }}</span>
              </div>
              @if (step.link && !step.done) {
                <a
                  [routerLink]="step.link"
                  style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-caramel); white-space: nowrap"
                  >{{ 'admin.onboarding.checklist.open' | translate }} →</a
                >
              }
            </li>
          }
        </ol>
      </article>
    } @else if (failed()) {
      <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
        {{ 'admin.onboarding.checklist.loadFailed' | translate }}
      </p>
    }
  `,
  styles: [
    `
      /* No box of its own: when there is nothing to show, the dashboard's
         column gap does not open up around an empty element. */
      :host {
        display: contents;
      }
      .step-mark {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 9999px;
        border: 1.5px solid var(--color-border);
        color: var(--color-text-secondary);
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 700;
      }
      .step-mark[data-done='true'] {
        border-color: #3e8868;
        background: #7bc4a433;
        color: #3e8868;
      }
    `,
  ],
})
export class OnboardingChecklistComponent {
  private readonly auth = inject(AuthStore);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly api = inject(OnboardingApi);

  /**
   * The owner's brand in view, and its moderation state: a resubmission or
   * a decision changes the list, so it re-reads on either.
   */
  private readonly subject = computed(
    () => {
      if (this.auth.user()?.role !== 'BRAND_ADMIN') return null;
      const brand = this.activeBrand.active();
      return brand ? { id: brand.id, status: brand.moderationStatus ?? null } : null;
    },
    { equal: (a, b) => a?.id === b?.id && a?.status === b?.status },
  );

  private readonly state = toSignal(
    toObservable(this.subject).pipe(
      switchMap((subject) =>
        subject
          ? this.api.checklist(subject.id).pipe(
              map((data): ChecklistState => ({ data })),
              catchError(() => of<ChecklistState>({ failed: true })),
            )
          : of<ChecklistState>(null),
      ),
    ),
    { initialValue: null },
  );

  private readonly data = computed(() => {
    const state = this.state();
    return state && 'data' in state ? state.data : null;
  });

  readonly failed = computed(() => {
    const state = this.state();
    return !!state && 'failed' in state;
  });

  readonly visible = computed(() => {
    const data = this.data();
    return !!data && data.complete !== true;
  });

  readonly steps = computed<ChecklistStep[]>(() => {
    const d = this.data();
    if (!d) return [];
    const base = 'admin.onboarding.checklist';
    return [
      {
        key: 'brand',
        done: d.brandProfile,
        text: `${base}.brand.${d.brandProfile ? 'done' : 'todo'}`,
        link: '/settings',
      },
      { key: 'store', done: d.store, text: `${base}.store.${d.store ? 'done' : 'todo'}`, link: '/stores' },
      { key: 'menu', done: d.menu, text: `${base}.menu.${d.menu ? 'done' : 'todo'}`, link: '/menu' },
      { key: 'payments', done: true, text: `${base}.payments.${d.cardPayments ? 'card' : 'onSite'}` },
      {
        key: 'moderation',
        done: d.moderationStatus === 'APPROVED',
        text: `${base}.moderation.${d.moderationStatus}`,
      },
    ];
  });

  readonly doneCount = computed(() => this.steps().filter((s) => s.done).length);
  readonly progressPercent = computed(() => {
    const total = this.steps().length;
    return total ? Math.round((this.doneCount() / total) * 100) : 0;
  });
}
