import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LeafletMapComponent, type LatLng, type MapMarker } from '@takeaway/ui-kit';
import { buildDirectionsUrl, describeOrderItemOptions, readOrderItemSnapshot } from '@takeaway/utils';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { interval, take, timer, type Subscription } from 'rxjs';
import { LocaleFormatService } from '@takeaway/i18n';

import { AuthStore } from '../../core/auth/auth.store';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import {
  OrdersApi,
  type OrderPaymentState,
  type OrderStatusString,
  type OrderView,
} from '../../core/orders/orders.service';
import { WebPaymentApi } from '../../core/payments/web-payment.service';
import { RealtimeService } from '../../core/realtime/realtime.service';

interface StatusStep {
  key: OrderStatusString;
  /** Translation key — resolved in the template. */
  label: string;
  icon: string;
}

const STEPS: StatusStep[] = [
  { key: 'PAID', label: 'web.orderStatus.step.paid', icon: '✓' },
  { key: 'IN_PROGRESS', label: 'web.orderStatus.step.preparing', icon: '⏱' },
  { key: 'READY', label: 'web.orderStatus.step.ready', icon: '🛎' },
  { key: 'PICKED_UP', label: 'web.orderStatus.step.pickedUp', icon: '🏁' },
];

const STEP_ORDER: OrderStatusString[] = ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'PICKED_UP'];

/** What the bank said when it sent the customer back (`?payment=…`). */
type PaymentReturn = 'success' | 'pending' | 'fail';

/** Payment states where the order still waits for its money. */
const UNSETTLED: readonly OrderPaymentState[] = ['NONE', 'PENDING', 'FAILED'];

/** How often, and how many times, to re-read an order whose payment is still being confirmed. */
const PAYMENT_POLL_MS = 3_000;
const PAYMENT_POLL_TIMES = 10;

function readPaymentReturn(value: string | null): PaymentReturn | null {
  return value === 'success' || value === 'pending' || value === 'fail' ? value : null;
}

