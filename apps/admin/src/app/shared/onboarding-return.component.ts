import { Component, OnInit, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { OnboardingFlowService, type OnboardingStep } from '../core/onboarding/onboarding-flow.service';

/**
 * «← Вернуться к запуску бренда» on the pages the launch checklist sends an
 * owner to, while the launch is unfinished. After a save from the checklist
 * that did not finish the step, it also says what the step still needs.
 * Shows nothing to anyone but a brand owner, and nothing once launched.
 */
@Component({
  selector: 'app-onboarding-return',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    @if (visible()) {
      <div class="ob-return" [class.ob-return-hint]="showHint()" [class.ob-return-padded]="padded()">
        <a routerLink="/dashboard" class="ob-return-link">← {{ 'admin.onboarding.return.link' | translate }}</a>
        @if (showHint()) {
          <span role="status">
            {{ 'admin.onboarding.return.savedButTodo' | translate }}
            {{ 'admin.onboarding.checklist.' + step() + '.todo' | translate }}
          </span>
        }
      </div>
    }
  `,
  styles: [
    `
      /* No box of its own, so a hidden link leaves no gap in a flex column. */
      :host {
        display: contents;
      }
      .ob-return {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 14px;
        margin: 0 0 8px;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .ob-return-hint {
        padding: 10px 14px;
        border-radius: 12px;
        background: var(--color-caramel-light);
        color: var(--color-text-primary);
      }
      /* On a page without its own padding around the top. */
      .ob-return-padded {
        margin: clamp(16px, 3vw, 24px) clamp(16px, 3vw, 24px) 0;
      }
      .ob-return-link {
        font-weight: 600;
        color: var(--color-caramel);
        white-space: nowrap;
      }
    `,
  ],
})
export class OnboardingReturnComponent implements OnInit {
  private readonly flow = inject(OnboardingFlowService);

  /** The checklist step this page belongs to. */
  readonly step = input.required<OnboardingStep>();
  /** Keeps the page's gutter itself, for pages whose top has no padding. */
  readonly padded = input(false);

  readonly visible = computed(() => {
    const progress = this.flow.progress();
    return this.flow.forOwner() && !!progress && !progress.complete;
  });
  readonly showHint = computed(() => this.flow.hint() === this.step());

  ngOnInit(): void {
    this.flow.refreshProgress();
  }
}
