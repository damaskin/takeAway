import { Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { SHIFT_EXTEND_MINUTES } from '@takeaway/shared-types';

import type { ShiftBanner } from '../../core/kitchen/kitchen-board';
import type { ShiftExtendMinutes } from '../../core/kitchen/kitchen.api';

/**
 * The closing banner over the kitchen board: 15 minutes before the working
 * hours (or an extension) end, with «Продлить на 30 мин / 1 ч» while the API
 * allows an extension (`canExtend`). Outside the hours there is no banner
 * and nothing to extend — the schedule line says when the store opens. The
 * time arrives formatted in the store's timezone.
 */
@Component({
  selector: 'app-kitchen-shift-banner',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @let b = banner();
    <div class="banner" role="status" data-testid="shift-banner-closingSoon">
      <span class="banner-text">
        {{
          (b.extended ? 'admin.kitchen.shift.closingSoonExtended' : 'admin.kitchen.shift.closingSoon')
            | translate: { time: time() }
        }}
      </span>
      @if (b.canExtend) {
        <span class="banner-actions">
          @for (minutes of options; track minutes) {
            <button
              type="button"
              class="banner-button"
              [disabled]="busy()"
              [attr.data-testid]="'shift-extend-' + minutes"
              (click)="extend.emit(minutes)"
            >
              {{ 'admin.kitchen.shift.extend' + minutes | translate }}
            </button>
          }
        </span>
      }
    </div>
  `,
  styles: [
    `
      .banner {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
        padding: 12px 16px;
        border-radius: 14px;
        border: 1px solid var(--color-amber);
        background: rgba(233, 168, 75, 0.18);
        font-family: var(--font-sans);
      }
      .banner-text {
        flex: 1 1 240px;
        font-size: 15px;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .banner-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .banner-button {
        height: 34px;
        padding: 0 12px;
        border-radius: 10px;
        border: 1px solid var(--color-border-light);
        background: var(--color-foam);
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .banner-button:disabled {
        opacity: 0.6;
        cursor: progress;
      }
    `,
  ],
})
export class KitchenShiftBannerComponent {
  readonly banner = input.required<ShiftBanner>();
  /** The closing time (or the end of the extension), on the store's clock. */
  readonly time = input('');
  readonly busy = input(false);
  readonly extend = output<ShiftExtendMinutes>();

  readonly options = SHIFT_EXTEND_MINUTES;
}
