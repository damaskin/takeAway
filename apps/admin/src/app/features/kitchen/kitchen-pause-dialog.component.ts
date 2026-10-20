import { Component, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
  KITCHEN_PAUSE_COMMENT_MAX,
  KITCHEN_PAUSE_MINUTES,
  type KitchenPauseMinutes,
  type KitchenPauseRequest,
  STORE_PAUSE_REASONS,
  type StorePauseReason,
} from '@takeaway/shared-types';

import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';

/** A duration chip: minutes, or null for «До конца дня» (until the closing). */
type PauseChoice = KitchenPauseMinutes | null;

/**
 * «Пауза» on the kitchen board: the coffee machine broke, the milk ran out,
 * a barista went home. Pick what happened and for how long (15 min … 2 h,
 * or until the end of the day), add a word for the owner, confirm. Big
 * chips for a tablet; works the same in a PIN session.
 */
@Component({
  selector: 'app-kitchen-pause-dialog',
  standalone: true,
  imports: [TranslatePipe, ConfirmDialogComponent],
  template: `
    <app-confirm-dialog
      tone="danger"
      [title]="'admin.kitchen.pause.title' | translate"
      [body]="'admin.kitchen.pause.body' | translate"
      [confirmLabel]="(busy() ? 'admin.kitchen.working' : 'admin.kitchen.pause.confirm') | translate"
      [cancelLabel]="'common.cancel' | translate"
      [busy]="busy() || !reason() || !durationPicked()"
      (confirmed)="confirm()"
      (cancelled)="cancelled.emit()"
    >
      <fieldset class="pause-chips" [disabled]="busy()">
        <legend class="pause-label">{{ 'admin.kitchen.pause.reasonLabel' | translate }}</legend>
        @for (r of reasons; track r) {
          <label class="pause-chip" [class.pause-chip-on]="reason() === r">
            <input
              type="radio"
              name="kitchen-pause-reason"
              [value]="r"
              [checked]="reason() === r"
              [attr.data-testid]="'pause-reason-' + r"
              (change)="reason.set(r)"
            />
            <span>{{ 'admin.kitchen.pause.reasons.' + r | translate }}</span>
          </label>
        }
      </fieldset>
      <fieldset class="pause-chips pause-durations" [disabled]="busy()">
        <legend class="pause-label">{{ 'admin.kitchen.pause.durationLabel' | translate }}</legend>
        @for (d of durations; track d.key) {
          <label
            class="pause-chip"
            [class.pause-chip-on]="durationPicked() && duration() === d.minutes"
            [class.pause-chip-wide]="d.minutes === null"
          >
            <input
              type="radio"
              name="kitchen-pause-duration"
              [checked]="durationPicked() && duration() === d.minutes"
              [attr.data-testid]="'pause-duration-' + d.key"
              (change)="pickDuration(d.minutes)"
            />
            <span>{{ 'admin.kitchen.pause.durations.' + d.key | translate }}</span>
          </label>
        }
      </fieldset>
      <label class="flex flex-col" style="gap: 6px">
        <span class="pause-label">{{ 'admin.kitchen.pause.commentLabel' | translate }}</span>
        <input
          #commentBox
          type="text"
          class="pause-comment"
          [attr.maxlength]="commentMax"
          [placeholder]="'admin.kitchen.pause.commentPlaceholder' | translate"
          [value]="comment()"
          [disabled]="busy()"
          data-testid="pause-comment"
          (input)="comment.set(commentBox.value)"
        />
      </label>
      @if (error()) {
        <p class="pause-error" role="alert">{{ error() }}</p>
      }
    </app-confirm-dialog>
  `,
  styles: [
    `
      .pause-chips {
        margin: 0;
        padding: 0;
        border: 0;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .pause-durations {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .pause-durations .pause-chip {
        white-space: nowrap;
      }
      .pause-durations .pause-chip-wide {
        grid-column: span 2;
      }
      .pause-label {
        margin-bottom: 6px;
        padding: 0;
        font-size: 12px;
        font-weight: 500;
        color: var(--color-text-secondary);
      }
      .pause-chip {
        min-height: 48px;
        padding: 8px 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        border-radius: 12px;
        border: 1px solid var(--color-border);
        background: var(--color-cream);
        font-size: 15px;
        font-weight: 600;
        color: var(--color-text-primary);
        cursor: pointer;
      }
      .pause-chip input {
        flex: none;
        width: 18px;
        height: 18px;
        accent-color: var(--color-berry);
      }
      .pause-chip-on {
        border-color: var(--color-berry);
        box-shadow: 0 0 0 1px var(--color-berry);
      }
      .pause-comment {
        height: 44px;
        padding: 0 12px;
        background: var(--color-cream);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        font-family: var(--font-sans);
        font-size: 15px;
        outline: none;
      }
      .pause-error {
        margin: 0;
        font-size: 13px;
        color: var(--color-berry);
      }
    `,
  ],
})
export class KitchenPauseDialogComponent {
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly confirmed = output<KitchenPauseRequest>();
  readonly cancelled = output<void>();

  readonly reasons = STORE_PAUSE_REASONS;
  readonly durations: ReadonlyArray<{ key: string; minutes: PauseChoice }> = [
    ...KITCHEN_PAUSE_MINUTES.map((minutes) => ({ key: `m${minutes}`, minutes })),
    { key: 'untilClose', minutes: null },
  ];
  readonly commentMax = KITCHEN_PAUSE_COMMENT_MAX;

  /** Nothing is picked up front, so a stray tap cannot pause the store for the wrong reason or time. */
  readonly reason = signal<StorePauseReason | null>(null);
  readonly duration = signal<PauseChoice>(null);
  readonly durationPicked = signal(false);
  readonly comment = signal('');

  pickDuration(minutes: PauseChoice): void {
    this.duration.set(minutes);
    this.durationPicked.set(true);
  }

  confirm(): void {
    const reason = this.reason();
    if (!reason || !this.durationPicked() || this.busy()) return;
    const comment = this.comment().trim().slice(0, KITCHEN_PAUSE_COMMENT_MAX);
    this.confirmed.emit({ minutes: this.duration(), reason, ...(comment ? { comment } : {}) });
  }
}
