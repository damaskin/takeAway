import { Component, OnDestroy, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { checkoutErrorText, LocaleFormatService } from '@takeaway/i18n';
import type { AgroprombankQrPaymentDto } from '@takeaway/shared-types';
import { QrCodeComponent } from '@takeaway/ui-kit';
import { QR_PAYMENT_POLL_MS, formatCountdown, qrPaymentWorthPolling, qrTimeLeftMs } from '@takeaway/utils';
import { type Subscription, interval } from 'rxjs';

import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { OrdersApi } from '../../core/orders/orders.service';
import { type BoundCard, PaymentCardsApi, PaymentCardsStore } from '../../core/payments/payment-cards.service';
import { QrPaymentApi } from '../../core/payments/qr-payment.service';
import { WebPaymentApi } from '../../core/payments/web-payment.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

/** What the screen shows: the code to pay, a lapsed invoice, or a failure to get one. */
type QrView = 'loading' | 'pending' | 'expired' | 'failed';

/** Errors no retry will fix: the QR payment is off, or not for this store. */
const FINAL_ERRORS: readonly string[] = ['QR_PAYMENT_DISABLED', 'QR_CURRENCY_UNSUPPORTED'];

/**
 * Paying an order by QR in Agroprombank's app (docs/agroprombank-payments.md
 * §12), in the Mini App: a button that opens the bank's app through
 * Telegram when the API gives a link, the code itself for another device,
 * and a countdown to the end of the invoice. The screen asks every few
 * seconds whether the money landed — straight away when the customer comes
 * back from the bank's app — and opens the order once it has.
 *
 * Leaving the screen never calls the invoice off: the customer leaves for
 * the bank's app and comes back. Only «Отменить» does.
 */
@Component({
  selector: 'app-tma-qr-payment',
  standalone: true,
  imports: [TranslatePipe, QrCodeComponent],
  host: {
    '(document:visibilitychange)': 'onAppVisible()',
    '(window:focus)': 'onAppVisible()',
  },
  template: `
    <section
      style="padding: 24px 16px; padding-bottom: calc(32px + var(--tma-safe-bottom)); display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center"
    >
      <h1
        style="font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'common.qrPayment.title' | translate }}
      </h1>
      @if (orderLine(); as line) {
        <p
          data-testid="qr-order"
          style="margin: -8px 0 0; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)"
        >
          {{ 'common.qrPayment.orderLine' | translate: line }}
        </p>
      }

      @switch (view()) {
        @case ('loading') {
          <p
            data-testid="qr-loading"
            style="margin: 0; font-family: var(--font-sans); color: var(--color-text-secondary)"
          >
            {{ 'common.qrPayment.loading' | translate }}
          </p>
        }
        @case ('pending') {
          @if (payment()?.qr; as qr) {
            <span
              data-testid="qr-amount"
              style="font-family: var(--font-sans); font-size: 28px; font-weight: 700; color: var(--color-espresso)"
              >{{ amount() }}</span
            >
            @if (qr.appLink) {
              <button
                type="button"
                data-testid="qr-open-bank"
                (click)="openBankApp(qr.appLink)"
                class="w-full"
                style="height: 52px; background: var(--color-caramel); color: var(--color-foam); border-radius: 14px; font-family: var(--font-sans); font-size: 16px; font-weight: 600"
              >
                {{ 'common.qrPayment.openBankApp' | translate }}
              </button>
            }
            <lib-qr-code
              data-testid="qr-code"
              [text]="qr.code"
              [label]="'common.qrPayment.codeLabel' | translate"
              style="width: min(240px, 100%); padding: 10px; border-radius: 16px; border: 1px solid var(--color-border-light)"
            />
            <span
              data-testid="qr-countdown"
              style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
              >{{ 'common.qrPayment.expiresIn' | translate: { time: countdown() } }}</span
            >
            <p
              data-testid="qr-hint"
              style="margin: 0; font-family: var(--font-sans); font-size: 14px; line-height: 1.45; color: var(--color-text-primary)"
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
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
              'common.qrPayment.waiting' | translate
            }}</span>
            <button
              type="button"
              data-testid="qr-cancel"
              (click)="cancel()"
              [disabled]="busy()"
              class="disabled:opacity-50"
              style="height: 44px; padding: 0 20px; background: transparent; border: 1px solid var(--color-border-light); border-radius: 12px; font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-secondary)"
            >
              {{ (busy() ? 'common.qrPayment.cancelling' : 'common.qrPayment.cancel') | translate }}
            </button>
          }
        }
        @case ('expired') {
          <div data-testid="qr-expired" class="flex flex-col items-center" style="gap: 6px">
            <span style="font-size: 40px" aria-hidden="true">⌛</span>
            <h2
              style="margin: 0; font-family: var(--font-sans); font-size: 18px; font-weight: 700; color: var(--color-espresso)"
            >
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
            style="height: 52px; background: var(--color-caramel); color: var(--color-foam); border-radius: 14px; font-family: var(--font-sans); font-size: 16px; font-weight: 600"
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
              style="height: 48px; background: var(--color-foam); color: var(--color-text-primary); border: 1px solid var(--color-border-light); border-radius: 14px; font-family: var(--font-sans); font-size: 15px; font-weight: 600"
            >
              {{ 'common.qrPayment.payByCard' | translate }}{{ cardMask() ? ' · ' + cardMask() : '' }}
            </button>
          }
        }
        @case ('failed') {
          <div data-testid="qr-failed" class="flex flex-col items-center" style="gap: 6px">
            <span style="font-size: 40px" aria-hidden="true">⚠️</span>
            <h2
              style="margin: 0; font-family: var(--font-sans); font-size: 18px; font-weight: 700; color: var(--color-espresso)"
            >
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
              style="height: 52px; background: var(--color-caramel); color: var(--color-foam); border-radius: 14px; font-family: var(--font-sans); font-size: 16px; font-weight: 600"
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
              style="height: 48px; background: var(--color-foam); color: var(--color-text-primary); border: 1px solid var(--color-border-light); border-radius: 14px; font-family: var(--font-sans); font-size: 15px; font-weight: 600"
            >
              {{ 'common.qrPayment.payByCard' | translate }}{{ cardMask() ? ' · ' + cardMask() : '' }}
            </button>
          }
        }
      }

      @if (actionError()) {
        <p
          data-testid="qr-action-error"
          style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)"
        >
          {{ actionError() }}
        </p>
      }

      <button
        type="button"
        data-testid="qr-to-order"
        (click)="openOrder()"
        style="font-family: var(--font-sans); font-size: 14px; color: var(--color-caramel)"
      >
        {{ 'common.qrPayment.toOrder' | translate }}
      </button>
    </section>
  `,
})
export class TmaQrPaymentPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly qrPayments = inject(QrPaymentApi);
  private readonly orders = inject(OrdersApi);
  private readonly flags = inject(FeatureFlagsStore);
  private readonly webPayments = inject(WebPaymentApi);
  private readonly cardsApi = inject(PaymentCardsApi);
  private readonly cardsStore = inject(PaymentCardsStore);
  private readonly tg = inject(TelegramBridgeService);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);

  readonly orderId = this.route.snapshot.paramMap.get('id') ?? '';
  /** No link into the bank's app and a phone in hand: the code has to be scanned from another device. */
  readonly onPhone = this.tg.onPhone;

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
  private detachBack: (() => void) | null = null;
  private lastVisibleAt = 0;

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
        // PAID or REFUNDED: on the way to the order screen.
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
    this.detachBack = this.tg.setBackButton(() => this.openOrder());
    this.orders.get(this.orderId).subscribe({
      next: (order) => this.orderCode.set(order.orderCode),
      error: () => undefined,
    });
    // Straight from checkout the invoice is already in hand; the order
    // screen asks for it again, which answers the same one.
    const issued = this.qrPayments.issued(this.orderId);
    if (issued) this.apply(issued);
    else this.start();
  }

  ngOnDestroy(): void {
    this.tickSub?.unsubscribe();
    this.requestSub?.unsubscribe();
    this.detachBack?.();
    this.stopPolling();
  }

  /** Telegram opens outside links only straight from a tap, so the link is in hand before it. */
  openBankApp(link: string): void {
    this.tg.haptic('light');
    this.tg.openLink(link);
  }

  /** «Новый QR-код» and «Попробовать снова»: the same start, which closes a lapsed invoice first. */
  restart(): void {
    if (this.busy()) return;
    this.tg.haptic('light');
    this.actionError.set(null);
    this.start();
  }

  /** The customer calls the invoice off; the order stays, to be paid again or by card. */
  cancel(): void {
    const p = this.payment();
    if (!p || this.busy()) return;
    this.tg.haptic('light');
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
    this.tg.haptic('light');
    this.busy.set(true);
    this.actionError.set(null);
    const failed = (err: unknown) => {
      this.busy.set(false);
      this.actionError.set(this.errorText(err));
    };
    if (option === 'web') {
      // The bank's page opens in the browser; the order screen follows the payment.
      this.webPayments.start(this.orderId).subscribe({
        next: (res) => {
          this.busy.set(false);
          if (res.page) this.tg.openLink(res.page.url);
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
   * Back from the bank's app: ask at once rather than at the next tick
   * (`focus` and `visibilitychange` usually arrive together). Hidden: stop
   * asking — nothing is shown meanwhile.
   */
  onAppVisible(): void {
    if (this.hidden()) {
      this.stopPolling();
      return;
    }
    if (Date.now() - this.lastVisibleAt < 1_000) return;
    this.lastVisibleAt = Date.now();
    this.pollNow();
  }

  openOrder(): void {
    this.stopPolling();
    void this.router.navigate(['/orders', this.orderId], { replaceUrl: true });
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
        // Already paid, cancelled or expired: the order screen tells which.
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
      if (payment.status === 'PAID') this.tg.haptic('medium');
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

  private errorText(err: unknown): string {
    const body = (err as { error?: unknown } | null)?.error;
    const coded = checkoutErrorText(body, this.translate, this.fmt);
    if (coded) return coded;
    if ((err as { status?: unknown } | null)?.status === 0) return this.translate.instant('common.networkError');
    const raw = (body as { message?: unknown } | null)?.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw;
    return typeof message === 'string' && message ? message : this.translate.instant('common.requestFailed');
  }
}

function errorCode(err: unknown): string | null {
  const code = ((err as { error?: unknown } | null)?.error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}
