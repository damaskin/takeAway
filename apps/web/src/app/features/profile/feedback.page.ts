import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  FEEDBACK_CONTACT_MAX_LENGTH,
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  type FeedbackKind,
} from '@takeaway/shared-types';

import { FeedbackService } from '../../core/feedback/feedback.service';

/**
 * «Обратная связь» — a review, a suggestion or a problem report from the
 * profile, read by the takeAway team. Signed-in only (the route's guard).
 */
@Component({
  selector: 'app-profile-feedback',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <section style="min-height: calc(100vh - 72px); background: var(--color-cream); padding: 32px 16px">
      <div style="max-width: 540px; margin: 0 auto">
        <a
          routerLink="/profile"
          style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); text-decoration: none"
          >← {{ 'common.back' | translate }}</a
        >
        <h1 style="font-family: var(--font-display); font-size: 28px; color: var(--color-espresso); margin: 12px 0 8px">
          {{ 'web.profile.feedback.title' | translate }}
        </h1>

        @if (sent()) {
          <div
            class="flex flex-col items-center text-center"
            style="gap: 12px; background: var(--color-foam); border-radius: var(--radius-card); padding: 32px 24px; box-shadow: var(--shadow-soft); margin-top: 16px"
          >
            <span style="font-size: 40px" aria-hidden="true">💌</span>
            <h2 style="font-family: var(--font-display); font-size: 22px; color: var(--color-espresso); margin: 0">
              {{ 'web.profile.feedback.sentTitle' | translate }}
            </h2>
            <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
              {{ 'web.profile.feedback.sentBody' | translate }}
            </p>
            <div class="flex flex-wrap justify-center" style="gap: 8px; margin-top: 8px">
              <a
                routerLink="/profile"
                class="flex items-center justify-center"
                style="height: 44px; padding: 0 20px; background: var(--color-caramel); color: white; border-radius: var(--radius-pill); font-family: var(--font-sans); font-size: 15px; font-weight: 600; text-decoration: none"
                >{{ 'web.profile.feedback.backToProfile' | translate }}</a
              >
              <button
                type="button"
                (click)="another()"
                style="height: 44px; padding: 0 20px; background: transparent; border: 1px solid var(--color-border); color: var(--color-text-primary); border-radius: var(--radius-pill); font-family: var(--font-sans); font-size: 15px; font-weight: 600"
              >
                {{ 'web.profile.feedback.another' | translate }}
              </button>
            </div>
          </div>
        } @else {
          <p
            style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0 0 24px"
          >
            {{ 'web.profile.feedback.subtitle' | translate }}
          </p>

          <form
            (submit)="$event.preventDefault(); send()"
            class="flex flex-col"
            style="gap: 16px; background: var(--color-foam); border-radius: var(--radius-card); padding: 24px; box-shadow: var(--shadow-soft)"
          >
            <div
              class="flex"
              style="gap: 8px"
              role="group"
              [attr.aria-label]="'web.profile.feedback.title' | translate"
            >
              @for (k of kinds; track k) {
                <button
                  type="button"
                  class="fb-kind"
                  [class.fb-kind-active]="kind() === k"
                  [attr.aria-pressed]="kind() === k"
                  [disabled]="sending()"
                  (click)="kind.set(k)"
                >
                  {{ 'web.profile.feedback.kinds.' + k | translate }}
                </button>
              }
            </div>

            <label class="flex flex-col" style="gap: 6px">
              <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
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
                class="fb-field"
                style="padding: 12px 14px; resize: vertical; min-height: 140px"
              ></textarea>
              <span
                style="align-self: flex-end; font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
                >{{ message().length }} / {{ messageMax }}</span
              >
            </label>

            <label class="flex flex-col" style="gap: 6px">
              <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
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
                class="fb-field"
                style="height: 48px; padding: 0 14px"
              />
            </label>

            @if (error()) {
              <p
                role="alert"
                style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0"
              >
                {{ error() }}
              </p>
            }

            <button
              type="submit"
              [disabled]="!canSend()"
              class="flex items-center justify-center disabled:opacity-50"
              style="height: 52px; background: var(--color-caramel); color: white; border-radius: var(--radius-pill); font-family: var(--font-sans); font-size: 16px; font-weight: 600"
            >
              {{ (sending() ? 'web.profile.feedback.sending' : 'web.profile.feedback.send') | translate }}
            </button>
          </form>
        }
      </div>
    </section>
  `,
  styles: [
    `
      .fb-kind {
        flex: 1 1 0;
        min-width: 0;
        height: 40px;
        padding: 0 8px;
        border-radius: var(--radius-pill);
        border: 1px solid var(--color-border);
        background: var(--color-cream);
        color: var(--color-text-primary);
        font-family: var(--font-sans);
        font-size: 14px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .fb-kind-active {
        background: var(--color-caramel);
        border-color: var(--color-caramel);
        color: white;
        font-weight: 600;
      }
      .fb-field {
        background: var(--color-cream);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        font-family: var(--font-sans);
        font-size: 15px;
        color: var(--color-text-primary);
        outline: none;
      }
      .fb-field:focus {
        border-color: var(--color-caramel);
      }
    `,
  ],
})
export class ProfileFeedbackPage {
  private readonly api = inject(FeedbackService);
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

  send(): void {
    if (!this.canSend()) return;
    this.sending.set(true);
    this.error.set(null);
    const contact = this.contact().trim();
    this.api
      .send({
        kind: this.kind(),
        message: this.message().trim(),
        source: 'WEB',
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
