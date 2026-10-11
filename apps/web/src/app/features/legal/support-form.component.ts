import { Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  FEEDBACK_CONTACT_MAX_LENGTH,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_NAME_MAX_LENGTH,
  type FeedbackKind,
  SUPPORT_TOPICS,
} from '@takeaway/shared-types';
import { normalizeContact } from '@takeaway/utils';

import { AuthStore } from '../../core/auth/auth.store';
import { FeedbackService } from '../../core/feedback/feedback.service';

/**
 * «Написать нам» on the «Поддержка» page — the way to reach takeAway from
 * the site, signed in or not. It replaced the Telegram bot there, which only
 * sends order notifications and never read what people wrote to it.
 *
 * A visitor leaves an email or a phone to be answered on; a signed-in
 * customer may skip it — the message goes under their account. The hidden
 * `website` field is a honeypot: people never see it, bots fill it in, and
 * the API drops what comes with it.
 */
@Component({
  selector: 'app-support-form',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <section class="sf" id="write" aria-labelledby="support-form-title">
      <h2 id="support-form-title">{{ 'web.support.formTitle' | translate }}</h2>

      @if (sent()) {
        <div class="sf-sent" role="status">
          <strong>{{ 'web.support.sentTitle' | translate }}</strong>
          <p>{{ 'web.support.sentBody' | translate }}</p>
          <button type="button" class="sf-secondary" (click)="another()">
            {{ 'web.support.another' | translate }}
          </button>
        </div>
      } @else {
        <p class="sf-hint">
          {{ (signedIn() ? 'web.support.formHintSignedIn' : 'web.support.formHint') | translate }}
        </p>
        <form (submit)="$event.preventDefault(); send()" novalidate>
          <label class="sf-field">
            <span>{{ 'web.support.topic' | translate }}</span>
            <select name="topic" [disabled]="sending()" (change)="topic.set($any($event.target).value)">
              @for (t of topics; track t) {
                <option [value]="t" [selected]="t === topic()">{{ 'web.support.topics.' + t | translate }}</option>
              }
            </select>
          </label>

          @if (!signedIn()) {
            <label class="sf-field">
              <span>{{ 'web.support.name' | translate }}</span>
              <input
                name="name"
                type="text"
                autocomplete="name"
                [maxLength]="nameMax"
                [value]="name()"
                [disabled]="sending()"
                (input)="name.set($any($event.target).value)"
              />
            </label>
          }

          <label class="sf-field">
            <span>{{ (signedIn() ? 'web.support.contactOptional' : 'web.support.contact') | translate }}</span>
            <input
              name="contact"
              type="text"
              autocomplete="email"
              [maxLength]="contactMax"
              [value]="contact()"
              [placeholder]="'web.support.contactPlaceholder' | translate"
              [disabled]="sending()"
              [attr.aria-invalid]="contactProblem() !== null && touched()"
              (input)="contact.set($any($event.target).value)"
            />
            @if (touched() && contactProblem(); as problem) {
              <small class="sf-error">{{ 'web.support.' + problem | translate }}</small>
            }
          </label>

          <label class="sf-field">
            <span>{{ 'web.support.message' | translate }}</span>
            <textarea
              name="message"
              rows="6"
              [maxLength]="messageMax"
              [value]="message()"
              [placeholder]="'web.support.messagePlaceholder' | translate"
              [disabled]="sending()"
              (input)="message.set($any($event.target).value)"
            ></textarea>
            <small class="sf-count">{{ message().length }} / {{ messageMax }}</small>
          </label>

          <!-- Honeypot: off-screen and out of the tab order, so only bots fill it. -->
          <label class="sf-trap" aria-hidden="true">
            <span>{{ 'web.support.honeypot' | translate }}</span>
            <input
              name="website"
              type="text"
              tabindex="-1"
              autocomplete="off"
              [value]="website()"
              (input)="website.set($any($event.target).value)"
            />
          </label>

          @if (error()) {
            <p class="sf-error" role="alert">{{ error() }}</p>
          }

          <button type="submit" class="sf-send" [disabled]="sending() || message().trim().length === 0">
            {{ (sending() ? 'web.support.sending' : 'web.support.send') | translate }}
          </button>
        </form>
      }
    </section>
  `,
  styles: [
    `
      .sf {
        display: flex;
        flex-direction: column;
        gap: 12px;
        font-family: var(--font-sans);
      }
      h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        color: var(--color-espresso);
      }
      .sf-hint {
        margin: 0;
        font-size: 14px;
        line-height: 1.6;
        color: var(--color-text-secondary);
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .sf-field {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      input,
      select,
      textarea {
        width: 100%;
        box-sizing: border-box;
        background: var(--color-cream);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        font-family: var(--font-sans);
        font-size: 15px;
        color: var(--color-text-primary);
        outline: none;
      }
      input,
      select {
        height: 46px;
        padding: 0 14px;
      }
      textarea {
        padding: 12px 14px;
        min-height: 140px;
        resize: vertical;
      }
      input:focus,
      select:focus,
      textarea:focus {
        border-color: var(--color-caramel);
      }
      .sf-count {
        align-self: flex-end;
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .sf-error {
        margin: 0;
        font-size: 13px;
        color: var(--color-berry);
      }
      .sf-trap {
        position: absolute;
        left: -10000px;
        width: 1px;
        height: 1px;
        overflow: hidden;
      }
      .sf-send {
        height: 50px;
        border: 0;
        border-radius: var(--radius-pill);
        background: var(--color-caramel);
        color: white;
        font-family: var(--font-sans);
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
      }
      .sf-send:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .sf-sent {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        font-size: 15px;
        color: var(--color-text-primary);
      }
      .sf-sent p {
        margin: 0;
        color: var(--color-text-secondary);
      }
      .sf-secondary {
        height: 42px;
        padding: 0 18px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-pill);
        background: transparent;
        font-family: var(--font-sans);
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        cursor: pointer;
      }
    `,
  ],
})
export class SupportFormComponent {
  private readonly api = inject(FeedbackService);
  private readonly translate = inject(TranslateService);
  readonly signedIn = inject(AuthStore).isAuthenticated;

  readonly topics = SUPPORT_TOPICS;
  readonly nameMax = FEEDBACK_NAME_MAX_LENGTH;
  readonly contactMax = FEEDBACK_CONTACT_MAX_LENGTH;
  readonly messageMax = FEEDBACK_MESSAGE_MAX_LENGTH;

  readonly topic = signal<FeedbackKind>('QUESTION');
  readonly name = signal('');
  readonly contact = signal('');
  readonly message = signal('');
  readonly website = signal('');
  readonly touched = signal(false);
  readonly sending = signal(false);
  readonly sent = signal(false);
  readonly error = signal<string | null>(null);

  /** Why the contact will not do, as a key under `web.support`; null when it will. */
  readonly contactProblem = computed<'contactRequired' | 'contactInvalid' | null>(() => {
    const value = this.contact().trim();
    if (!value) return this.signedIn() ? null : 'contactRequired';
    return normalizeContact(value) ? null : 'contactInvalid';
  });

  send(): void {
    this.touched.set(true);
    if (this.sending() || this.message().trim().length === 0 || this.contactProblem()) return;
    this.sending.set(true);
    this.error.set(null);
    const name = this.name().trim();
    const contact = this.contact().trim();
    const website = this.website();
    this.api
      .sendSupport({
        kind: this.topic(),
        message: this.message().trim(),
        ...(name && !this.signedIn() ? { name } : {}),
        ...(contact ? { contact } : {}),
        ...(website ? { website } : {}),
      })
      .subscribe({
        next: () => {
          this.sending.set(false);
          this.sent.set(true);
        },
        // What they typed stays in the form for another try.
        error: (err: unknown) => {
          this.sending.set(false);
          this.error.set(this.describe(err));
        },
      });
  }

  another(): void {
    this.message.set('');
    this.touched.set(false);
    this.sent.set(false);
  }

  private describe(err: unknown): string {
    const failure = err as { status?: unknown; error?: { code?: unknown } } | null;
    const code = failure?.error?.code;
    const key =
      code === 'SUPPORT_CONTACT_REQUIRED'
        ? 'web.support.contactRequired'
        : code === 'SUPPORT_CONTACT_INVALID'
          ? 'web.support.contactInvalid'
          : failure?.status === 429
            ? 'web.support.tooMany'
            : failure?.status === 0
              ? 'common.networkError'
              : 'common.genericError';
    return this.translate.instant(key);
  }
}