@Component({
  selector: 'app-order-status',
  standalone: true,
  imports: [RouterLink, TranslatePipe, LeafletMapComponent],
  host: { '(window:pageshow)': 'onPageShow($event)' },
  template: `
    @if (order(); as o) {
      <section class="max-w-3xl mx-auto px-6 py-10 flex flex-col items-center" style="gap: var(--spacing-lg)">
        <!-- Greeting -->
        <header class="text-center" style="margin-top: var(--spacing-sm)">
          <h1 class="text-4xl" style="font-family: var(--font-display); color: var(--color-espresso); font-weight: 600">
            {{
              firstName()
                ? ('web.orderStatus.greeting' | translate: { name: firstName() })
                : ('web.orderStatus.greetingNoName' | translate)
            }}
          </h1>
          <p class="mt-2" style="font-family: var(--font-sans); font-size: 20px; color: var(--color-caramel)">
            {{ heroSubtitle() | translate }}
          </p>
        </header>

        <!-- Where the money stands. The first thing a customer wants after
             tapping pay is confirmation that it worked; the order's own
             progress comes after that. -->
        <article
          class="w-full flex items-center"
          [style.background]="paymentBackground()"
          style="border-radius: 16px; padding: 14px 18px; gap: 12px"
        >
          <span style="font-size: 22px">{{ paymentIcon() }}</span>
          <div class="flex flex-col" style="gap: 2px; min-width: 0">
            <span
              style="font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--color-espresso)"
            >
              {{ paymentTitle() | translate }}
            </span>
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
              {{ paymentDetail() }}
            </span>
            @if (paymentHint()) {
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">
                {{ paymentHint() | translate }}
              </span>
            }
          </div>
        </article>

        @if (canRetryPayment()) {
          <button
            type="button"
            data-testid="retry-payment"
            (click)="retryPayment()"
            [disabled]="retrying()"
            class="w-full flex items-center justify-center disabled:opacity-50"
            style="
              background: var(--color-caramel);
              color: var(--color-foam);
              height: 52px;
              border-radius: 16px;
              font-family: var(--font-sans); font-size: 16px; font-weight: 600;
            "
          >
            {{ (retrying() ? 'common.loading' : 'web.orderStatus.payment.retry') | translate }}
          </button>
        }
        @if (paymentError()) {
          <p class="text-sm text-center" style="margin: 0; color: var(--color-berry)">{{ paymentError() }}</p>
        }

        <!-- Timer Ring (300×300 circle, caramel-light fill) -->
        <div
          class="flex items-center justify-center rounded-full transition-colors"
          [style.background]="ringBackground()"
          [style.color]="ringTextColor()"
          style="width: 300px; height: 300px; margin-top: var(--spacing-base)"
        >
          @if (o.status === 'READY') {
            <span style="font-family: var(--font-display); font-size: 48px; font-weight: 700">{{
              'web.orderStatus.ready' | translate
            }}</span>
          } @else if (o.status === 'CANCELLED') {
            <span style="font-family: var(--font-display); font-size: 36px; font-weight: 600">{{
              'web.orderStatus.status.CANCELLED' | translate
            }}</span>
          } @else if (o.status === 'PICKED_UP') {
            <span style="font-family: var(--font-display); font-size: 40px; font-weight: 700">{{
              'web.orderStatus.thanks' | translate
            }}</span>
          } @else {
            <span style="font-family: var(--font-sans); font-size: 96px; font-weight: 700; letter-spacing: -0.03em">
              {{ countdown() }}
            </span>
          }
        </div>

        <!-- Order Code + QR row -->
        <div class="flex gap-6 justify-center" style="margin-top: var(--spacing-sm)">
          <div
            class="flex flex-col items-center justify-center"
            style="
              width: 180px; height: 180px; gap: 8px;
              background: var(--color-cream);
              border: 2px solid var(--color-caramel);
              border-radius: 16px;
            "
          >
            <span
              style="font-family: var(--font-mono); font-size: 56px; font-weight: 700; color: var(--color-espresso); letter-spacing: 0.04em"
              >{{ o.orderCode }}</span
            >
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'web.orderStatus.yourCode' | translate
            }}</span>
          </div>

          <div
            class="flex items-center justify-center"
            style="
              width: 180px; height: 180px;
              background: var(--color-cream);
              border: 2px solid var(--color-caramel);
              border-radius: 16px;
            "
          >
            <div
              style="width: 140px; height: 140px; background: var(--color-latte); border-radius: 8px; display: grid; place-items: center"
              aria-label="QR code placeholder"
            >
              <span style="font-family: var(--font-mono); font-size: 10px; color: var(--color-text-tertiary)">QR</span>
            </div>
          </div>
        </div>

        <!-- Status Step List -->
        <ol class="w-full flex gap-3" style="padding: 0 var(--spacing-xl); margin-top: var(--spacing-sm)">
          @for (step of steps(); track step.key) {
            <li
              class="flex flex-col items-center justify-center text-center flex-1"
              style="height: 60px; border-radius: 12px; padding: 0 var(--spacing-sm);"
              [style.background]="step.background"
              [style.color]="step.color"
            >
              <span style="font-family: var(--font-sans); font-size: 13px; font-weight: 600">
                {{ step.icon }} {{ step.label | translate }}
              </span>
            </li>
          }
        </ol>

        <!-- Store info card -->
        <article
          class="w-full"
          style="
            background: var(--color-foam);
            border: 1px solid var(--color-border-light);
            border-radius: 16px;
            padding: var(--spacing-lg);
            display: flex; flex-direction: column; gap: var(--spacing-base);
          "
        >
          <div style="display: flex; flex-direction: column; gap: 4px">
            <span
              style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-espresso)"
            >
              📍 {{ o.storeName }}
            </span>
            @if (o.storeAddress) {
              <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
                {{ o.storeAddress }}
              </span>
            }
            @if (minutesToPickup() > 0 && !isTerminal(o.status)) {
              <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
                🚶 {{ 'web.orderStatus.pickupIn' | translate: { min: minutesToPickup() } }}
              </span>
            }
          </div>
          @if (hasStoreLocation()) {
            <div style="width: 100%; height: 200px; overflow: hidden; border-radius: 12px">
              <lib-leaflet-map [markers]="storeMarkers()" [userPosition]="userPos()" [interactive]="false" />
            </div>
          }
          <a
            [href]="mapsUrl()"
            target="_blank"
            rel="noopener"
            class="flex items-center justify-center"
            style="
              background: var(--color-caramel);
              color: var(--color-foam);
              height: 40px;
              border-radius: 12px;
              font-family: var(--font-sans); font-size: 14px; font-weight: 600;
              text-decoration: none;
            "
          >
            {{ (hasStoreLocation() ? 'common.map.buildRoute' : 'web.orderStatus.openMaps') | translate }}
          </a>
        </article>

        <!-- Primary CTA: I'm here -->
        @if (!isTerminal(o.status)) {
          <button
            type="button"
            (click)="imHere()"
            class="w-full flex items-center justify-center"
            style="
              background: var(--color-caramel);
              color: var(--color-foam);
              height: 56px;
              border-radius: 16px;
              font-family: var(--font-sans); font-size: 16px; font-weight: 600;
              transition: background 0.15s;
            "
          >
            {{ (imHereClicked() ? 'common.confirm' : 'web.orderStatus.iAmHere') | translate }}
          </button>
        }

        <!-- Cancel -->
        @if (canCancel()) {
          <button
            type="button"
            (click)="cancel()"
            class="w-full flex items-center justify-center"
            style="
              background: var(--color-cream);
              color: var(--color-espresso);
              height: 48px;
              border-radius: 14px;
              border: 1px solid var(--color-border);
              font-family: var(--font-sans); font-size: 14px; font-weight: 500;
            "
          >
            {{ 'web.orderStatus.cancelOrder' | translate }}
          </button>
        }

        <!-- What was ordered, as the kitchen will make it -->
        @if (lines().length > 0) {
          <article
            class="w-full"
            style="
              background: var(--color-foam);
              border: 1px solid var(--color-border-light);
              border-radius: 16px;
              padding: var(--spacing-lg);
              display: flex; flex-direction: column; gap: 12px;
            "
          >
            <span
              style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-espresso)"
            >
              {{ 'web.orderStatus.yourOrder' | translate }}
            </span>
            @for (line of lines(); track line.id) {
              <div class="flex flex-col" style="gap: 2px">
                <div class="flex items-start justify-between" style="gap: 12px">
                  <span style="font-family: var(--font-sans); font-size: 14px; color: var(--color-espresso)">
                    {{ line.quantity }} × {{ line.name }}
                  </span>
                  <span
                    style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-espresso); white-space: nowrap"
                  >
                    {{ price(line.totalCents) }}
                  </span>
                </div>
                @if (line.options) {
                  <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
                    line.options
                  }}</span>
                }
                @if (line.notes) {
                  <span
                    style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); font-style: italic"
                    >“{{ line.notes }}”</span
                  >
                }
              </div>
            }
            <div style="height: 1px; background: var(--color-border-light)"></div>
            <div class="flex items-center justify-between">
              <span
                style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-espresso)"
                >{{ 'common.total' | translate }}</span
              >
              <span
                style="font-family: var(--font-sans); font-size: 15px; font-weight: 700; color: var(--color-caramel)"
                >{{ price(o.totalCents) }}</span
              >
            </div>
          </article>
        }

        <a routerLink="/menu" class="text-sm mt-2 underline" style="color: var(--color-text-secondary)">
          {{ 'web.orderStatus.backToMenu' | translate }}
        </a>
      </section>
    }

    @if (error()) {
      <p class="mt-6 text-center text-sm" style="color: var(--color-berry)">{{ error() }}</p>
    }
  `,
})
export class OrderStatusPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly orders = inject(OrdersApi);
  private readonly realtime = inject(RealtimeService);
  private readonly authStore = inject(AuthStore);
  private readonly fmt = inject(LocaleFormatService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly flags = inject(FeatureFlagsStore);
  private readonly webPayments = inject(WebPaymentApi);

  readonly order = signal<OrderView | null>(null);
  /** The bank's verdict from the return redirect; read once, then dropped from the URL. */
  readonly paymentReturn = signal<PaymentReturn | null>(null);
  /** Re-reading the order while the bank's confirmation is on its way. */
  readonly polling = signal(false);
  readonly retrying = signal(false);
  readonly paymentError = signal<string | null>(null);
  private pollSub: Subscription | null = null;
  readonly error = signal<string | null>(null);
  readonly now = signal(Date.now());
  readonly imHereClicked = signal(false);
  readonly userPos = signal<LatLng | null>(null);

  readonly hasStoreLocation = computed(() => {
    const o = this.order();
    return !!o && (o.storeLatitude !== 0 || o.storeLongitude !== 0);
  });

  readonly storeMarkers = computed<MapMarker[]>(() => {
    const o = this.order();
    if (!o || !this.hasStoreLocation()) return [];
    return [{ id: o.storeId, lat: o.storeLatitude, lng: o.storeLongitude, label: o.storeName, kind: 'store' }];
  });

  private detachSocket: (() => void) | null = null;
  private tickSub: Subscription | null = null;

  readonly firstName = computed(() => {
    const name = this.authStore.user()?.name ?? '';
    return name.split(/\s+/)[0] ?? '';
  });

  /** Returns a translation KEY — resolved with the `translate` pipe in the template. */
  readonly heroSubtitle = computed(() => {
    const status = this.order()?.status;
    switch (status) {
      case 'CREATED':
        return 'web.orderStatus.status.CREATED';
      case 'PAID':
        return 'web.orderStatus.status.PAID';
      case 'ACCEPTED':
        return 'web.orderStatus.status.ACCEPTED';
      case 'IN_PROGRESS':
        return 'web.orderStatus.status.IN_PROGRESS';
      case 'READY':
        return 'web.orderStatus.status.READY';
      case 'PICKED_UP':
        return 'web.orderStatus.status.PICKED_UP';
      case 'CANCELLED':
        return 'web.orderStatus.status.CANCELLED';
      case 'EXPIRED':
        return 'web.orderStatus.status.EXPIRED';
      default:
        return '';
    }
  });

  /**
   * The customer-facing payment state, defaulting to "nothing to pay here" for
   * an order placed before the API started reporting it.
   */
  readonly paymentState = computed<OrderPaymentState>(() => this.order()?.payment?.state ?? 'NONE');

  /**
   * The bank said the payment failed, but our record may still read "waiting":
   * believe the bank until the order shows otherwise.
   */
  private readonly bankSaidFail = computed(
    () => this.paymentReturn() === 'fail' && (this.paymentState() === 'NONE' || this.paymentState() === 'PENDING'),
  );

  readonly paymentTitle = computed(() => {
    if (this.bankSaidFail()) return 'web.orderStatus.payment.failed';
    switch (this.paymentState()) {
      case 'PAID':
        return 'web.orderStatus.payment.paid';
      case 'HELD':
        return 'web.orderStatus.payment.held';
      case 'PENDING':
        return 'web.orderStatus.payment.pending';
      case 'FAILED':
        return 'web.orderStatus.payment.failed';
      case 'REFUNDED':
        return 'web.orderStatus.payment.refunded';
      default:
        // Nothing on a new order yet means its card has not gone through;
        // only orders from before card-only checkout were paid at the counter.
        return this.order()?.status === 'CREATED'
          ? 'web.orderStatus.payment.awaiting'
          : 'web.orderStatus.payment.atCounter';
    }
  });

  /** The concrete numbers under the title: amount and, when known, the card. */
  readonly paymentDetail = computed(() => {
    const payment = this.order()?.payment;
    if (!payment || payment.state === 'NONE') return '';
    const amount = this.price(payment.amountCents);
    return payment.cardMask ? `${amount} · ${payment.cardMask}` : amount;
  });

  /** A line under the numbers saying what happens next, as a translation key. */
  readonly paymentHint = computed(() => {
    if (this.paymentState() === 'HELD') return 'web.orderStatus.payment.heldHint';
    if (this.canRetryPayment() && (this.bankSaidFail() || this.paymentState() === 'FAILED')) {
      return 'web.orderStatus.payment.retryHint';
    }
    return '';
  });

  /**
   * Paying again on the bank's page: only in the Web-платёж flow, only while
   * the order is new and its money has not arrived, and not while we are
   * still waiting for the bank to confirm a payment the customer just made.
   */
  readonly canRetryPayment = computed(() => {
    const o = this.order();
    if (!o || o.status !== 'CREATED' || !this.flags.webPaymentsEnabled()) return false;
    if (!UNSETTLED.includes(this.paymentState())) return false;
    return !this.polling();
  });

  readonly paymentIcon = computed(() => {
    if (this.bankSaidFail()) return '⚠️';
    switch (this.paymentState()) {
      case 'PAID':
        return '✅';
      case 'HELD':
        return '🔒';
      case 'FAILED':
        return '⚠️';
      case 'REFUNDED':
        return '↩️';
      default:
        return '💳';
    }
  });

  readonly paymentBackground = computed(() => {
    if (this.bankSaidFail()) return 'var(--color-berry-light, var(--color-cream))';
    switch (this.paymentState()) {
      case 'PAID':
        return 'var(--color-mint-light, var(--color-cream))';
      case 'FAILED':
        return 'var(--color-berry-light, var(--color-cream))';
      default:
        return 'var(--color-cream)';
    }
  });

  readonly countdown = computed(() => {
    const o = this.order();
    if (!o) return '0:00';
    const diff = Math.max(0, new Date(o.pickupAt).getTime() - this.now());
    const min = Math.floor(diff / 60_000);
    const sec = Math.floor((diff % 60_000) / 1000);
    return `${min}:${String(sec).padStart(2, '0')}`;
  });

  readonly minutesToPickup = computed(() => {
    const o = this.order();
    if (!o) return 0;
    const diff = new Date(o.pickupAt).getTime() - this.now();
    return Math.max(0, Math.ceil(diff / 60_000));
  });

  /** The order's lines with their size, milk and extras spelled out. */
  readonly lines = computed(() =>
    (this.order()?.items ?? []).map((item) => {
      const snap = readOrderItemSnapshot(item.productSnapshot);
      return {
        id: item.id,
        name: snap.name,
        quantity: item.quantity,
        totalCents: item.totalCents,
        options: describeOrderItemOptions(snap),
        notes: snap.notes,
      };
    }),
  );

  readonly canCancel = computed(() => {
    const s = this.order()?.status;
    return s === 'CREATED' || s === 'PAID' || s === 'ACCEPTED';
  });

  readonly steps = computed(() => {
    const status = this.order()?.status ?? 'CREATED';
    const activeIdx = STEP_ORDER.indexOf(status);
    return STEPS.map((step) => {
      const stepIdx = STEP_ORDER.indexOf(step.key);
      const completed = stepIdx < activeIdx;
      const current = stepIdx === activeIdx || (step.key === 'PAID' && status === 'CREATED');
      const { background, color } = this.stepStyle(completed, current);
      return { ...step, background, color };
    });
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set(this.translate.instant('web.orderStatus.notFound'));
      return;
    }

    this.flags.load();
    const returned = readPaymentReturn(this.route.snapshot.queryParamMap.get('payment'));
    if (returned) {
      this.paymentReturn.set(returned);
      // A reload should not replay the bank's verdict over a newer state.
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { payment: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }

    this.orders.get(id).subscribe({
      next: (o) => {
        this.order.set(o);
        if (returned === 'success' || returned === 'pending') this.pollWhileUnconfirmed(id);
      },
      error: () => this.error.set(this.translate.instant('web.orderStatus.notFound')),
    });

    this.detachSocket = this.realtime.subscribeToOrder(id, (event) => {
      this.order.update((current) => (current ? { ...current, status: event.status } : current));
      // The store accepting the order is also when a hold turns into a real
      // debit, and that only lives on the order itself — so re-read it rather
      // than patching the status alone.
      this.orders.get(id).subscribe({ next: (o) => this.order.set(o), error: () => undefined });
    });

    this.tickSub = interval(1000).subscribe(() => this.now.set(Date.now()));

    // Best-effort customer position for the pickup map — silent on denial.
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => this.userPos.set({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => undefined,
        { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
      );
    }
  }

  ngOnDestroy(): void {
    this.detachSocket?.();
    this.tickSub?.unsubscribe();
    this.pollSub?.unsubscribe();
  }

  /**
   * Back from the bank while its notification may still be on its way: re-read
   * the order a few times until the money shows as held (or the order moves
   * on), then give up quietly — realtime still brings later changes.
   */
  private pollWhileUnconfirmed(id: string): void {
    if (!this.awaitingConfirmation()) return;
    this.polling.set(true);
    this.pollSub?.unsubscribe();
    this.pollSub = timer(PAYMENT_POLL_MS, PAYMENT_POLL_MS)
      .pipe(take(PAYMENT_POLL_TIMES))
      .subscribe({
        next: () =>
          this.orders.get(id).subscribe({
            next: (o) => {
              this.order.set(o);
              if (!this.awaitingConfirmation()) this.stopPolling();
            },
            error: () => undefined,
          }),
        complete: () => this.polling.set(false),
      });
  }

  private awaitingConfirmation(): boolean {
    const state = this.paymentState();
    return this.order()?.status === 'CREATED' && (state === 'NONE' || state === 'PENDING');
  }

  private stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
    this.polling.set(false);
  }

  /**
   * Another go on the bank's page for this same order. No page back means the
   * money arrived in the meantime, so just show the order as it is now.
   */
  retryPayment(): void {
    const o = this.order();
    if (!o || this.retrying()) return;
    this.retrying.set(true);
    this.paymentError.set(null);
    this.webPayments.start(o.id).subscribe({
      next: (res) => {
        if (res.page) {
          // `retrying` stays on: the browser is on its way to the bank.
          this.webPayments.redirectToBank(res.page);
          return;
        }
        this.retrying.set(false);
        this.paymentReturn.set(null);
        this.orders.get(o.id).subscribe({ next: (fresh) => this.order.set(fresh), error: () => undefined });
      },
      error: (err) => {
        this.retrying.set(false);
        this.paymentError.set(this.errorText(err));
      },
    });
  }

  /**
   * Coming back from the bank with the browser's Back button can restore this
   * page from the back-forward cache with the retry button still spinning.
   */
  onPageShow(event: PageTransitionEvent): void {
    if (event.persisted) this.retrying.set(false);
  }

  private errorText(err: unknown): string {
    if ((err as { status?: unknown } | null)?.status === 0) return this.translate.instant('common.networkError');
    const raw = ((err as { error?: unknown } | null)?.error as { message?: unknown } | null)?.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw;
    return typeof message === 'string' && message ? message : this.translate.instant('common.requestFailed');
  }

  cancel(): void {
    const o = this.order();
    if (!o) return;
    this.orders.cancel(o.id).subscribe({
      next: (updated) => this.order.set(updated),
    });
  }

  imHere(): void {
    const o = this.order();
    if (!o) return;
    this.imHereClicked.set(true);

    const send = (lat: number, lng: number) =>
      this.orders.reportLocation(o.id, { lat, lng, iAmHere: true }).subscribe({
        error: () => {
          // Soft fallback: keep the button "confirmed" — the staff already
          // see the order via realtime, so a transport blip shouldn't make
          // the UI feel broken to the customer.
        },
      });

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => send(pos.coords.latitude, pos.coords.longitude),
        // No coords (permission denied / timeout) — still record the
        // explicit "I'm here" tap by sending zeros + iAmHere flag; the
        // server's iAmHere short-circuit treats it as HERE regardless of
        // distance.
        () => send(0, 0),
        { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
      );
    } else {
      send(0, 0);
    }
  }

  price(cents: number): string {
    return this.fmt.money(cents, this.order()?.currency ?? this.authStore.user()?.currency);
  }

  isTerminal(status: OrderStatusString): boolean {
    return status === 'PICKED_UP' || status === 'CANCELLED' || status === 'EXPIRED';
  }

  ringBackground(): string {
    const status = this.order()?.status;
    if (status === 'READY') return 'var(--color-mint)';
    if (status === 'CANCELLED' || status === 'EXPIRED') return 'var(--color-latte)';
    if (status === 'PICKED_UP') return 'var(--color-caramel-light)';
    return 'var(--color-caramel-light)';
  }

  ringTextColor(): string {
    const status = this.order()?.status;
    if (status === 'READY') return 'var(--color-foam)';
    if (status === 'PICKED_UP') return 'var(--color-caramel)';
    return 'var(--color-espresso)';
  }

  mapsUrl(): string {
    const o = this.order();
    if (o && this.hasStoreLocation()) {
      return buildDirectionsUrl({ lat: o.storeLatitude, lng: o.storeLongitude });
    }
    // Fallback when the store has no coordinates yet — search by name.
    return `https://maps.google.com/?q=${encodeURIComponent(o?.storeName ?? '')}`;
  }

  private stepStyle(completed: boolean, current: boolean): { background: string; color: string } {
    if (completed || current) {
      return { background: 'var(--color-caramel)', color: 'var(--color-foam)' };
    }
    // Upcoming steps fade from caramel-light → latte as distance grows.
    return { background: 'var(--color-latte)', color: 'var(--color-text-secondary)' };
  }
}
