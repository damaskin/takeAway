import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { PlanFeature } from '@takeaway/shared-types';

/**
 * Stands in for a block the brand's plan does not include: what it would
 * show, and where to read about PRO. There is no payment flow; the upgrade
 * goes through takeAway.
 */
@Component({
  selector: 'app-plan-lock',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <div class="lock" [class.lock-compact]="compact()">
      <span class="lock-badge">{{ 'admin.plans.proBadge' | translate }}</span>
      <div class="lock-text">
        <strong>{{ 'admin.plans.features.' + feature() + '.title' | translate }}</strong>
        @if (!compact()) {
          <span>{{ 'admin.plans.features.' + feature() + '.description' | translate }}</span>
        }
      </div>
      <a routerLink="/settings" fragment="plan" class="lock-link">{{ 'admin.plans.learnMore' | translate }}</a>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .lock {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
        padding: 16px;
        border: 1px dashed var(--color-border);
        border-radius: 16px;
        background: var(--color-cream);
        font-family: var(--font-sans);
      }
      .lock-compact {
        padding: 10px 12px;
      }
      .lock-badge {
        padding: 3px 8px;
        border-radius: 9999px;
        background: var(--color-espresso);
        color: white;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.6px;
      }
      .lock-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1 1 200px;
        min-width: 0;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .lock-text strong {
        font-size: 14px;
        color: var(--color-text-primary);
      }
      .lock-link {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-caramel);
        white-space: nowrap;
      }
    `,
  ],
})
export class PlanLockComponent {
  readonly feature = input.required<PlanFeature>();
  readonly compact = input(false);
}
