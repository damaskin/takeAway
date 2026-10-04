import { Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { DEFAULT_COMMISSION_BPS, PLAN_FEATURES, type PlanFeature } from '@takeaway/shared-types';
import { map } from 'rxjs';

import { PlanAccess } from '../../core/plans/plan-access.service';

/**
 * Shown on the path of a section the brand's plan does not include (see
 * `planGated`): what the section does, what else PRO adds, and how to get
 * it. Once the plan includes it — a platform admin switched the brand, or
 * the owner picked another brand — the real section opens in its place.
 */
@Component({
  selector: 'app-plan-upsell',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <section class="upsell">
      <span class="upsell-badge">{{ 'admin.plans.proBadge' | translate }}</span>
      <h1>{{ 'admin.plans.features.' + feature() + '.title' | translate }}</h1>
      <p class="upsell-lead">{{ 'admin.plans.features.' + feature() + '.description' | translate }}</p>
      <p class="upsell-current">
        {{
          'admin.plans.upsell.current'
            | translate: { plan: ('admin.plans.names.' + (access.plan() ?? 'BASIC') | translate) }
        }}
      </p>

      <div class="upsell-card">
        <h2>{{ 'admin.plans.upsell.proIncludes' | translate: { percent: proPercent } }}</h2>
        <ul>
          @for (f of proExtras; track f) {
            <li [class.upsell-here]="f === feature()">
              <span aria-hidden="true">✓</span> {{ 'admin.plans.features.' + f + '.title' | translate }}
            </li>
          }
        </ul>
        <p class="upsell-how">{{ 'admin.plans.upsell.how' | translate }}</p>
        <a routerLink="/settings" fragment="plan" class="upsell-link">{{
          'admin.plans.upsell.toSettings' | translate
        }}</a>
      </div>
    </section>
  `,
  styles: [
    `
      .upsell {
        max-width: 640px;
        padding: clamp(16px, 4vw, 32px);
        display: flex;
        flex-direction: column;
        gap: 12px;
        font-family: var(--font-sans);
      }
      .upsell-badge {
        align-self: flex-start;
        padding: 4px 10px;
        border-radius: 9999px;
        background: var(--color-espresso);
        color: white;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.6px;
      }
      h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: 28px;
        color: var(--color-espresso);
      }
      .upsell-lead {
        margin: 0;
        font-size: 15px;
        color: var(--color-text-secondary);
      }
      .upsell-current {
        margin: 0;
        font-size: 13px;
        color: var(--color-text-tertiary);
      }
      .upsell-card {
        margin-top: 8px;
        padding: 20px;
        border-radius: 20px;
        border: 1px solid var(--color-border-light);
        background: var(--color-foam);
      }
      h2 {
        margin: 0 0 12px;
        font-family: var(--font-display);
        font-size: 18px;
        color: var(--color-espresso);
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 14px;
        color: var(--color-text-primary);
      }
      li span {
        color: var(--color-mint);
        font-weight: 700;
      }
      .upsell-here {
        font-weight: 700;
      }
      .upsell-how {
        margin: 16px 0 8px;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .upsell-link {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-caramel);
      }
    `,
  ],
})
export class PlanUpsellPage {
  readonly access = inject(PlanAccess);
  private readonly router = inject(Router);

  readonly feature = toSignal(inject(ActivatedRoute).data.pipe(map((d) => d['planFeature'] as PlanFeature)), {
    initialValue: 'promo' as PlanFeature,
  });
  readonly proExtras = PLAN_FEATURES.PRO.filter((f) => !PLAN_FEATURES.BASIC.includes(f));
  readonly proPercent = DEFAULT_COMMISSION_BPS.PRO / 100;

  private readonly unlocked = computed(() => this.access.has(this.feature()));

  constructor() {
    effect(() => {
      if (this.unlocked()) {
        void this.router.navigateByUrl(this.router.url, { onSameUrlNavigation: 'reload' });
      }
    });
  }
}
