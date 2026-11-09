import { Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ORDER_REVIEW_COMMENT_MAX_LENGTH, ORDER_REVIEW_RATINGS, OrderReviewError } from '@takeaway/shared-types';

import { OrdersApi, type OrderView } from '../../core/orders/orders.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

/**
 * «Как вам заказ?» on the Mini App's order screen once the order is handed
 * over: five stars, an optional comment and «Отправить»; then «Спасибо за
 * отзыв!» with the stars. Nothing before the handover, for a cancelled or
 * expired order, or from an API without reviews. Only the takeAway team
 * reads reviews; the brand does not see them.
 *
 * Emits the order as the API answers it, `review` set, for the screen to show.
 */
@Component({
  selector: 'app-tma-order-review-card',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (review(); as r) {
      <div
        role="status"
        data-testid="order-review"
        class="w-full flex flex-col items-center"
        style="gap: 8px; padding: 16px; border-radius: 14px; background: var(--color-foam); border: 1px solid var(--color-border-light)"
      >
        <span
          data-testid="order-review-thanks"
          style="font-family: var(--font-sans); font-size: 16px; font-weight: 700; color: var(--color-text-primary)"
          >{{ 'common.orderReview.thanks' | translate }}</span
        >
        <span
          role="img"
          data-testid="order-review-given"
          class="flex"
          style="gap: 4px; font-size: 22px; line-height: 1"
          [attr.aria-label]="'common.orderReview.given' | translate: { n: r.rating }"
        >
          @for (star of stars; track star) {
            <span
              aria-hidden="true"
              [style.color]="star <= r.rating ? 'var(--color-caramel)' : 'var(--color-border-light)'"
              >★</span
            >
          }
        </span>
        @if (r.comment) {
          <p
            data-testid="order-review-comment-given"
            style="margin: 0; font-family: var(--font-sans); font-size: 13px; line-height: 1.4; color: var(--color-text-secondary); font-style: italic; text-align: center; white-space: pre-wrap; overflow-wrap: anywhere"
          >
            “{{ r.comment }}”
          </p>
        }
      </div>
    } @else if (canAsk()) {
      <form
        data-testid="order-review"
        class="w-full flex flex-col items-center"
        style="gap: 10px; padding: 16px; border-radius: 14px; background: var(--color-foam); border: 1px solid var(--color-border-light)"
        (submit)="$event.preventDefault(); send()"
      >
        <span
          style="font-family: var(--font-sans); font-size: 16px; font-weight: 700; color: var(--color-text-primary)"
          >{{ 'common.orderReview.title' | translate }}</span
        >
        <span
          style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary); text-align: center"
          >{{ 'common.orderReview.hint' | translate }}</span
        >
        <div role="group" class="flex" style="gap: 2px" [attr.aria-label]="'common.orderReview.stars' | translate">
          @for (star of stars; track star) {
            <button
              type="button"
              class="flex items-center justify-center"
              [attr.data-testid]="'order-review-star-' + star"
              [attr.aria-label]="'common.orderReview.star' | translate: { n: star }"
              [attr.aria-pressed]="rating() === star"
              [disabled]="sending()"
              (click)="pick(star)"
              [style.color]="star <= rating() ? 'var(--color-caramel)' : 'var(--color-border-light)'"
              style="width: 44px; height: 44px; background: transparent; font-size: 30px; line-height: 1"
            >
              ★
            </button>
          }
        </div>
        <label class="w-full flex flex-col">
          <span class="sr-only">{{ 'common.orderReview.commentLabel' | translate }}</span>
          <textarea
            data-testid="order-review-comment"
            rows="3"
            [attr.maxlength]="maxLength"
            [value]="comment()"
            [placeholder]="'common.orderReview.commentPlaceholder' | translate"
            [disabled]="sending()"
            (input)="comment.set($any($event.target).value)"
            style="width: 100%; resize: none; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--color-border-light); background: var(--color-cream); font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
          ></textarea>
        </label>
        <button
          type="submit"
          data-testid="order-review-send"
          class="w-full flex items-center justify-center disabled:opacity-50"
          [disabled]="!rating() || sending()"
          style="background: var(--color-caramel); color: var(--color-foam); height: 48px; border-radius: 14px; font-family: var(--font-sans); font-size: 15px; font-weight: 600"
        >
          {{ (sending() ? 'common.orderReview.sending' : 'common.orderReview.send') | translate }}
        </button>
        @if (error(); as message) {
          <p
            role="alert"
            data-testid="order-review-error"
            style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); text-align: center"
          >
            {{ message }}
          </p>
        }
      </form>
    }
  `,
})
export class TmaOrderReviewCardComponent {
  private readonly orders = inject(OrdersApi);
  private readonly translate = inject(TranslateService);
  private readonly tg = inject(TelegramBridgeService);

  readonly order = input.required<OrderView>();
  /** The order as it reads after the review: `review` set, or the re-read when the API refused it. */
  readonly reviewed = output<OrderView>();

  readonly stars = ORDER_REVIEW_RATINGS;
  readonly maxLength = ORDER_REVIEW_COMMENT_MAX_LENGTH;

  readonly review = computed(() => this.order().review ?? null);
  /** Only on the API's word: an API without reviews never sends `canReview`. */
  readonly canAsk = computed(() => !this.review() && this.order().canReview === true);

  readonly rating = signal(0);
  readonly comment = signal('');
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);

  pick(star: number): void {
    this.tg.haptic('light');
    this.rating.set(star);
    this.error.set(null);
  }

  /**
   * Sends the stars and the comment. When the API says the order already has
   * a review (sent from another device) or cannot have one, the re-read
   * order is the answer; any other failure keeps the form for another try.
   */
  send(): void {
    const rating = this.rating();
    if (!rating || this.sending()) return;
    const id = this.order().id;
    const comment = this.comment().trim();
    this.sending.set(true);
    this.error.set(null);
    this.orders.review(id, comment ? { rating, comment } : { rating }).subscribe({
      next: (order) => {
        this.sending.set(false);
        this.tg.haptic('medium');
        this.reviewed.emit(order);
      },
      error: (err: unknown) => {
        const failure = err as { status?: unknown; error?: { code?: unknown } | null } | null;
        const code = failure?.error?.code;
        if (code === OrderReviewError.ALREADY_REVIEWED || code === OrderReviewError.NOT_REVIEWABLE) {
          this.orders.get(id).subscribe({
            next: (order) => {
              this.sending.set(false);
              this.reviewed.emit(order);
            },
            error: () => this.fail('common.orderReview.failed'),
          });
          return;
        }
        this.fail(failure?.status === 0 ? 'common.networkError' : 'common.orderReview.failed');
      },
    });
  }

  private fail(key: string): void {
    this.sending.set(false);
    this.error.set(this.translate.instant(key));
  }
}
