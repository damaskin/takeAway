import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { catchError, map, of, switchMap } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { OnboardingFlowService, type OnboardingStep } from '../../core/onboarding/onboarding-flow.service';
import { type BrandOnboarding, OnboardingApi } from '../../core/onboarding/onboarding.service';

interface ChecklistStep {
  key: 'brand' | 'store' | 'menu' | 'payments' | 'moderation';
  done: boolean;
  /** Translation key of the line under the title. */
  text: string;
  link?: string;
}

type ChecklistState = { data: BrandOnboarding } | { failed: true } | null;

/** How long the "saved" note stays after coming back from a step. */
const FLASH_MS = 6000;

/**
 * The launch checklist at the top of a new brand owner's dashboard: brand
 * details, a store, a menu, how customers pay, and moderation. Every tick
 * comes from the brand's real data (GET /my-brand/onboarding), so the list
 * cannot be "completed" without doing the work, and it goes away by itself
 * once everything is done and the brand is approved.
 *
 * A step opened from here comes back here once it is saved and done (see
 * {@link OnboardingFlowService}): a short note says so and the next step
 * to do is highlighted. When that was the last one, the card says
 * everything is ready and opens onto the panel.
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
        @if (flashStep(); as step) {
          <p class="ob-flash" role="status">
            ✓ {{ 'admin.onboarding.checklist.saved' | translate }} «{{
              'admin.onboarding.checklist.' + step + '.title' | translate
            }}»
          </p>
        }

        @if (allDone()) {
          <div class="ob-ready">
            <h2>{{ 'admin.onboarding.checklist.ready.title' | translate }}</h2>
            <p>{{ 'admin.onboarding.checklist.ready.text' | translate }}</p>
            <button type="button" class="ob-ready-cta" (click)="openPanel()">
              {{ 'admin.onboarding.checklist.ready.cta' | translate }}
            </button>
          </div>
        } @else {
          <header class="flex items-start justify-between flex-wrap" style="gap: 8px 16px">
            <div class="flex flex-col" style="gap: 4px; min-width: 0">
              <h2
                style="font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso); margin: 0"
              >
                {{ 'admin.onboarding.checklist.title' | translate }}
              </h2>
              <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
                {{
                  (ownerPartDone()
                    ? 'admin.onboarding.checklist.waitingModeration'
                    : 'admin.onboarding.checklist.subtitle'
                  ) | translate
                }}
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
              <li class="ob-step flex items-center" [attr.data-next]="step.key === nextStep()">
                <span class="step-mark" [attr.data-done]="step.done" aria-hidden="true">{{
                  step.done ? '✓' : i + 1
                }}</span>
                <div class="flex flex-col flex-1" style="gap: 2px; min-width: 0">
                  <span
                    style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
                    >{{ 'admin.onboarding.checklist.' + step.key + '.title' | translate }}
                    @if (step.key === nextStep()) {
                      <em class="ob-next">{{ 'admin.onboarding.checklist.next' | translate }}</em>
                    }
                  </span>
                  <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                    step.text | translate
                  }}</span>
                </div>
                @if (step.link && !step.done) {
                  <a
                    [routerLink]="step.link"
                    (click)="open(step.key)"
                    style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-caramel); white-space: nowrap"
                    >{{ 'admin.onboarding.checklist.open' | translate }} →</a
                  >
                }
              </li>
            }
          </ol>
        }
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
      .ob-step {
        gap: 14px;
        padding: 12px 14px;
        border: 1px solid var(--color-border-light);
        border-radius: 14px;
      }
      .ob-step[data-next='true'] {
        border-color: var(--color-caramel);
        background: var(--color-caramel-light);
      }
      .ob-next {
        margin-left: 6px;
        padding: 1px 8px;
        border-radius: 9999px;
        background: var(--color-caramel);
        color: white;
        font-style: normal;
        font-size: 11px;
        font-weight: 600;
        vertical-align: middle;
      }
      .ob-flash {
        margin: 0;
        padding: 10px 14px;
        border-radius: 12px;
        background: #7bc4a433;
        color: #2f6e53;
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
      }
      .ob-ready {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        font-family: var(--font-sans);
      }
      .ob-ready h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: 20px;
        color: var(--color-espresso);
      }
      .ob-ready p {
        margin: 0;
        font-size: 14px;
        color: var(--color-text-secondary);
      }
      .ob-ready-cta {
        margin-top: 4px;
        height: 40px;
        padding: 0 18px;
        border: 0;
        border-radius: var(--radius-button);
        background: var(--color-caramel);
        color: white;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
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
  private readonly flow = inject(OnboardingFlowService);

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

  /** The step just finished on its page, shown for a few seconds. */
  readonly flashStep = signal<OnboardingStep | null>(null);
  /** The «всё готово» card was closed: the panel is all that is left. */
  private readonly dismissed = signal(false);

  /** Everything done and approved, right after the last step came back: the card says so once. */
  readonly allDone = computed(() => !!this.data()?.complete && this.flashStep() !== null);

  readonly visible = computed(() => {
    const data = this.data();
    if (!data || this.dismissed()) return false;
    return data.complete !== true || this.allDone();
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

  /** The first step the owner still has to do — highlighted as the next one. */
  readonly nextStep = computed(() => this.steps().find((s) => !s.done && s.link)?.key ?? null);
  /** Brand, store and menu are done; only the moderator is left. */
  readonly ownerPartDone = computed(() => this.steps().length > 0 && this.nextStep() === null);

  readonly doneCount = computed(() => this.steps().filter((s) => s.done).length);
  readonly progressPercent = computed(() => {
    const total = this.steps().length;
    return total ? Math.round((this.doneCount() / total) * 100) : 0;
  });

  constructor() {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // A step finished on its page: show it, then let it go. The flash is
    // taken once, so coming back to the dashboard later shows nothing.
    effect(() => {
      const flash = this.flow.flash();
      if (!flash) return;
      untracked(() => {
        this.flashStep.set(flash.step);
        this.flow.clearFlash();
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          // The «всё готово» card stays until it is closed.
          if (!this.data()?.complete) this.flashStep.set(null);
        }, FLASH_MS);
      });
    });
    // The other pages' «Вернуться к запуску бренда» link goes by the same list.
    effect(() => {
      const data = this.data();
      if (data) untracked(() => this.flow.noteProgress(data));
    });
    inject(DestroyRef).onDestroy(() => {
      if (timer) clearTimeout(timer);
    });
  }

  /** Opening a step from here brings the owner back here once it is done. */
  open(key: ChecklistStep['key']): void {
    if (key === 'brand' || key === 'store' || key === 'menu') this.flow.start(key);
  }

  /** «Перейти к панели»: the card goes, the dashboard is underneath. */
  openPanel(): void {
    this.dismissed.set(true);
    this.flashStep.set(null);
  }
}
