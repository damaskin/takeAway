import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  FEEDBACK_CONTACT_MAX_LENGTH,
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  type FeedbackKind,
} from '@takeaway/shared-types';

import { FeedbackService } from '../../core/feedback/feedback.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

/**
 * «Обратная связь» in the Mini App: a review, a suggestion or a problem
 * report, read by the takeAway team. Telegram's back button returns to the
 * profile.
 */
@Component({
  selector: 'app-tma-feedback',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <section style="padding: 16px; padding-bottom: 100px; display: flex; flex-direction: column; gap: 16px">
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'web.profile.feedback.title' | translate }}
      </h1>

      @if (sent()) {
        <div class="flex flex-col items-center text-center" style="gap: 10px; padding: 24px 0">
          <span style="font-size: 40px" aria-hidden="true">💌</span>
          <h2 style="font-family: var(--font-display); font-size: 20px; color: var(--color-espresso); margin: 0">
            {{ 'web.profile.feedback.sentTitle' | translate }}
          </h2>
          <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
            {{ 'web.profile.feedback.sentBody' | translate }}
          </p>
        </div>
        <button type="button" class="tfb-primary" (click)="backToProfile()">
          {{ 'web.profile.feedback.backToProfile' | translate }}
        </button>
        <button type="button" class="tfb-secondary" (click)="another()">
          {{ 'web.profile.feedback.another' | translate }}
        </button>
      } @else {
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
          {{ 'web.profile.feedback.subtitle' | translate }}
        </p>

        <div class="flex" style="gap: 6px" role="group" [attr.aria-label]="'web.profile.feedback.title' | translate">
          @for (k of kinds; track k) {
            <button
              type="button"
              class="tfb-kind"
              [class.tfb-kind-active]="kind() === k"
              [attr.aria-pressed]="kind() === k"
              [disabled]="sending()"
              (click)="pick(k)"
            >
              {{ 'web.profile.feedback.kinds.' + k | translate }}
            </button>
          }
        </div>

        <label class="flex flex-col" style="gap: 6px">
          <span style="font-family: var(--font-sans); font-size: 13px; font-weight: 600">{{
            'web.profile.feedback.message' | translate
          }}</span>
          <textarea
            name="message"
            rows="6"
            [maxLength]="messageMax"
            [value]="message()"
            (input)="message.set($any($event.target).value)"
            [placeholder]="'web.profile.feedback.hints.' + kind() | translate"
            [disabled]="sending()"
            class="tfb-field"
            style="padding: 12px; resize: vertical; min-height: 130px"
          ></textarea>
          <span
            style="align-self: flex-end; font-family: var(--font-sans); font-size: 11px; color: var(--color-text-tertiary)"
            >{{ message().length }} / {{ messageMax }}</span
          >
        </label>

        <label class="flex flex-col" style="gap: 6px">
          <span style="font-family: var(--font-sans); font-size: 13px; font-weight: 600">{{
            'web.profile.feedback.contact' | translate
          }}</span>
          <input
            name="contact"
            type="text"
            autocomplete="off"
            [maxLength]="contactMax"
            [value]="contact()"
            (input)="contact.set($any($event.target).value)"
            [placeholder]="'web.profile.feedback.contactHint' | translate"
            [disabled]="sending()"
            class="tfb-field"
            style="height: 48px; padding: 0 12px"
          />
        </label>

        @if (error()) {
          <p
            role="alert"
            class="text-center"
            style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0"
          >
            {{ error() }}
          </p>
        }

        <button
          type="button"
          class="tfb-primary"
          (click)="send()"
          [disabled]="!canSend()"
          [style.opacity]="canSend() ? '1' : '0.5'"
        >
          {{ (sending() ? 'web.profile.feedback.sending' : 'web.profile.feedback.send') | translate }}
        </button>
      }
    </section>
  `,
  styles: [
    `
      .tfb-kind {
        flex: 1 1 0;
        min-width: 0;
        height: 38px;
        padding: 0 6px;
        border-radius: 9999px;
        border: 1px solid var(--color-border-light);
        background: var(--color-foam);
        color: var(--color-text-primary);
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .tfb-kind-active {
        background: var(--color-caramel);
        border-color: var(--color-caramel);
        color: white;
        font-weight: 600;
      }
      .tfb-field {
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: var(--radius-input);
        font-family: var(--font-sans);
        font-size: 14px;
        color: var(--color-text-primary);
        outline: none;
      }
      .tfb-field:focus {
        border-color: var(--color-caramel);
      }
      .tfb-primary,
      .tfb-secondary {
        height: 48px;
        border-radius: var(--radius-button);
        font-family: var(--font-sans);
        font-size: 14px;
        font-weight: 600;
      }
      .tfb-primary {
        background: var(--color-caramel);
        color: white;
      }
      .tfb-secondary {
        background: var(--color-foam);
        color: var(--color-text-primary);
        border: 1px solid var(--color-border-light);
      }
    `,
  ],
})
export class TmaFeedbackPage implements OnInit, OnDestroy {
  private readonly api = inject(FeedbackService);
  private readonly tg = inject(TelegramBridgeService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly kinds = FEEDBACK_KINDS;
  readonly messageMax = FEEDBACK_MESSAGE_MAX_LENGTH;
  readonly contactMax = FEEDBACK_CONTACT_MAX_LENGTH;

  readonly kind = signal<FeedbackKind>('SUGGESTION');
  readonly message = signal('');
  readonly contact = signal('');
  readonly sending = signal(false);
  readonly sent = signal(false);
  readonly error = signal<string | null>(null);

  readonly canSend = computed(() => !this.sending() && this.message().trim().length > 0);

  private detachBack: (() => void) | null = null;

  ngOnInit(): void {
    this.detachBack = this.tg.setBackButton(() => this.backToProfile());
  }

  ngOnDestroy(): void {
    this.detachBack?.();
  }

  pick(kind: FeedbackKind): void {
    this.tg.haptic('light');
    this.kind.set(kind);
  }

  send(): void {
    if (!this.canSend()) return;
    this.sending.set(true);
    this.error.set(null);
    this.tg.haptic('light');
    const contact = this.contact().trim();
    this.api
      .send({
        kind: this.kind(),
        message: this.message().trim(),
        source: 'TMA',
        ...(contact ? { contact } : {}),
      })
      .subscribe({
        next: () => {
          this.sending.set(false);
          this.sent.set(true);
        },
        // What the customer typed stays in the form for another try.
        error: (err: unknown) => {
          this.sending.set(false);
          this.error.set(this.describe(err));
        },
      });
  }

  another(): void {
    this.message.set('');
    this.contact.set('');
    this.sent.set(false);
  }

  backToProfile(): void {
    void this.router.navigate(['/profile']);
  }

  private describe(err: unknown): string {
    const status = (err as { status?: unknown } | null)?.status;
    const key =
      status === 429
        ? 'web.profile.feedback.tooMany'
        : status === 401
          ? 'web.profile.feedback.signInRequired'
          : status === 0
            ? 'common.networkError'
            : 'common.genericError';
    return this.translate.instant(key);
  }
}
