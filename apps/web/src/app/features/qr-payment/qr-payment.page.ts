import { Component, OnDestroy, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { checkoutErrorText, LocaleFormatService } from '@takeaway/i18n';
import type { AgroprombankQrPaymentDto } from '@takeaway/shared-types';
import { QrCodeComponent } from '@takeaway/ui-kit';
import {
  QR_PAYMENT_POLL_MS,
  formatCountdown,
  looksLikePhone,
  qrPaymentWorthPolling,
  qrTimeLeftMs,
} from '@takeaway/utils';
import { type Subscription, interval } from 'rxjs';

import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { OrdersApi } from '../../core/orders/orders.service';
import { type BoundCard, PaymentCardsApi, PaymentCardsStore } from '../../core/payments/payment-cards.service';
import { QrPaymentApi } from '../../core/payments/qr-payment.service';
import { WebPaymentApi } from '../../core/payments/web-payment.service';

/** What the screen shows: the code to pay, a lapsed invoice, or a failure to get one. */
type QrView = 'loading' | 'pending' | 'expired' | 'failed';

/** Errors no retry will fix: the QR payment is off, or not for this store. */
const FINAL_ERRORS: readonly string[] = ['QR_PAYMENT_DISABLED', 'QR_CURRENCY_UNSUPPORTED'];

/**
 * Paying an order by QR in Agroprombank's app (docs/agroprombank-payments.md
 * §12): the code to scan, a link into the bank's app when the phone can
 * follow one, and a countdown to the end of the invoice. The screen asks
 * every few seconds whether the money landed — straight away when the
 * customer comes back from the bank's app — and opens the order once it has.
 *
 * Leaving the screen never calls the invoice off: the customer leaves for
 * the bank's app and comes back. Only «Отменить» does.
 */
@Component({
  selector: 'app-qr-payment',
  standalone: true,
  imports: [RouterLink, TranslatePipe, QrCodeComponent],
  host: {
    '(document:visibilitychange)': 'onVisibilityChange()',
    '(window:pageshow)': 'onPageShow($event)',
  },
  template: `
    <section class="max-w-md mx-auto px-6 py-10 flex flex-col items-center text-center" style="gap: var(--spacing-lg)">
      <h1 style="font-family: var(--font-display); font-size: 32px; font-weight: 600; color: var(--color-espresso)">
        {{ 'common.qrPayment.title' | translate }}
      </h1>
      @if (orderLine(); as line) {
        <p
          data-testid="qr-order"
          style="margin: -8px 0 0; font-family: var(--font-sans); font-size: 15px; color: var(--color-text-secondary)"
        >
          {{ 'common.qrPayment.orderLine' | translate: line }}
        </p>
      }

      @switch (view()) {
        @case ('loading') {
          <p data-testid="qr-loading" style="font-family: var(--font-sans); color: var(--color-text-secondary)">
            {{ 'common.qrPayment.loading' | translate }}
          </p>
        }
        @case ('pending') {
          @if (payment()?.qr; as qr) {
            <lib-qr-code
              data-testid="qr-code"
              [text]="qr.code"
              [label]="'common.qrPayment.codeLabel' | translate"
              style="width: min(280px, 100%); padding: 12px; border-radius: 20px; border: 1px solid var(--color-border-light)"
            />
            <span
              data-testid="qr-amount"
              style="font-family: var(--font-sans); font-size: 28px; font-weight: 700; color: var(--color-espresso)"
              >{{ amount() }}</span
            >
            <span
              data-testid="qr-countdown"
              style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)"
              >{{ 'common.qrPayment.expiresIn' | translate: { time: countdown() } }}</span
            >
            @if (qr.appLink) {
              <a
                data-testid="qr-open-bank"
                [href]="qr.appLink"
                class="w-full flex items-center justify-center"
                style="height: 52px; background: var(--color-caramel); color: var(--color-foam); border-radius: 16px; font-family: var(--font-sans); font-size: 16px; font-weight: 600; text-decoration: none"
                >{{ 'common.qrPayment.openBankApp' | translate }}</a
              >
            }
            <p
              data-testid="qr-hint"
              style="margin: 0; font-family: var(--font-sans); font-size: 14px; line-height: 1.45; color: var(--color-espresso)"
            >
              {{ 'common.qrPayment.scanHint' | translate }}
            </p>
            @if (!qr.appLink && onPhone) {
              <p
                data-testid="qr-other-device"
                style="margin: 0; font-family: var(--font-sans); font-size: 13px; line-height: 1.45; color: var(--color-text-secondary)"
              >
                {{ 'common.qrPayment.otherDeviceHint' | translate }}
              </p>
            }
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)">{{
              'common.qrPayment.waiting' | translate
            }}</span>
            <button
              type="button"
              data-testid="qr-cancel"
              (click)="cancel()"
              [disabled]="busy()"
              class="disabled:opacity-50"
              style="height: 44px; padding: 0 20px; background: transparent; border: 1px solid var(--color-border); border-radius: 12px; font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-secondary)"
            >
              {{ (busy() ? 'common.qrPayment.cancelling' : 'common.qrPayment.cancel') | translate }}
            </button>
          }
        }
        @case ('expired') {
          <div data-testid="qr-expired" class="flex flex-col items-center" style="gap: 6px">
            <span style="font-size: 40px" aria-hidden="true">⌛</span>
            <h2 style="font-family: var(--font-sans); font-size: 20px; font-weight: 700; color: var(--color-espresso)">
              {{ 'common.qrPayment.expiredTitle' | translate }}
            </h2>
            <p style="margin: 0; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)">
              {{ 'common.qrPayment.expiredHint' | translate }}
            </p>
          </div>
          <button
            type="button"
            data-testid="qr-new-code"
            (click)="restart()"
            [disabled]="busy()"
            class="w-full disabled:opacity-50"
            style="height: 52px; background: var(--color-caramel); color: var(--color-foam); border-radius: 16px; font-family: var(--font-sans); font-size: 16px; font-weight: 600"
          >
            {{ (busy() ? 'common.loading' : 'common.qrPayment.newCode') | translate }}
          </button>
          @if (cardOption()) {
            <button
              type="button"
              data-testid="qr-pay-card"
              (click)="payByCard()"
              [disabled]="busy()"
              class="w-full disabled:opacity-50"
              style="height: 48px; background: var(--color-cream); color: var(--color-espresso); border: 1px solid var(--color-border); border-radius: 16px; font-family: var(--font-sans); font-size: 15px; font-weight: 600"
            >
              {{ 'common.qrPayment.payByCard' | translate }}{{ cardMask() ? ' · ' + cardMask() : '' }}
            </button>
          }
        }
        @case ('failed') {
          <div data-testid="qr-failed" class="flex flex-col items-center" style="gap: 6px">
            <span style="font-size: 40px" aria-hidden="true">⚠️</span>
            <h2 style="font-family: var(--font-sans); font-size: 20px; font-weight: 700; color: var(--color-espresso)">
              {{ 'common.qrPayment.failedTitle' | translate }}
            </h2>
            <p style="margin: 0; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)">
              {{ error() ?? ('common.qrPayment.failedHint' | translate) }}
            </p>
          </div>
          @if (canRetry()) {
            <button
              type="button"
              data-testid="qr-retry"
              (click)="restart()"
              [disabled]="busy()"
              class="w-full disabled:opacity-50"
              style="height: 52px; background: var(--color-caramel); color: var(--color-foam); border-radius: 16px; font-family: var(--font-sans); font-size: 16px; font-weight: 600"
            >
              {{ (busy() ? 'common.loading' : 'common.qrPayment.retry') | translate }}
            </button>
          }
          @if (cardOption()) {
            <button
              type="button"
              data-testid="qr-pay-card"
              (click)="payByCard()"
              [disabled]="busy()"
              class="w-full disabled:opacity-50"
              style="height: 48px; background: var(--color-cream); color: var(--color-espresso); border: 1px solid var(--color-border); border-radius: 16px; font-family: var(--font-sans); font-size: 15px; font-weight: 600"
            >
              {{ 'common.qrPayment.payByCard' | translate }}{{ cardMask() ? ' · ' + cardMask() : '' }}
            </button>
          }
        }
      }

      @if (actionError()) {
        <p data-testid="qr-action-error" class="text-sm" style="margin: 0; color: var(--color-berry)">
          {{ actionError() }}
        </p>
      }

      <a
        data-testid="qr-to-order"
        [routerLink]="['/orders', orderId]"
        style="font-family: var(--font-sans); font-size: 14px; color: var(--color-caramel)"
        >{{ 'common.qrPayment.toOrder' | translate }}</a
      >
    </section>
  `,
})
export class QrPaymentPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly qrPayments = inject(QrPaymentApi);
  private readonly orders = inject(OrdersApi);
  private readonly flags = inject(FeatureFlagsStore);
  private readonly webPayments = inject(WebPaymentApi);
  private readonly cardsApi = inject(PaymentCardsApi);
  private readonly cardsStore = inject(PaymentCardsStore);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);

  readonly orderId = this.route.snapshot.paramMap.get('id') ?? '';
  /** No link into the bank's app and a phone in hand: the code has to be scanned from another device. */
  readonly onPhone = typeof navigator !== 'undefined' && looksLikePhone(navigator.userAgent);

  readonly payment = signal<AgroprombankQrPaymentDto | null>(null);
  /** Why there is no invoice to show; null while there is one. */
  readonly error = signal<string | null>(null);
  private readonly errorCode = signal<string | null>(null);
  /** A cancel or a card payment that did not go through; the screen stays as it was. */
  readonly actionError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly now = signal(Date.now());
  private readonly orderCode = signal<string | null>(null);
  private readonly defaultCard = signal<BoundCard | null>(null);

  private tickSub: Subscription | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollSub: Subscription | null = null;
  private requestSub: Subscription | null = null;

  readonly timeLeftMs = computed(() => qrTimeLeftMs(this.payment()?.qr?.expiresAt, this.now()));
  readonly countdown = computed(() => formatCountdown(this.timeLeftMs()));
  readonly amount = computed(() => {
    const p = this.payment();
    return p ? this.fmt.money(p.amountCents, p.currency) : '';
  });

  /** «Заказ 4832 · 45,00 руб.», once both are known. */
  readonly orderLine = computed(() => {
    const code = this.orderCode();
    return code && this.payment() ? { code, amount: this.amount() } : null;
  });

  readonly view = computed<QrView>(() => {
    if (this.error()) return 'failed';
    const p = this.payment();
    if (!p) return 'loading';
    switch (p.status) {
      case 'PENDING':
        if (!p.qr) return 'loading';
        return this.timeLeftMs() > 0 ? 'pending' : 'expired';
      case 'EXPIRED':
        return 'expired';
      case 'FAILED':
        return 'failed';
      default:
        // PAID or REFUNDED: on the way to the order page.
        return 'loading';
    }
  });

  /** A new attempt may help: the bank was down, or did not issue the invoice. */
  readonly canRetry = computed(() => !FINAL_ERRORS.includes(this.errorCode() ?? ''));

  /**
   * Paying by card instead: on the bank's own page, or with the default
   * bound card — whichever card flow the deployment runs.
   */
  readonly cardOption = computed<'web' | 'token' | null>(() => {
    if (this.flags.webPaymentsEnabled()) return 'web';
    if (this.flags.boundCardsEnabled() && this.defaultCard()) return 'token';
    return null;
  });

  readonly cardMask = computed(() => (this.cardOption() === 'token' ? (this.defaultCard()?.maskedPan ?? '') : ''));

  /** `/config/features` answers after init; the bound cards are read once they turn out to be on. */
  private readonly loadCards = effect(() => {
    if (!this.flags.boundCardsEnabled()) return;
    untracked(() =>
      this.cardsStore.load().subscribe({
        next: (cards) => this.defaultCard.set(cards.find((c) => c.isDefault) ?? cards[0] ?? null),
        error: () => this.defaultCard.set(null),
      }),
    );
  });

  ngOnInit(): void {
    this.flags.load();
    this.tickSub = interval(1000).subscribe(() => this.now.set(Date.now()));
    this.orders.get(this.orderId).subscribe({
      next: (order) => this.orderCode.set(order.orderCode),
      error: () => undefined,
    });
    // Straight from checkout the invoice is already in hand; a reload or the
    // order page asks for it again, which answers the same one.
    const issued = this.qrPayments.issued(this.orderId);
    if (issued) this.apply(issued);
    else this.start();
  }

  ngOnDestroy(): void {
    this.tickSub?.unsubscribe();
    this.requestSub?.unsubscribe();
    this.stopPolling();
  }

  /** «Новый QR-код» and «Попробовать снова»: the same start, which closes a lapsed invoice first. */
  restart(): void {
    if (this.busy()) return;
    this.actionError.set(null);
    this.start();
  }

  /** The customer calls the invoice off; the order stays, to be paid again or by card. */
  cancel(): void {
    const p = this.payment();
    if (!p || this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.stopPolling();
    this.requestSub?.unsubscribe();
    this.requestSub = this.qrPayments.cancel(p.paymentId).subscribe({
      next: () => {
        this.busy.set(false);
        this.openOrder();
      },
      error: (err) => {
        this.busy.set(false);
        this.actionError.set(this.errorText(err));
        this.schedulePoll();
      },
    });
  }

  payByCard(): void {
    const option = this.cardOption();
    if (!option || this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    const failed = (err: unknown) => {
      this.busy.set(false);
      this.actionError.set(this.errorText(err));
    };
    if (option === 'web') {
      this.webPayments.start(this.orderId).subscribe({
        next: (res) => {
          if (res.page) {
            // `busy` stays on: the browser is on its way to the bank.
            this.webPayments.redirectToBank(res.page);
            return;
          }
          this.busy.set(false);
          this.openOrder();
        },
        error: failed,
      });
      return;
    }
    const card = this.defaultCard();
    if (!card) return;
    this.cardsApi.pay({ orderId: this.orderId, cardId: card.id }).subscribe({
      next: () => {
        this.busy.set(false);
        this.openOrder();
      },
      error: failed,
    });
  }

  /**
   * Back from the bank's app (or another tab): ask at once rather than at
   * the next tick. Hidden: stop asking — nothing is shown meanwhile.
   */
  onVisibilityChange(): void {
    if (this.hidden()) {
      this.stopPolling();
      return;
    }
    this.pollNow();
  }

  /**
   * Back from the bank's card page with the browser's Back button: the page
   * may come from the back-forward cache with its buttons still spinning.
   */
  onPageShow(event: PageTransitionEvent): void {
    if (event.persisted) this.busy.set(false);
    this.onVisibilityChange();
  }

  private start(): void {
    this.busy.set(true);
    this.error.set(null);
    this.errorCode.set(null);
    this.stopPolling();
    this.requestSub?.unsubscribe();
    this.requestSub = this.qrPayments.start(this.orderId).subscribe({
      next: (payment) => {
        this.busy.set(false);
        this.apply(payment);
      },
      error: (err) => {
        this.busy.set(false);
        const code = errorCode(err);
        // Already paid, cancelled or expired: the order page tells which.
        if (code === 'ORDER_NOT_PAYABLE') {
          this.openOrder();
          return;
        }
        this.errorCode.set(code);
        this.error.set(this.errorText(err));
      },
    });
  }

  private apply(payment: AgroprombankQrPaymentDto): void {
    this.payment.set(payment);
    if (payment.status === 'PAID' || payment.status === 'REFUNDED') {
      this.openOrder();
      return;
    }
    this.schedulePoll();
  }

  private schedulePoll(): void {
    this.stopPolling();
    const p = this.payment();
    if (!p || this.hidden() || !qrPaymentWorthPolling(p, Date.now())) return;
    this.pollTimer = setTimeout(() => this.pollNow(), QR_PAYMENT_POLL_MS);
  }

  private pollNow(): void {
    const p = this.payment();
    if (!p || this.busy() || !qrPaymentWorthPolling(p, Date.now())) return;
    this.stopPolling();
    this.pollSub = this.qrPayments.status(p.paymentId).subscribe({
      next: (fresh) => this.apply(fresh),
      // A blip: the next tick asks again.
      error: () => this.schedulePoll(),
    });
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.pollSub?.unsubscribe();
    this.pollSub = null;
  }

  private hidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  private openOrder(): void {
    this.stopPolling();
    void this.router.navigate(['/orders', this.orderId], { replaceUrl: true });
  }

  private errorText(err: unknown): string {
    const body = (err as { error?: unknown } | null)?.error;
    const coded = checkoutErrorText(body, this.translate, this.fmt);
    if (coded) return coded;
    if ((err as { status?: unknown } | null)?.status === 0) return this.translate.instant('common.networkError');
    const message = (body as { message?: unknown } | null)?.message;
    return typeof message === 'string' && message ? message : this.translate.instant('common.requestFailed');
  }
}

function errorCode(err: unknown): string | null {
  const code = ((err as { error?: unknown } | null)?.error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}
