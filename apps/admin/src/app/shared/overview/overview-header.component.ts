import { Component, inject, input, model, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { OverviewPeriod } from '@takeaway/shared-types';

import { DateRangeComponent, type DateRangeValue, type RangePreset } from '../date-range.component';
import { OverviewFormat } from './overview-format.service';

const PRESETS: readonly RangePreset[] = [7, 30, 90];

/**
 * The dashboards' header: the title, the days on screen and what they are
 * compared with, the period picker (7 / 30 / 90 days or a calendar range),
 * a refresh button and whatever selectors the page projects.
 */
@Component({
  selector: 'app-overview-header',
  standalone: true,
  imports: [TranslatePipe, DateRangeComponent],
  template: `
    <header class="oh">
      <div class="oh-titles">
        <h1>{{ title() }}</h1>
        <p class="oh-period" aria-live="polite">{{ format.periodLine(period()) }}</p>
      </div>
      <div class="oh-controls">
        <ng-content />
        <app-date-range [(value)]="range" [presets]="presets" />
        <button
          type="button"
          class="oh-refresh"
          [class.is-spinning]="loading()"
          [disabled]="loading()"
          [attr.aria-label]="'admin.overview.refresh' | translate"
          [title]="'admin.overview.refresh' | translate"
          (click)="refresh.emit()"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
    </header>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .oh {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px 16px;
      }
      .oh-titles {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: 28px;
        font-weight: 700;
        color: var(--color-espresso);
      }
      .oh-period {
        margin: 0;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-secondary);
        min-height: 18px;
      }
      .oh-controls {
        display: flex;
        align-items: flex-start;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }
      .oh-refresh {
        flex: none;
        width: 32px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--color-border-light);
        border-radius: 9999px;
        background: var(--color-foam);
        color: var(--color-text-secondary);
        cursor: pointer;
      }
      .oh-refresh:disabled {
        cursor: default;
      }
      .oh-refresh.is-spinning svg {
        animation: oh-spin 0.8s linear infinite;
      }
      @keyframes oh-spin {
        to {
          transform: rotate(360deg);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .oh-refresh.is-spinning svg {
          animation: none;
        }
      }
      @media (max-width: 640px) {
        .oh-controls {
          justify-content: flex-start;
          width: 100%;
        }
      }
    `,
  ],
})
export class OverviewHeaderComponent {
  protected readonly format = inject(OverviewFormat);

  readonly title = input.required<string>();
  readonly period = input<OverviewPeriod | null>(null);
  readonly loading = input(false);
  readonly range = model.required<DateRangeValue>();
  readonly refresh = output<void>();

  protected readonly presets = PRESETS;
}
