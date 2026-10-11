import { Component, inject, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { type FeedbackKind, SUPPORT_TOPICS } from '@takeaway/shared-types';

import { ActiveBrandService } from '../core/brand-context/active-brand.service';
import { FeedbackApi } from '../core/feedback/feedback.service';
import { apiErrorMessage } from '../core/http/api-error';
import { ConfirmDialogComponent } from './confirm-dialog.component';

/**
 * «Написать в поддержку»: a topic and a message to the takeAway team, about
 * the brand in the header. It lands in the platform's feedback inbox and
 * pings the team in Telegram; they answer by phone or email. After sending
 * the dialog says so and closes on the next click.
 */
@Component({
  selector: 'app-support-dialog',
  standalone: true,
  imports: [ConfirmDialogComponent, TranslatePipe],
  template: `
    @if (sent()) {
      <app-confirm-dialog
        [title]="'admin.support.sentTitle' | translate"
        [body]="'admin.support.sentBody' | translate"
        [confirmLabel]="'admin.support.ok' | translate"
        [cancelLabel]="'common.close' | translate"
        (confirmed)="closed.emit()"
        (cancelled)="closed.emit()"
      />
    } @else {
      <app-confirm-dialog
        [title]="'admin.support.title' | translate"
        [body]="'admin.support.body' | translate"
        [reasonLabel]="'admin.support.message' | translate"
        [reasonPlaceholder]="'admin.support.messagePlaceholder' | translate"
        [reasonRequiredText]="'admin.support.messageRequired' | translate"
        [confirmLabel]="'admin.support.send' | translate"
        [cancelLabel]="'common.cancel' | translate"
        [busy]="sending()"
        (confirmed)="send($event)"
        (cancelled)="closed.emit()"
      >
        <label class="support-topic">
          <span>{{ 'admin.support.topic' | translate }}</span>
          <select [value]="topic()" (change)="pick($any($event.target).value)">
            @for (t of topics; track t) {
              <option [value]="t">{{ 'admin.support.topics.' + t | translate }}</option>
            }
          </select>
        </label>
        @if (error(); as message) {
          <p role="alert" class="support-error">{{ message }}</p>
        }
      </app-confirm-dialog>
    }
  `,
  styles: [
    `
      .support-topic {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-family: var(--font-sans);
        font-size: 12px;
        font-weight: 500;
        color: var(--color-text-secondary);
      }
      .support-topic select {
        height: 40px;
        padding: 0 10px;
        background: var(--color-cream);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        font-family: var(--font-sans);
        font-size: 14px;
        color: var(--color-text-primary);
      }
      .support-error {
        margin: 0;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-berry);
      }
    `,
  ],
})
export class SupportDialogComponent {
  private readonly feedback = inject(FeedbackApi);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly translate = inject(TranslateService);

  readonly closed = output<void>();

  readonly topics = SUPPORT_TOPICS;
  readonly topic = signal<FeedbackKind>('QUESTION');
  readonly sending = signal(false);
  readonly sent = signal(false);
  readonly error = signal<string | null>(null);

  pick(value: string): void {
    const topic = SUPPORT_TOPICS.find((t) => t === value);
    if (topic) this.topic.set(topic);
  }

  send(message: string): void {
    this.sending.set(true);
    this.error.set(null);
    this.feedback.sendSupport({ kind: this.topic(), message }, this.activeBrand.activeId()).subscribe({
      next: () => {
        this.sending.set(false);
        this.sent.set(true);
      },
      error: (err) => {
        this.sending.set(false);
        this.error.set(
          apiErrorMessage(err, this.translate, {
            codes: { FEEDBACK_TOO_MANY: 'admin.support.tooMany' },
            network: 'common.networkError',
          }),
        );
      },
    });
  }
}
